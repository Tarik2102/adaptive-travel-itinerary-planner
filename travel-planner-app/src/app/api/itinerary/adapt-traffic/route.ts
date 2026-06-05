import { NextResponse } from "next/server";
import { z } from "zod";
import {
  adaptTrafficItinerary,
  type TrafficAdaptPreferences,
} from "@/lib/traffic-adaptation";
import type { GeneratedItinerary } from "@/types/itinerary";

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

const trafficSimulationSchema = z.object({
  enabled: z.boolean(),
  severity: z.enum(["moderate", "heavy", "blocked"]),
  affectedLegIndex: z
    .union([z.number().int().min(0), z.literal("auto")])
    .default("auto"),
  delayMinutes: z.number().int().positive().optional(),
});

const attractionSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    category: z.string(),
    latitude: z.union([z.number(), z.string()]),
    longitude: z.union([z.number(), z.string()]),
    estimated_visit_duration: z.number(),
  })
  .passthrough();

const itineraryItemSchema = z.object({
  attraction: attractionSchema,
  score: z.number(),
  reason: z.string(),
  plannedStartTime: z.string(),
  plannedEndTime: z.string(),
  travelTimeFromPrevious: z.number(),
  legTransport: z.enum(["walking", "driving"]).optional(),
});

const generatedItinerarySchema = z
  .object({
    items: z.array(itineraryItemSchema),
    totalVisitTime: z.number(),
    totalTravelTime: z.number(),
    totalDuration: z.number(),
    feasibilityStatus: z.enum(["feasible", "partial", "infeasible"]),
    transportMode: z.string().optional(),
  })
  .passthrough();

const preferencesSchema = z
  .object({
    interests: z.array(z.string()),
    transport: z.string(),
    startTime: z.string().regex(timePattern, "Start time must use HH:MM format"),
    endTime: z.string().regex(timePattern, "End time must use HH:MM format"),
    maxStops: z.number().int().min(1).optional(),
  })
  .refine(
    (p) => timeToMinutes(p.endTime) > timeToMinutes(p.startTime),
    { message: "End time must be later than start time", path: ["endTime"] }
  );

const adaptTrafficRequestSchema = z.object({
  currentItinerary: generatedItinerarySchema,
  preferences: preferencesSchema,
  trafficSimulation: trafficSimulationSchema,
});

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON request body" },
      { status: 400 }
    );
  }

  const parsed = adaptTrafficRequestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid adapt-traffic request",
        details: parsed.error.issues.map((issue) => issue.message),
      },
      { status: 400 }
    );
  }

  const { currentItinerary, preferences, trafficSimulation } = parsed.data;

  const adaptPreferences: TrafficAdaptPreferences = {
    transport: preferences.transport,
    startTime: preferences.startTime,
    endTime: preferences.endTime,
    interests: preferences.interests,
  };

  try {
    const result = await adaptTrafficItinerary(
      currentItinerary as GeneratedItinerary,
      adaptPreferences,
      trafficSimulation
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error("adapt-traffic error:", error);
    return NextResponse.json(
      { error: "Failed to adapt itinerary for traffic simulation" },
      { status: 500 }
    );
  }
}

function timeToMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}
