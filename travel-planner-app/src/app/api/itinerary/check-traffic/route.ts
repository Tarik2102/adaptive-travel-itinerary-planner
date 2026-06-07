import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getLiveLegTraffic,
  TRAFFIC_DELAY_FACTOR_THRESHOLD,
  TRAFFIC_DELAY_SECONDS_THRESHOLD,
} from "@/lib/live-traffic";
import type { GeneratedItinerary } from "@/types/itinerary";

const attractionSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    latitude: z.union([z.number(), z.string()]),
    longitude: z.union([z.number(), z.string()]),
    estimated_visit_duration: z.number(),
    category: z.string(),
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

const checkTrafficRequestSchema = z.object({
  currentItinerary: z
    .object({
      items: z.array(itineraryItemSchema),
    })
    .passthrough(),
});

export async function POST(request: Request) {
  if (!process.env.TOMTOM_API_KEY) {
    return NextResponse.json(
      { error: "Live traffic unavailable: TOMTOM_API_KEY is not configured" },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON request body" },
      { status: 400 }
    );
  }

  const parsed = checkTrafficRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid check-traffic request",
        details: parsed.error.issues.map((i) => i.message),
      },
      { status: 400 }
    );
  }

  const { currentItinerary } = parsed.data;
  const items = (currentItinerary as GeneratedItinerary).items;

  // Only check remaining driving legs (index 1+).
  const results = await Promise.all(
    items.slice(1).map(async (item, idx) => {
      const legIndex = idx + 1;
      if (item.legTransport === "walking") return null;

      const prev = items[legIndex - 1];
      const traffic = await getLiveLegTraffic(
        {
          lat: Number(prev.attraction.latitude),
          lng: Number(prev.attraction.longitude),
        },
        {
          lat: Number(item.attraction.latitude),
          lng: Number(item.attraction.longitude),
        }
      );

      if (!traffic) return null;

      return {
        legIndex,
        from: prev.attraction.name,
        to: item.attraction.name,
        delayFactor: traffic.delayFactor,
        trafficDelaySeconds: traffic.trafficDelaySeconds,
        significant:
          traffic.delayFactor >= TRAFFIC_DELAY_FACTOR_THRESHOLD ||
          traffic.trafficDelaySeconds >= TRAFFIC_DELAY_SECONDS_THRESHOLD,
      };
    })
  );

  const legResults = results.filter(Boolean) as NonNullable<
    (typeof results)[number]
  >[];

  const significantLegs = legResults.filter((r) => r.significant);
  const worstLeg = legResults.reduce(
    (worst, r) => (!worst || r.delayFactor > worst.delayFactor ? r : worst),
    null as (typeof legResults)[number] | null
  );

  return NextResponse.json({
    reoptimizationRecommended: significantLegs.length > 0,
    worstDelayFactor: worstLeg?.delayFactor ?? 1,
    affectedLegIndex: worstLeg?.legIndex ?? null,
    legs: legResults,
  });
}
