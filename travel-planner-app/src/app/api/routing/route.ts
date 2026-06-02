import { NextResponse } from "next/server";
import { z } from "zod";
import { getRoute, getRouteTime } from "@/lib/routing";
import type {
  Coordinates,
  RoutingResponse,
  RoutingTransport,
} from "@/lib/routing";

const coordinateSchema = z
  .object({
    latitude: z.coerce.number().min(-90).max(90).optional(),
    longitude: z.coerce.number().min(-180).max(180).optional(),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
  })
  .transform((value, context): Coordinates => {
    const latitude = value.latitude ?? value.lat;
    const longitude = value.longitude ?? value.lng;

    if (latitude === undefined || longitude === undefined) {
      context.addIssue({
        code: "custom",
        message: "Each coordinate must include latitude/longitude or lat/lng",
      });

      return z.NEVER;
    }

    return { latitude, longitude };
  });

const routingRequestSchema = z.object({
  coordinates: z.array(coordinateSchema).min(1),
  transport: z.enum(["walking", "driving"]).optional(),
  profile: z.enum(["driving", "walking", "foot", "bike"]).optional(),
});

export async function GET() {
  try {
    const bascarsija = {
      latitude: 43.859,
      longitude: 18.4317,
    };

    const cityHall = {
      latitude: 43.858,
      longitude: 18.4345,
    };

    const transport: RoutingTransport = "driving";
    const travelTime = await getRouteTime(bascarsija, cityHall, transport);
    const route = await fetchRouteForDemo(bascarsija, cityHall);

    return NextResponse.json({
      success: true,
      from: "Bascarsija",
      to: "Sarajevo City Hall",
      ...(route
        ? serializeRoutingResponse(route)
        : { transport, travelTimeMinutes: travelTime }),
    });
  } catch (error) {
    console.error("Routing error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Failed to calculate route",
      },
      { status: 500 }
    );
  }
}

async function fetchRouteForDemo(from: Coordinates, to: Coordinates) {
  try {
    return await getRoute([from, to], {
      includeGeometry: true,
      transport: "driving",
    });
  } catch (error) {
    console.error("Route geometry error:", error);
    return null;
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

  const parsedRequest = routingRequestSchema.safeParse(body);

  if (!parsedRequest.success) {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid routing request",
        details: parsedRequest.error.issues.map((issue) => issue.message),
      },
      { status: 400 }
    );
  }

  const { coordinates, profile } = parsedRequest.data;
  const transport =
    parsedRequest.data.transport ?? profileToTransport(profile);

  try {
    const route = await getRoute(coordinates, {
      includeGeometry: true,
      transport,
    });

    return NextResponse.json({
      success: true,
      ...serializeRoutingResponse(route),
    });
  } catch (error) {
    console.error("Routing error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Failed to calculate route",
      },
      { status: 502 }
    );
  }
}

function profileToTransport(profile: string | undefined): RoutingTransport {
  return profile === "walking" || profile === "foot" ? "walking" : "driving";
}

function serializeRoutingResponse(route: RoutingResponse) {
  const { fallbackReason, ...publicRoute } = route;

  return {
    ...publicRoute,
    ...(process.env.NODE_ENV === "development" && fallbackReason
      ? { fallbackReason }
      : {}),
  };
}
