import { NextResponse } from "next/server";
import type { QueryResultRow } from "pg";
import { z } from "zod";
import {
  calculateHaversineDistanceKm,
  estimateWalkingTimeMinutes,
  getOsrmRouteTime,
  type Coordinates,
} from "@/lib/routing";
import { query } from "@/lib/db";
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

const preferenceSchema = z
  .object({
    interests: z.array(z.string().trim().min(1)).default([]),
    budgetLevel: z.enum(budgetLevelValues).default("medium"),
    startTime: z.string().regex(timePattern, "Start time must use HH:MM format"),
    endTime: z.string().regex(timePattern, "End time must use HH:MM format"),
    transportMode: z.enum(transportModeValues).default("walking"),
    preferredPace: z.enum(preferredPaceValues).default("moderate"),
    maxAttractions: z.coerce.number().int().min(1).max(12).default(5),
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
  latitude: string | number;
  longitude: string | number;
  estimated_visit_duration: number;
  rating: string | number | null;
  price_level: string | null;
  indoor_outdoor: string | null;
  opening_time: string | null;
  closing_time: string | null;
  created_at?: string | Date | null;
};

type RecommendationAttractionPayload = {
  id: number;
  name: string;
  description: string | null;
  category: string;
  latitude: number;
  longitude: number;
  estimated_visit_duration: number;
  rating: number | null;
  price_level: string | null;
  indoor_outdoor: string | null;
};

type RankedCandidate = {
  attraction: Attraction;
  rank: RankedAttraction;
};

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
        itinerary: createEmptyItinerary(),
      });
    }

    const rankedAttractions = await fetchRankedAttractions(
      preferences,
      attractions
    );
    const itinerary = await buildItinerary(
      preferences,
      attractions,
      rankedAttractions
    );

    return NextResponse.json({
      success: true,
      itinerary,
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
      latitude,
      longitude,
      estimated_visit_duration,
      rating,
      price_level,
      indoor_outdoor,
      opening_time,
      closing_time,
      created_at
    FROM attractions
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
    latitude: toFiniteNumber(row.latitude, 0),
    longitude: toFiniteNumber(row.longitude, 0),
    estimated_visit_duration: row.estimated_visit_duration,
    rating: row.rating === null ? null : toFiniteNumber(row.rating, 0),
    price_level: row.price_level,
    indoor_outdoor: row.indoor_outdoor,
    opening_time: row.opening_time,
    closing_time: row.closing_time,
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
        preferences,
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

function toRecommendationPayload(
  attraction: Attraction
): RecommendationAttractionPayload {
  return {
    id: attraction.id,
    name: attraction.name,
    description: attraction.description,
    category: attraction.category,
    latitude: toFiniteNumber(attraction.latitude, 0),
    longitude: toFiniteNumber(attraction.longitude, 0),
    estimated_visit_duration: attraction.estimated_visit_duration,
    rating: attraction.rating === null ? null : toFiniteNumber(attraction.rating, 0),
    price_level: attraction.price_level,
    indoor_outdoor: attraction.indoor_outdoor,
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

async function buildItinerary(
  preferences: PlannerPreferences,
  attractions: Attraction[],
  rankedAttractions: RankedAttraction[]
): Promise<GeneratedItinerary> {
  const startMinutes = timeToMinutes(preferences.startTime);
  const endMinutes = timeToMinutes(preferences.endTime);
  const attractionsById = new Map(
    attractions.map((attraction) => [attraction.id, attraction])
  );
  const candidates = rankedAttractions.flatMap((rank): RankedCandidate[] => {
    const attraction = attractionsById.get(rank.id);
    return attraction ? [{ attraction, rank }] : [];
  });

  const items: GeneratedItinerary["items"] = [];
  let totalVisitTime = 0;
  let totalTravelTime = 0;
  let cursorMinutes = startMinutes;
  let previousAttraction: Attraction | null = null;
  let stoppedBecauseTime = false;

  for (const candidate of candidates) {
    if (items.length >= preferences.maxAttractions) {
      break;
    }

    const travelTimeFromPrevious = previousAttraction
      ? await calculateTravelTimeMinutes(
          previousAttraction,
          candidate.attraction,
          preferences.transportMode
        )
      : 0;
    const plannedStartMinutes = cursorMinutes + travelTimeFromPrevious;
    const visitDuration = normalizeVisitDuration(
      candidate.attraction.estimated_visit_duration
    );
    const plannedEndMinutes = plannedStartMinutes + visitDuration;

    if (plannedEndMinutes > endMinutes) {
      stoppedBecauseTime = true;
      break;
    }

    items.push({
      attraction: candidate.attraction,
      score: candidate.rank.score,
      reason: candidate.rank.reason,
      plannedStartTime: minutesToTime(plannedStartMinutes),
      plannedEndTime: minutesToTime(plannedEndMinutes),
      travelTimeFromPrevious,
    });

    totalVisitTime += visitDuration;
    totalTravelTime += travelTimeFromPrevious;
    cursorMinutes = plannedEndMinutes;
    previousAttraction = candidate.attraction;
  }

  return {
    items,
    totalVisitTime,
    totalTravelTime,
    totalDuration: totalVisitTime + totalTravelTime,
    feasibilityStatus:
      items.length === 0
        ? "infeasible"
        : stoppedBecauseTime
          ? "partial"
          : "feasible",
  };
}

async function calculateTravelTimeMinutes(
  from: Attraction,
  to: Attraction,
  transportMode: TransportMode
): Promise<number> {
  const fromCoordinates = getAttractionCoordinates(from);
  const toCoordinates = getAttractionCoordinates(to);

  if (transportMode === "walking") {
    const distanceKm = calculateHaversineDistanceKm(
      fromCoordinates,
      toCoordinates
    );
    return estimateWalkingTimeMinutes(distanceKm);
  }

  return getOsrmRouteTime(fromCoordinates, toCoordinates);
}

function getAttractionCoordinates(attraction: Attraction): Coordinates {
  return {
    latitude: toFiniteNumber(attraction.latitude, 0),
    longitude: toFiniteNumber(attraction.longitude, 0),
  };
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

function normalizeVisitDuration(duration: number): number {
  return Math.max(15, Math.round(duration));
}

function timeToMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function minutesToTime(value: number): string {
  const minutesInDay = 24 * 60;
  const normalized = ((value % minutesInDay) + minutesInDay) % minutesInDay;
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
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
