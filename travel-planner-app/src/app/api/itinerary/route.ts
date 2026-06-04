import { NextResponse } from "next/server";
import type { QueryResultRow } from "pg";
import { z } from "zod";
import {
  createEmptyAdaptation,
  mergeAdaptations,
  SARAJEVO_COORDINATES,
} from "@/lib/adaptation";
import { query } from "@/lib/db";
import {
  adaptItineraryFeasibility,
  type ItineraryCandidate,
} from "@/lib/itinerary-feasibility";
import {
  buildRoutingMetadata,
  getRoute,
  type Coordinates,
  type RoutingMetadata,
  type RoutingResponse,
} from "@/lib/routing";
import { getCurrentWeather, type WeatherInfo } from "@/lib/weather";
import { applyWeatherAdaptation } from "@/lib/weather-adaptation";
import type { Attraction } from "@/types/attraction";
import type { GeneratedItinerary, RankedAttraction } from "@/types/itinerary";
import {
  budgetLevelValues,
  preferredPaceValues,
  transportModeValues,
  type PlannerPreferences,
  type TransportMode,
} from "@/types/preference";

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

const coordinateSchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
});

const preferenceSchema = z
  .object({
    interests: z
      .array(z.string().trim().min(1))
      .min(
        1,
        "Please select at least one interest to generate your itinerary."
      ),
    budgetLevel: z.enum(budgetLevelValues).default("medium"),
    startTime: z.string().regex(timePattern, "Start time must use HH:MM format"),
    endTime: z.string().regex(timePattern, "End time must use HH:MM format"),
    transportMode: z.enum(transportModeValues).default("walking"),
    preferredPace: z.enum(preferredPaceValues).default("moderate"),
    maxAttractions: z.coerce.number().int().min(1).max(12).default(5),
    startLocation: coordinateSchema.optional(),
  })
  .refine(
    (preferences) =>
      timeToMinutes(preferences.endTime) > timeToMinutes(preferences.startTime),
    {
      message: "End time must be later than start time",
      path: ["endTime"],
    }
  );

const itineraryRequestSchema = z.object({
  preferences: preferenceSchema,
});

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
  normalized_name: string | null;
  cleaning_notes: string | null;
  created_at?: string | Date | null;
};

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

type RecommendationPreferencesPayload = Omit<
  PlannerPreferences,
  "startLocation"
>;

class RecommendationServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecommendationServiceError";
  }
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid JSON request body",
      },
      { status: 400 }
    );
  }

  const parsedRequest = itineraryRequestSchema.safeParse(body);

  if (!parsedRequest.success) {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid itinerary preferences",
        details: parsedRequest.error.issues.map((issue) => issue.message),
      },
      { status: 400 }
    );
  }

  const preferences: PlannerPreferences = parsedRequest.data.preferences;

  try {
    const attractions = await fetchAttractions();

    if (attractions.length === 0) {
      return NextResponse.json({
        success: true,
        itinerary: {
          ...createEmptyItinerary(),
          routing: createInsufficientRoutingMetadata(
            preferences.transportMode
          ),
          transportMode: preferences.transportMode,
        },
        adaptation: createEmptyAdaptation({
          feasibilityStatus: "not_feasible",
        }),
      });
    }

    const rankedAttractions = await fetchRankedAttractions(
      preferences,
      attractions
    );
    const weather = await fetchWeatherForAdaptation();
    const weatherAdaptation = applyWeatherAdaptation(
      rankedAttractions,
      attractions,
      weather,
      preferences.maxAttractions
    );
    const candidates = createItineraryCandidates(
      attractions,
      weatherAdaptation.rankedAttractions
    );
    const feasibilityAdaptation = await adaptItineraryFeasibility(
      preferences,
      candidates
    );
    const adaptation = mergeAdaptations(
      weatherAdaptation.adaptation,
      feasibilityAdaptation.adaptation
    );
    const route = await fetchItineraryRoute(
      feasibilityAdaptation.itinerary,
      preferences.transportMode
    );
    const routing = toItineraryRoutingMetadata(route);

    return NextResponse.json({
      success: true,
      itinerary: {
        ...feasibilityAdaptation.itinerary,
        routeGeometry: route.routeGeometry,
        routing,
        transportMode: preferences.transportMode,
      },
      adaptation,
    });
  } catch (error) {
    if (error instanceof RecommendationServiceError) {
      return NextResponse.json(
        {
          success: false,
          error: "Recommendation service request failed",
          details: error.message,
        },
        { status: 502 }
      );
    }

    console.error("Itinerary generation error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Failed to generate itinerary",
      },
      { status: 500 }
    );
  }
}

async function fetchAttractions(): Promise<Attraction[]> {
  const rows = await query<AttractionRow>(
    `SELECT
      id,
      name,
      description,
      category,
      primary_category,
      secondary_categories,
      tags,
      latitude,
      longitude,
      estimated_visit_duration,
      rating,
      price_level,
      indoor_outdoor,
      opening_time,
      closing_time,
      is_featured,
      data_quality_score,
      popularity_score,
      normalized_name,
      cleaning_notes,
      created_at
    FROM attractions
    WHERE COALESCE(is_active, true) = true
    ORDER BY id ASC`
  );

  return rows.map(normalizeAttraction);
}

