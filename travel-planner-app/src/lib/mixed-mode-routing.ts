import {
  calculateHaversineDistanceKm,
  getLegTransportMode,
  getRoute,
  type Coordinates,
  type RouteLeg,
  type RoutingMetadata,
  type RoutingProvider,
  type RoutingTransport,
} from "@/lib/routing";
import type { Coordinate, RouteGeometry } from "@/types/itinerary";

export type MixedModeRouteResult = {
  routeGeometry: RouteGeometry | undefined;
  routing: RoutingMetadata;
  legTransports: RoutingTransport[];
  legDurationsMinutes: number[];
};

export async function buildMixedModeRoute(
  coordinates: Coordinates[],
  preferredTransport: RoutingTransport
): Promise<MixedModeRouteResult> {
  if (coordinates.length < 2) {
    return {
      routeGeometry: undefined,
      routing: {
        provider: "fallback",
        transport: preferredTransport,
        geometryPointCount: 0,
      },
      legTransports: [],
      legDurationsMinutes: [],
    };
  }

  const legCount = coordinates.length - 1;
  const legTransports: RoutingTransport[] = [];
  const legDurationsMinutes: number[] = [];
  const legs: RouteLeg[] = [];
  const allCoords: Coordinate[] = [];
  let overallProvider: RoutingProvider = "openrouteservice";
  let hasMixedModes = false;

  for (let i = 0; i < legCount; i++) {
    const from = coordinates[i];
    const to = coordinates[i + 1];
    const legMode = getLegTransportMode(from, to, preferredTransport);
    const distKm = calculateHaversineDistanceKm(from, to);

    legTransports.push(legMode);
    if (legMode !== preferredTransport) hasMixedModes = true;

    // geometryStartOffset = index in allCoords where this leg starts
    // (equals last index of previous leg, which is the shared junction point)
    const geometryStartOffset = allCoords.length === 0 ? 0 : allCoords.length - 1;

    let travelMinutes: number;
    let legCoords: Coordinate[];

    try {
      const route = await getRoute([from, to], {
        includeGeometry: true,
        transport: legMode,
      });

      if (route.provider === "fallback") {
        overallProvider = "fallback";
      } else if (route.provider === "osrm" && overallProvider !== "fallback") {
        overallProvider = "osrm";
      }

      travelMinutes = route.travelTimeMinutes;
      legCoords = route.routeGeometry?.coordinates ?? [
        { lat: from.latitude, lng: from.longitude },
        { lat: to.latitude, lng: to.longitude },
      ];
    } catch {
      overallProvider = "fallback";
      travelMinutes =
        legMode === "walking"
          ? Math.round((distKm / 4.5) * 60)
          : Math.max(1, Math.round((distKm / 25) * 60));
      legCoords = [
        { lat: from.latitude, lng: from.longitude },
        { lat: to.latitude, lng: to.longitude },
      ];
    }

    // Skip the first coordinate of every leg after the first — it is identical
    // to the last coordinate of the previous leg (the junction stop).
    const coordsToAdd = allCoords.length === 0 ? legCoords : legCoords.slice(1);
    allCoords.push(...coordsToAdd);

    legDurationsMinutes.push(travelMinutes);
    legs.push({
      fromIndex: i,
      toIndex: i + 1,
      transport: legMode,
      distanceKm: distKm,
      durationMinutes: travelMinutes,
      geometryStartOffset,
    });

    console.log(`Mixed-mode leg ${i}:`, {
      distanceKm: distKm.toFixed(3),
      legMode,
      preferredTransport,
      travelMinutes,
    });
  }

  console.log("Mixed-mode route summary:", {
    drivingLegs: legs.filter((l) => l.transport === "driving").length,
    hasMixedModes,
    legCount,
    preferredTransport,
    provider: overallProvider,
    totalPoints: allCoords.length,
    walkingLegs: legs.filter((l) => l.transport === "walking").length,
  });

  return {
    routeGeometry:
      allCoords.length >= 2 ? { coordinates: allCoords } : undefined,
    routing: {
      provider: overallProvider,
      transport: preferredTransport,
      geometryPointCount: allCoords.length,
      legs,
      ...(hasMixedModes ? { hasMixedModes: true } : {}),
    },
    legTransports,
    legDurationsMinutes,
  };
}
