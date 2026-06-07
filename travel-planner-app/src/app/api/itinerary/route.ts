import { NextResponse } from "next/server";
import type { QueryResultRow } from "pg";
import { z } from "zod";
import {
  createEmptyAdaptation,
  mergeAdaptations,
  SARAJEVO_COORDINATES,
} from "@/lib/adaptation";
import { resolvePreferredAttractions } from "@/lib/attraction-source-priority";
import { query } from "@/lib/db";
import {
  adaptItineraryFeasibility,
  type ItineraryCandidate,
} from "@/lib/itinerary-feasibility";
import { buildMixedModeRoute } from "@/lib/mixed-mode-routing";
import {
  type Coordinates,
  type RoutingMetadata,
} from "@/lib/routing";
import { getCurrentWeather, type WeatherInfo } from "@/lib/weather";
import { getRankedCandidates } from "@/lib/recommendation-ranking";
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
  // Evaluation-harness control parameters (all optional; absent = current behaviour).
  mode: z.enum(["adaptive", "static"]).optional(),
  weatherOverride: z.enum(["clear", "rain"]).optional(),
  recommender: z.enum(["content", "popularity", "random"]).optional(),
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
  source: string | null;
  source_id: string | null;
  image_url: string | null;
  thumbnail_url: string | null;
  created_at?: string | Date | null;
};

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
  const mode = parsedRequest.data.mode ?? "adaptive";
  const weatherOverride = parsedRequest.data.weatherOverride;
  const recommender = parsedRequest.data.recommender ?? "content";
  logItineraryRequest(preferences);

  try {
    const attractions = await fetchAttractions();
    const resolvedAttractions = resolvePreferredAttractions(attractions);

    if (resolvedAttractions.length === 0) {
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
        mode,
        recommender,
        weatherUsed: null,
      });
    }

    const { rankedAttractions, recommendationSource } = await getRankedCandidates(
      preferences,
      recommender,
      resolvedAttractions
    );

    // Weather: static mode skips weather adaptation entirely so experiments are
    // independent of outdoor-risk rescoring. weatherOverride fixes the value for
    // adaptive-mode reproducibility.
    const weather: WeatherInfo | null =
      mode === "static"
        ? null
        : weatherOverride
          ? createOverrideWeather(weatherOverride)
          : await fetchWeatherForAdaptation();

    const weatherAdaptation =
      mode === "static"
        ? { rankedAttractions, adaptation: createEmptyAdaptation() }
        : applyWeatherAdaptation(
            rankedAttractions,
            resolvedAttractions,
            weather,
            preferences.maxAttractions
          );

    const candidates = createItineraryCandidates(
      resolvedAttractions,
      weatherAdaptation.rankedAttractions
    );
    const feasibilityAdaptation = await adaptItineraryFeasibility(
      preferences,
      candidates
    );
    const mergedAdaptation = mergeAdaptations(
      weatherAdaptation.adaptation,
      feasibilityAdaptation.adaptation
    );
    const adaptation = {
      ...mergedAdaptation,
      recommendationSource,
      ...(recommendationSource === "fallback"
        ? {
            applied: true,
            reasons: [
              ...mergedAdaptation.reasons,
              "Recommendations generated in fallback mode — ML service unavailable",
            ],
          }
        : {}),
    };
    const { itinerary: routedItinerary } = await applyMixedModeRoute(
      feasibilityAdaptation.itinerary,
      preferences
    );
    logItineraryResponseSelection(preferences, routedItinerary);

    return NextResponse.json({
      success: true,
      itinerary: routedItinerary,
      adaptation,
      recommendationSource,
      mode,
      recommender,
      weatherUsed: weather,
    });
  } catch (error) {
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

function createOverrideWeather(weatherOverride: "clear" | "rain"): WeatherInfo {
  if (weatherOverride === "rain") {
    return { temperature: 15, condition: "rain", description: "simulated rain", isOutdoorRisk: true };
  }
  return { temperature: 20, condition: "clear", description: "simulated clear sky", isOutdoorRisk: false };
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
      source,
      source_id,
      image_url,
      (
        SELECT ai.thumbnail_url
        FROM attraction_images ai
        WHERE ai.attraction_id = attractions.id AND ai.is_primary = true
        LIMIT 1
      ) AS thumbnail_url,
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
    source: row.source ?? null,
    source_id: row.source_id ?? null,
    image_url: row.image_url ?? null,
    thumbnail_url: row.thumbnail_url ?? null,
    created_at: row.created_at ? String(row.created_at) : undefined,
  };
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

function logItineraryRequest(preferences: PlannerPreferences): void {
  console.log("/api/itinerary request:", {
    maxStops: preferences.maxAttractions,
    selectedInterests: preferences.interests,
    transportMode: preferences.transportMode,
  });
}

function logItineraryResponseSelection(
  preferences: PlannerPreferences,
  itinerary: GeneratedItinerary
): void {
  console.log("/api/itinerary selected attractions:", {
    finalAttractions: itinerary.items.map((item) => item.attraction.name),
    finalPrimaryCategories: itinerary.items.map(
      (item) => item.attraction.primary_category ?? item.attraction.category
    ),
    maxStops: preferences.maxAttractions,
    selectedInterests: preferences.interests,
    transportMode: preferences.transportMode,
  });
}

async function applyMixedModeRoute(
  itinerary: GeneratedItinerary,
  preferences: PlannerPreferences
): Promise<{ itinerary: GeneratedItinerary }> {
  const coordinates = itinerary.items
    .map((item): Coordinates => ({
      latitude: toFiniteNumber(item.attraction.latitude, 0),
      longitude: toFiniteNumber(item.attraction.longitude, 0),
    }))
    .filter(isValidCoordinates);

  if (coordinates.length < 2) {
    return {
      itinerary: {
        ...itinerary,
        routing: createInsufficientRoutingMetadata(preferences.transportMode),
        transportMode: preferences.transportMode,
      },
    };
  }

  const { routeGeometry, routing: rawRouting, legTransports, legDurationsMinutes } =
    await buildMixedModeRoute(coordinates, preferences.transportMode);

  const routing = filterRoutingMetadata(rawRouting);

  // Recalculate schedule using accurate per-leg durations and tag each item
  // with its leg transport mode (the mode used to travel TO that stop).
  const firstStartMinutes = timeToMinutes(itinerary.items[0]?.plannedStartTime ?? preferences.startTime);
  let cursorMinutes = firstStartMinutes;
  const updatedItems = itinerary.items.map((item, index) => {
    const visitDuration =
      timeToMinutes(item.plannedEndTime) - timeToMinutes(item.plannedStartTime);

    if (index === 0) {
      cursorMinutes = firstStartMinutes + visitDuration;
      return item;
    }

    const travelTime = legDurationsMinutes[index - 1] ?? item.travelTimeFromPrevious;
    const legTransport = legTransports[index - 1];
    const plannedStart = cursorMinutes + travelTime;
    const plannedEnd = plannedStart + visitDuration;
    cursorMinutes = plannedEnd;

    return {
      ...item,
      travelTimeFromPrevious: travelTime,
      legTransport,
      plannedStartTime: minutesToTime(plannedStart),
      plannedEndTime: minutesToTime(plannedEnd),
    };
  });

  const newTotalTravel = updatedItems.reduce(
    (sum, item) => sum + item.travelTimeFromPrevious,
    0
  );
  const newTotalVisit = updatedItems.reduce(
    (sum, item) =>
      sum +
      timeToMinutes(item.plannedEndTime) -
      timeToMinutes(item.plannedStartTime),
    0
  );

  const updatedItinerary: GeneratedItinerary = {
    ...itinerary,
    items: updatedItems,
    totalTravelTime: newTotalTravel,
    totalVisitTime: newTotalVisit,
    totalDuration: newTotalTravel + newTotalVisit,
    routeGeometry,
    routing,
    transportMode: preferences.transportMode,
  };

  return { itinerary: updatedItinerary };
}

function filterRoutingMetadata(routing: RoutingMetadata): RoutingMetadata {
  if (process.env.NODE_ENV === "development") {
    return routing;
  }

  return {
    geometryPointCount: routing.geometryPointCount,
    provider: routing.provider,
    transport: routing.transport,
    ...(routing.legs ? { legs: routing.legs } : {}),
    ...(routing.hasMixedModes ? { hasMixedModes: true } : {}),
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

function minutesToTime(value: number): string {
  const minutesInDay = 24 * 60;
  const normalized = ((value % minutesInDay) + minutesInDay) % minutesInDay;
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
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

function windowlessSetTimeout(
  handler: () => void,
  timeoutMilliseconds: number
): ReturnType<typeof setTimeout> {
  return setTimeout(handler, timeoutMilliseconds);
}