function normalizeAttraction(row: AttractionRow): Attraction {
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
    normalized_name: row.normalized_name ?? undefined,
    cleaning_notes: row.cleaning_notes ?? undefined,
    created_at: row.created_at ? String(row.created_at) : undefined,
  };
}

async function fetchRankedAttractions(
  preferences: PlannerPreferences,
  attractions: Attraction[]
): Promise<RankedAttraction[]> {
  const serviceUrl = process.env.ML_SERVICE_URL || "http://localhost:8000";
  const endpoint = `${serviceUrl.replace(/\/$/, "")}/recommend`;
  const controller = new AbortController();
  const timeoutId = windowlessSetTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        preferences: toRecommendationPreferences(preferences),
        attractions: attractions.map(toRecommendationPayload),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new RecommendationServiceError(
        `Service returned HTTP ${response.status}`
      );
    }

    const payload = (await response.json()) as unknown;
    return parseRecommendationResponse(payload);
  } catch (error) {
    if (error instanceof RecommendationServiceError) {
      throw error;
    }

    const message =
      error instanceof Error
        ? error.message
        : "Recommendation service is unavailable";

    throw new RecommendationServiceError(message);
  } finally {
    clearTimeout(timeoutId);
  }
}

function toRecommendationPreferences(
  preferences: PlannerPreferences
): RecommendationPreferencesPayload {
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

function toRecommendationPayload(
  attraction: Attraction
): RecommendationAttractionPayload {
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
    if (!isRecord(item)) {
      return [];
    }

    const id = Number(item.id);
    const score = Number(item.score);
    const reason =
      typeof item.reason === "string" && item.reason.trim().length > 0
        ? item.reason
        : "Recommended by similarity score";

    if (!Number.isInteger(id) || !Number.isFinite(score)) {
      return [];
    }

    return [
      {
        id,
        score: clamp(score, 0, 1),
        reason,
      },
    ];
  });
}

async function fetchWeatherForAdaptation(): Promise<WeatherInfo | null> {
  const controller = new AbortController();
  const timeoutId = windowlessSetTimeout(() => controller.abort(), 3500);

  try {
    return await getCurrentWeather(
      SARAJEVO_COORDINATES.latitude,
      SARAJEVO_COORDINATES.longitude,
      controller.signal
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown weather service error";
    console.warn("Weather adaptation skipped:", message);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

function createItineraryCandidates(
  attractions: Attraction[],
  rankedAttractions: RankedAttraction[]
): ItineraryCandidate[] {
  const attractionsById = new Map(
    attractions.map((attraction) => [attraction.id, attraction])
  );

  return rankedAttractions.flatMap((rank): ItineraryCandidate[] => {
    const attraction = attractionsById.get(rank.id);
    return attraction ? [{ attraction, rank }] : [];
  });
}

function createEmptyItinerary(): GeneratedItinerary {
  return {
    items: [],
    totalVisitTime: 0,
    totalTravelTime: 0,
    totalDuration: 0,
    feasibilityStatus: "infeasible",
  };
}

async function fetchItineraryRoute(
  itinerary: GeneratedItinerary,
  transportMode: TransportMode
): Promise<RoutingResponse> {
  const coordinates = itinerary.items
    .map((item): Coordinates => ({
      latitude: toFiniteNumber(item.attraction.latitude, 0),
      longitude: toFiniteNumber(item.attraction.longitude, 0),
    }))
    .filter(isValidCoordinates);

  return getRoute(coordinates, {
    includeGeometry: true,
    transport: transportMode,
  });
}

function toItineraryRoutingMetadata(route: RoutingResponse): RoutingMetadata {
  const routing = buildRoutingMetadata(route);

  if (process.env.NODE_ENV === "development") {
    return routing;
  }

  return {
    geometryPointCount: routing.geometryPointCount,
    provider: routing.provider,
    transport: routing.transport,
  };
}

function createInsufficientRoutingMetadata(
  transport: TransportMode
): RoutingMetadata {
  return {
    ...(process.env.NODE_ENV === "development"
      ? { fallbackReason: "insufficient_coordinates" as const }
      : {}),
    geometryPointCount: 0,
    provider: "fallback",
    transport,
  };
}

function isValidCoordinates(coordinates: Coordinates): boolean {
  return (
    Number.isFinite(coordinates.latitude) &&
    Number.isFinite(coordinates.longitude) &&
    coordinates.latitude >= -90 &&
    coordinates.latitude <= 90 &&
    coordinates.longitude >= -180 &&
    coordinates.longitude <= 180 &&
    !(coordinates.latitude === 0 && coordinates.longitude === 0)
  );
}

function timeToMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function normalizeTextArray(value: string[] | string | null): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    return [];
  }

  return value
    .replace(/^{|}$/g, "")
    .split(",")
    .map((item) => item.replace(/^"|"$/g, "").trim())
    .filter((item) => item.length > 0);
}

function toFiniteNumber(value: string | number, fallback: number): number {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function windowlessSetTimeout(
  handler: () => void,
  timeoutMilliseconds: number
): ReturnType<typeof setTimeout> {
  return setTimeout(handler, timeoutMilliseconds);
}
