import { rankAttractionsLocally } from "@/lib/recommendation-fallback";
import type { Attraction } from "@/types/attraction";
import type { RankedAttraction } from "@/types/itinerary";
import type { PlannerPreferences } from "@/types/preference";

// Single source of truth for the random-recommender seed used in evaluation.
// Change this constant to re-run with a different randomisation.
export const EVAL_SEED = 42;

type RecommendationAttractionPayload = {
  id: number;
  name: string;
  description: string | null;
  category: string;
  primary_category: string | null;
  secondary_categories: string[];
  tags: string[];
  latitude: number;
  longitude: number;
  estimated_visit_duration: number;
  rating: number | null;
  price_level: string | null;
  indoor_outdoor: string | null;
  is_featured: boolean;
  data_quality_score: number | null;
  popularity_score: number | null;
};

class RecommendationServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecommendationServiceError";
  }
}

// Deterministic PRNG (mulberry32) — no external dependency needed.
function mulberry32(seed: number): () => number {
  let s = seed;
  return (): number => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toFiniteNumber(value: string | number, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function rankAttractionsByPopularity(attractions: Attraction[]): RankedAttraction[] {
  return [...attractions]
    .sort((a, b) => {
      const popDiff = (b.popularity_score ?? 0) - (a.popularity_score ?? 0);
      if (popDiff !== 0) return popDiff;
      return (b.data_quality_score ?? 0) - (a.data_quality_score ?? 0);
    })
    .map((attraction, index): RankedAttraction => ({
      id: attraction.id,
      score: clamp(1 - index / Math.max(attractions.length, 1), 0, 1),
      reason: "Ranked by popularity",
    }));
}

export function rankAttractionsRandomly(attractions: Attraction[], seed: number): RankedAttraction[] {
  const rand = mulberry32(seed);
  const shuffled = attractions
    .map((attraction) => ({ attraction, key: rand() }))
    .sort((a, b) => a.key - b.key)
    .map(({ attraction }) => attraction);

  return shuffled.map((attraction, index): RankedAttraction => ({
    id: attraction.id,
    score: clamp(1 - index / Math.max(shuffled.length, 1), 0, 1),
    reason: "Random selection (deterministic seed)",
  }));
}

function toRecommendationPreferences(preferences: PlannerPreferences): {
  interests: string[];
  startTime: string;
  endTime: string;
  budgetLevel: string;
  transportMode: string;
  preferredPace: string;
  maxAttractions: number;
} {
  return {
    interests: preferences.interests,
    startTime: preferences.startTime,
    endTime: preferences.endTime,
    budgetLevel: preferences.budgetLevel,
    transportMode: preferences.transportMode,
    preferredPace: preferences.preferredPace,
    maxAttractions: preferences.maxAttractions,
  };
}

function toRecommendationPayload(attraction: Attraction): RecommendationAttractionPayload {
  return {
    id: attraction.id,
    name: attraction.name,
    description: attraction.description,
    category: attraction.category,
    primary_category: attraction.primary_category ?? null,
    secondary_categories: attraction.secondary_categories ?? [],
    tags: attraction.tags ?? [],
    latitude: toFiniteNumber(attraction.latitude, 0),
    longitude: toFiniteNumber(attraction.longitude, 0),
    estimated_visit_duration: attraction.estimated_visit_duration,
    rating: attraction.rating === null ? null : toFiniteNumber(attraction.rating, 0),
    price_level: attraction.price_level,
    indoor_outdoor: attraction.indoor_outdoor,
    is_featured: attraction.is_featured ?? false,
    data_quality_score: attraction.data_quality_score ?? null,
    popularity_score: attraction.popularity_score ?? null,
  };
}

function parseRecommendationResponse(payload: unknown): RankedAttraction[] {
  if (!isRecord(payload)) {
    throw new RecommendationServiceError("Service returned an invalid response");
  }

  if (payload.success !== true) {
    const serviceError =
      typeof payload.error === "string"
        ? payload.error
        : "Service did not return ranked attractions";
    throw new RecommendationServiceError(serviceError);
  }

  if (!Array.isArray(payload.rankedAttractions)) {
    throw new RecommendationServiceError("Service response is missing rankings");
  }

  return payload.rankedAttractions.flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = Number(item.id);
    const score = Number(item.score);
    const reason =
      typeof item.reason === "string" && item.reason.trim().length > 0
        ? item.reason
        : "Recommended by similarity score";
    if (!Number.isInteger(id) || !Number.isFinite(score)) return [];
    return [{ id, score: clamp(score, 0, 1), reason }];
  });
}

async function fetchRankedAttractions(
  preferences: PlannerPreferences,
  attractions: Attraction[]
): Promise<RankedAttraction[]> {
  const serviceUrl = process.env.ML_SERVICE_URL || "http://localhost:8000";
  const endpoint = `${serviceUrl.replace(/\/$/, "")}/recommend`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        preferences: toRecommendationPreferences(preferences),
        attractions: attractions.map(toRecommendationPayload),
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      throw new RecommendationServiceError(`Service returned HTTP ${response.status}`);
    }

    const payload = (await response.json()) as unknown;
    const ranked = parseRecommendationResponse(payload);

    if (ranked.length === 0) {
      throw new RecommendationServiceError("Service returned empty rankings");
    }

    return ranked;
  } catch (error) {
    if (error instanceof RecommendationServiceError) throw error;
    const message = error instanceof Error ? error.message : "Recommendation service is unavailable";
    throw new RecommendationServiceError(message);
  }
}

/**
 * Rank a candidate pool with the specified recommender strategy.
 * "content"    → ML service with local fallback (recommendationSource tells you which was used).
 * "popularity" → sort by popularity_score desc, data_quality_score as tiebreaker.
 * "random"     → deterministic shuffle using EVAL_SEED.
 *
 * The caller is responsible for passing the desired pool (e.g. resolvedAttractions for the
 * itinerary route, or the full raw pool for the evaluation endpoint).
 */
export async function getRankedCandidates(
  preferences: PlannerPreferences,
  recommender: "content" | "popularity" | "random",
  allAttractions: Attraction[]
): Promise<{ rankedAttractions: RankedAttraction[]; recommendationSource: "ml" | "fallback" }> {
  if (recommender === "popularity") {
    return {
      rankedAttractions: rankAttractionsByPopularity(allAttractions),
      recommendationSource: "fallback",
    };
  }

  if (recommender === "random") {
    return {
      rankedAttractions: rankAttractionsRandomly(allAttractions, EVAL_SEED),
      recommendationSource: "fallback",
    };
  }

  // content: ML service with local fallback
  try {
    const rankedAttractions = await fetchRankedAttractions(preferences, allAttractions);
    return { rankedAttractions, recommendationSource: "ml" };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "ML service unavailable";
    console.warn("ML recommendation service unavailable, using local fallback:", reason);
    return {
      rankedAttractions: rankAttractionsLocally(allAttractions, preferences),
      recommendationSource: "fallback",
    };
  }
}
