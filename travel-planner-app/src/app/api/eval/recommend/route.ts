import { NextResponse } from "next/server";
import type { QueryResultRow } from "pg";
import { z } from "zod";
import { query } from "@/lib/db";
import { getRankedCandidates } from "@/lib/recommendation-ranking";
import type { Attraction } from "@/types/attraction";
import {
  budgetLevelValues,
  preferredPaceValues,
  transportModeValues,
} from "@/types/preference";
import type { PlannerPreferences } from "@/types/preference";

// ── Request schema ─────────────────────────────────────────────────────────────

const evalRecommendSchema = z.object({
  preferences: z.object({
    interests: z.array(z.string().trim().min(1)).min(1, "At least one interest required"),
    budgetLevel: z.enum(budgetLevelValues).default("medium"),
    transportMode: z.enum(transportModeValues).default("walking"),
    preferredPace: z.enum(preferredPaceValues).default("moderate"),
    // Optional time/slot fields forwarded to the ML service for realistic scoring.
    startTime: z.string().default("09:00"),
    endTime: z.string().default("18:00"),
    maxAttractions: z.coerce.number().int().min(1).max(50).default(10),
  }),
  recommender: z.enum(["content", "popularity", "random"]).default("content"),
  topN: z.coerce.number().int().min(1).max(500).default(25),
});

// ── Response shape ─────────────────────────────────────────────────────────────

type RankedCandidate = {
  id: number;
  name: string;
  primaryCategory: string | null;
  rating: number | null;
  dataQualityScore: number | null;
  popularityScore: number | null;
  score: number;
  rank: number;
};

// ── DB row type ────────────────────────────────────────────────────────────────

type AttractionRow = QueryResultRow & {
  id: number;
  name: string;
  description: string | null;
  category: string;
  primary_category: string | null;
  secondary_categories: string[] | string | null;
  tags: string[] | string | null;
  latitude: string | number;
  longitude: string | number;
  estimated_visit_duration: number;
  rating: string | number | null;
  price_level: string | null;
  indoor_outdoor: string | null;
  opening_time: string | null;
  closing_time: string | null;
  is_featured: boolean | null;
  data_quality_score: string | number | null;
  popularity_score: string | number | null;
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function toFiniteNumber(value: string | number, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeTextArray(value: string[] | string | null): string[] {
  if (Array.isArray(value)) {
    return value.map((s) => s.trim()).filter((s) => s.length > 0);
  }
  if (typeof value !== "string" || value.trim().length === 0) return [];
  return value
    .replace(/^{|}$/g, "")
    .split(",")
    .map((s) => s.replace(/^"|"$/g, "").trim())
    .filter((s) => s.length > 0);
}

function normalizeRow(row: AttractionRow): Attraction {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    primary_category: row.primary_category,
    secondary_categories: normalizeTextArray(row.secondary_categories),
    tags: normalizeTextArray(row.tags),
    latitude: toFiniteNumber(row.latitude, 0),
    longitude: toFiniteNumber(row.longitude, 0),
    estimated_visit_duration: row.estimated_visit_duration,
    rating: row.rating === null ? null : toFiniteNumber(row.rating, 0),
    price_level: row.price_level,
    indoor_outdoor: row.indoor_outdoor,
    opening_time: row.opening_time,
    closing_time: row.closing_time,
    is_featured: row.is_featured ?? false,
    data_quality_score:
      row.data_quality_score === null
        ? undefined
        : toFiniteNumber(row.data_quality_score, 0),
    popularity_score:
      row.popularity_score === null
        ? undefined
        : toFiniteNumber(row.popularity_score, 0),
  };
}

async function fetchAllAttractions(): Promise<Attraction[]> {
  const rows = await query<AttractionRow>(
    `SELECT
      id, name, description, category, primary_category,
      secondary_categories, tags, latitude, longitude,
      estimated_visit_duration, rating, price_level, indoor_outdoor,
      opening_time, closing_time, is_featured,
      data_quality_score, popularity_score
    FROM attractions
    WHERE COALESCE(is_active, true) = true
    ORDER BY id ASC`
  );
  return rows.map(normalizeRow);
}

// ── Handler ────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON request body" },
      { status: 400 }
    );
  }

  const parsed = evalRecommendSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid request",
        details: parsed.error.issues.map((i) => i.message),
      },
      { status: 400 }
    );
  }

  const { preferences: rawPrefs, recommender, topN } = parsed.data;

  // Construct a full PlannerPreferences so the ML service receives realistic context.
  const preferences: PlannerPreferences = {
    interests: rawPrefs.interests,
    budgetLevel: rawPrefs.budgetLevel,
    transportMode: rawPrefs.transportMode,
    preferredPace: rawPrefs.preferredPace,
    startTime: rawPrefs.startTime,
    endTime: rawPrefs.endTime,
    maxAttractions: rawPrefs.maxAttractions,
  };

  try {
    // Use the full attraction pool — no resolvePreferredAttractions deduplication —
    // so every DB row competes independently and ground truth can be built on the
    // same unreduced pool.
    const allAttractions = await fetchAllAttractions();

    const { rankedAttractions, recommendationSource } = await getRankedCandidates(
      preferences,
      recommender,
      allAttractions
    );

    // Build an id→attraction lookup for joining metadata onto the ranked list.
    const attractionById = new Map(allAttractions.map((a) => [a.id, a]));

    const rankedCandidates: RankedCandidate[] = rankedAttractions
      .slice(0, topN)
      .flatMap((ranked, idx): RankedCandidate[] => {
        const a = attractionById.get(ranked.id);
        if (!a) return [];
        return [
          {
            id: a.id,
            name: a.name,
            primaryCategory: a.primary_category ?? null,
            rating: a.rating === null ? null : (typeof a.rating === "number" ? a.rating : null),
            dataQualityScore: a.data_quality_score ?? null,
            popularityScore: a.popularity_score ?? null,
            score: ranked.score,
            rank: idx + 1,
          },
        ];
      });

    return NextResponse.json({
      success: true,
      recommender,
      recommendationSource,
      totalAttractions: allAttractions.length,
      rankedCandidates,
    });
  } catch (error) {
    console.error("/api/eval/recommend error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to rank candidates" },
      { status: 500 }
    );
  }
}
