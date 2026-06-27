import { buildMixedModeRoute } from "@/lib/mixed-mode-routing";
import {
  getLiveLegTraffic,
  TRAFFIC_DELAY_FACTOR_THRESHOLD,
  TRAFFIC_DELAY_SECONDS_THRESHOLD,
} from "@/lib/live-traffic";
import {
  type Coordinates,
  type RoutingMetadata,
} from "@/lib/routing";
import { optimizeItemOrderByProximity } from "@/lib/stop-order-optimizer";
import type {
  AdaptationFeasibilityStatus,
  FeasibilityStatus,
  GeneratedItinerary,
  ItineraryAdaptation,
  ItineraryItem,
  RouteGeometry,
  TrafficAdaptResponse,
  TrafficSimulationInfo,
  TrafficSimulationRequest,
  TrafficSimulationStatus,
} from "@/types/itinerary";

export type TrafficAdaptPreferences = {
  transport: string;
  startTime: string;
  endTime: string;
  interests?: string[];
};

export async function adaptTrafficItinerary(
  currentItinerary: GeneratedItinerary,
  preferences: TrafficAdaptPreferences,
  simulation: TrafficSimulationRequest
): Promise<TrafficAdaptResponse> {
  console.log("/api/itinerary/adapt-traffic request received:", {
    transport: preferences.transport,
    severity: simulation.severity,
    affectedLegRequest: simulation.affectedLegIndex,
    stopCount: currentItinerary.items.length,
  });

  if (preferences.transport !== "driving") {
    console.log("/api/itinerary/adapt-traffic: skipped — transport is not driving");
    return buildWalkingResponse(currentItinerary, simulation);
  }

  const items = currentItinerary.items;

  if (items.length < 2) {
    console.log("/api/itinerary/adapt-traffic: skipped — fewer than 2 stops");
    return buildNoEffectResponse(currentItinerary, simulation);
  }

  const affectedLegIndex = chooseAffectedTrafficLeg(items, simulation);
  const affectedItem = items[affectedLegIndex];

  if (affectedItem.legTransport === "walking") {
    console.log("/api/itinerary/adapt-traffic: leg is walking — traffic simulation skipped", {
      affectedLegIndex,
      fromStop: affectedLegIndex > 0 ? items[affectedLegIndex - 1].attraction.name : "Starting point",
      toStop: affectedItem.attraction.name,
    });
    return buildWalkingLegResponse(currentItinerary, simulation, affectedLegIndex, items);
  }

  const originalLegMinutes = affectedItem.travelTimeFromPrevious;
  const delayMinutes = getTrafficDelayMinutes(simulation, originalLegMinutes);
  const simulatedLegMinutes = originalLegMinutes + delayMinutes;
  const fromStop =
    affectedLegIndex > 0
      ? items[affectedLegIndex - 1].attraction.name
      : "Starting point";
  const toStop = items[affectedLegIndex].attraction.name;
  const availableDuration =
    timeToMinutes(preferences.endTime) - timeToMinutes(preferences.startTime);

  console.log("/api/itinerary/adapt-traffic leg info:", {
    affectedLegIndex,
    fromStop,
    toStop,
    originalLegMinutes,
    delayMinutes,
    availableDuration,
    currentTotalDuration: currentItinerary.totalDuration,
  });

  // Live traffic path — fetch real data from TomTom and auto-classify.
  if (simulation.source === "live") {
    return await handleLive(
      currentItinerary,
      preferences,
      simulation,
      affectedLegIndex,
      fromStop,
      toStop,
      originalLegMinutes,
      availableDuration
    );
  }

  const trafficSimBase = buildTrafficSimInfo(
    simulation,
    affectedLegIndex,
    fromStop,
    toStop,
    originalLegMinutes,
    simulatedLegMinutes,
    delayMinutes,
    "delayed_but_feasible"
  );

  if (simulation.severity === "moderate") {
    return handleModerate(
      currentItinerary,
      affectedLegIndex,
      delayMinutes,
      fromStop,
      toStop,
      availableDuration,
      trafficSimBase
    );
  }

  if (simulation.severity === "heavy") {
    return handleHeavy(
      currentItinerary,
      preferences,
      affectedLegIndex,
      delayMinutes,
      fromStop,
      toStop,
      availableDuration,
      trafficSimBase
    );
  }

  return await handleBlocked(
    currentItinerary,
    preferences,
    affectedLegIndex,
    fromStop,
    toStop,
    trafficSimBase
  );
}

async function handleLive(
  currentItinerary: GeneratedItinerary,
  preferences: TrafficAdaptPreferences,
  simulation: TrafficSimulationRequest,
  affectedLegIndex: number,
  fromStop: string,
  toStop: string,
  originalLegMinutes: number,
  availableDuration: number
): Promise<TrafficAdaptResponse> {
  const items = currentItinerary.items;
  const startItem = items[affectedLegIndex - 1];
  const endItem = items[affectedLegIndex];

  const liveTraffic = await getLiveLegTraffic(
    {
      lat: Number(startItem.attraction.latitude),
      lng: Number(startItem.attraction.longitude),
    },
    {
      lat: Number(endItem.attraction.latitude),
      lng: Number(endItem.attraction.longitude),
    }
  );

  // Null means key is missing or TomTom returned an error — fall back to simulation.
  if (!liveTraffic) {
    console.log("/api/itinerary/adapt-traffic live: TomTom unavailable, falling back to simulation");
    const fallbackSim: TrafficSimulationRequest = { ...simulation, source: "simulation" };
    const delayMinutes = getTrafficDelayMinutes(fallbackSim, originalLegMinutes);
    const simulatedLegMinutes = originalLegMinutes + delayMinutes;
    const trafficSimBase = buildTrafficSimInfo(
      fallbackSim,
      affectedLegIndex,
      fromStop,
      toStop,
      originalLegMinutes,
      simulatedLegMinutes,
      delayMinutes,
      "delayed_but_feasible"
    );
    const result = await dispatchSimulation(
      currentItinerary,
      preferences,
      fallbackSim,
      affectedLegIndex,
      delayMinutes,
      fromStop,
      toStop,
      availableDuration,
      trafficSimBase
    );
    // Attach fallbackReason to the adaptation so the caller can surface it.
    return patchFallbackReason(result, "live_traffic_unavailable");
  }

  const isSignificant =
    liveTraffic.delayFactor >= TRAFFIC_DELAY_FACTOR_THRESHOLD ||
    liveTraffic.trafficDelaySeconds >= TRAFFIC_DELAY_SECONDS_THRESHOLD;

  if (!isSignificant) {
    console.log("/api/itinerary/adapt-traffic live: delay below threshold — no_effect", {
      delayFactor: liveTraffic.delayFactor,
      trafficDelaySeconds: liveTraffic.trafficDelaySeconds,
    });
    const trafficSim: TrafficSimulationInfo = {
      enabled: true,
      severity: simulation.severity,
      affectedLegIndex,
      affectedSegment: { from: fromStop, to: toStop },
      originalLegTravelTime: originalLegMinutes,
      simulatedLegTravelTime: originalLegMinutes,
      addedDelayMinutes: 0,
      status: "no_effect",
    };
    return {
      trafficDecisionRequired: false,
      itinerary: currentItinerary,
      adaptation: {
        applied: false,
        reasons: [
          `Live traffic check: current delay is ${Math.round(liveTraffic.trafficDelaySeconds / 60)} min (factor ${liveTraffic.delayFactor.toFixed(2)}×) — below threshold, no change needed.`,
        ],
        feasibilityStatus: toAdaptFeasibilityStatus(currentItinerary.feasibilityStatus),
        trafficSimulation: trafficSim,
      },
    };
  }

  const delayMinutes = Math.ceil(liveTraffic.trafficDelaySeconds / 60);
  const simulatedLegMinutes = originalLegMinutes + delayMinutes;
  const trafficSimBase = buildTrafficSimInfo(
    simulation,
    affectedLegIndex,
    fromStop,
    toStop,
    originalLegMinutes,
    simulatedLegMinutes,
    delayMinutes,
    "delayed_but_feasible"
  );

  console.log("/api/itinerary/adapt-traffic live: significant delay", {
    delayFactor: liveTraffic.delayFactor.toFixed(2),
    trafficDelaySeconds: liveTraffic.trafficDelaySeconds,
    delayMinutes,
  });

  const newTotalDuration = currentItinerary.totalDuration + delayMinutes;

  if (newTotalDuration <= availableDuration) {
    // Feasible with real delay — apply it like moderate simulation.
    const liveResult = handleModerate(
      currentItinerary,
      affectedLegIndex,
      delayMinutes,
      fromStop,
      toStop,
      availableDuration,
      trafficSimBase
    );
    // Stamp live traffic data onto the affected item.
    return stampLiveTrafficOnItem(liveResult, affectedLegIndex, liveTraffic);
  }

  // Infeasible — reuse heavy decision flow (user chooses stay or reoptimize).
  return await handleHeavy(
    currentItinerary,
    preferences,
    affectedLegIndex,
    delayMinutes,
    fromStop,
    toStop,
    availableDuration,
    trafficSimBase
  );
}

function dispatchSimulation(
  currentItinerary: GeneratedItinerary,
  preferences: TrafficAdaptPreferences,
  simulation: TrafficSimulationRequest,
  affectedLegIndex: number,
  delayMinutes: number,
  fromStop: string,
  toStop: string,
  availableDuration: number,
  trafficSimBase: TrafficSimulationInfo
): Promise<TrafficAdaptResponse> {
  if (simulation.severity === "moderate") {
    return Promise.resolve(
      handleModerate(currentItinerary, affectedLegIndex, delayMinutes, fromStop, toStop, availableDuration, trafficSimBase)
    );
  }
  if (simulation.severity === "heavy") {
    return handleHeavy(currentItinerary, preferences, affectedLegIndex, delayMinutes, fromStop, toStop, availableDuration, trafficSimBase);
  }
  return handleBlocked(currentItinerary, preferences, affectedLegIndex, fromStop, toStop, trafficSimBase);
}

function patchFallbackReason(
  result: TrafficAdaptResponse,
  fallbackReason: string
): TrafficAdaptResponse {
  if (result.trafficDecisionRequired) {
    return {
      ...result,
      adaptation: { ...result.adaptation, fallbackReason },
    };
  }
  return {
    ...result,
    adaptation: { ...result.adaptation, fallbackReason },
  };
}

function stampLiveTrafficOnItem(
  result: TrafficAdaptResponse,
  affectedLegIndex: number,
  liveTraffic: { liveSeconds: number; baselineSeconds: number; trafficDelaySeconds: number; delayFactor: number }
): TrafficAdaptResponse {
  if (result.trafficDecisionRequired) return result;
  const items = result.itinerary.items.map((item, idx) => {
    if (idx !== affectedLegIndex) return item;
    return {
      ...item,
      liveTravelTimeSec: liveTraffic.liveSeconds,
      baselineTravelTimeSec: liveTraffic.baselineSeconds,
      trafficDelaySec: liveTraffic.trafficDelaySeconds,
      delayFactor: liveTraffic.delayFactor,
      trafficSource: "tomtom" as const,
    };
  });
  return {
    ...result,
    itinerary: { ...result.itinerary, items },
  };
}

export function chooseAffectedTrafficLeg(
  items: ItineraryItem[],
  simulation: TrafficSimulationRequest
): number {
  if (
    typeof simulation.affectedLegIndex === "number" &&
    simulation.affectedLegIndex >= 1 &&
    simulation.affectedLegIndex < items.length
  ) {
    return simulation.affectedLegIndex;
  }

  // Auto-select the longest driving leg. Walking legs are not affected by traffic.
  let maxTime = -1;
  let maxIndex = 1;

  for (let i = 1; i < items.length; i++) {
    if (items[i].legTransport === "walking") continue;
    if (items[i].travelTimeFromPrevious > maxTime) {
      maxTime = items[i].travelTimeFromPrevious;
      maxIndex = i;
    }
  }

  // If no driving legs found, fall back to longest leg overall.
  if (maxTime === -1) {
    for (let i = 1; i < items.length; i++) {
      if (items[i].travelTimeFromPrevious > maxTime) {
        maxTime = items[i].travelTimeFromPrevious;
        maxIndex = i;
      }
    }
  }

  return maxIndex;
}

export function getTrafficDelayMinutes(
  simulation: TrafficSimulationRequest,
  originalLegMinutes: number
): number {
  if (simulation.delayMinutes !== undefined && simulation.delayMinutes > 0) {
    return simulation.delayMinutes;
  }

  switch (simulation.severity) {
    case "moderate":
      return Math.max(15, Math.round(originalLegMinutes * 0.5));
    case "heavy":
      return Math.max(35, Math.round(originalLegMinutes * 1.25));
    case "blocked":
      return Math.max(75, Math.round(originalLegMinutes * 3));
  }
}

function handleModerate(
  currentItinerary: GeneratedItinerary,
  affectedLegIndex: number,
  delayMinutes: number,
  fromStop: string,
  toStop: string,
  availableDuration: number,
  trafficSimBase: TrafficSimulationInfo
): TrafficAdaptResponse {
  const updatedItems = applyDelayToItems(
    currentItinerary.items,
    affectedLegIndex,
    delayMinutes
  );
  const newTotalTravelTime = currentItinerary.totalTravelTime + delayMinutes;
  const newTotalDuration = currentItinerary.totalDuration + delayMinutes;
  const newFeasibilityStatus: FeasibilityStatus =
    newTotalDuration <= availableDuration ? "feasible" : "partial";

  const trafficSim: TrafficSimulationInfo = {
    ...trafficSimBase,
    status: "delayed_but_feasible",
  };

  const adaptation: ItineraryAdaptation = {
    applied: true,
    reasons: [
      `Traffic detected on route to ${toStop}: +${delayMinutes} min delay applied (${originalLegMinutes} min → ${simulatedLegMinutes} min).`,
      `Route checked — current path is still the best available option.`,
    ],
    feasibilityStatus: toAdaptFeasibilityStatus(newFeasibilityStatus),
    trafficSimulation: trafficSim,
  };

  console.log("/api/itinerary/adapt-traffic moderate result:", {
    delayMinutes,
    newTotalDuration,
    feasibilityStatus: newFeasibilityStatus,
    decisionRequired: false,
  });

  return {
    trafficDecisionRequired: false,
    itinerary: {
      ...currentItinerary,
      items: updatedItems,
      totalTravelTime: newTotalTravelTime,
      totalDuration: newTotalDuration,
      feasibilityStatus: newFeasibilityStatus,
    },
    adaptation,
  };
}

async function handleHeavy(
  currentItinerary: GeneratedItinerary,
  preferences: TrafficAdaptPreferences,
  affectedLegIndex: number,
  delayMinutes: number,
  fromStop: string,
  toStop: string,
  availableDuration: number,
  trafficSimBase: TrafficSimulationInfo
): Promise<TrafficAdaptResponse> {
  const updatedItems = applyDelayToItems(
    currentItinerary.items,
    affectedLegIndex,
    delayMinutes
  );
  const newTotalTravelTime = currentItinerary.totalTravelTime + delayMinutes;
  const newTotalDuration = currentItinerary.totalDuration + delayMinutes;
  const newFeasibilityStatus: FeasibilityStatus =
    newTotalDuration <= availableDuration ? "feasible" : "partial";

  const delayedItinerary: GeneratedItinerary = {
    ...currentItinerary,
    items: updatedItems,
    totalTravelTime: newTotalTravelTime,
    totalDuration: newTotalDuration,
    feasibilityStatus: newFeasibilityStatus,
  };

  if (newTotalDuration <= availableDuration) {
    const trafficSim: TrafficSimulationInfo = {
      ...trafficSimBase,
      status: "heavy_delay_feasible",
    };
    const adaptation: ItineraryAdaptation = {
      applied: true,
      reasons: [
        `Heavy traffic on route from ${fromStop} to ${toStop}: +${delayMinutes} min delay applied (${trafficSimBase.originalLegTravelTime} min → ${trafficSimBase.simulatedLegTravelTime} min).`,
        `Route checked — current path is still the best available option. Itinerary remains feasible within your time window.`,
      ],
      feasibilityStatus: "adjusted",
      trafficSimulation: trafficSim,
    };

    console.log("/api/itinerary/adapt-traffic heavy feasible:", {
      delayMinutes,
      newTotalDuration,
      decisionRequired: false,
    });

    return {
      trafficDecisionRequired: false,
      itinerary: delayedItinerary,
      adaptation,
    };
  }

  const proposedItinerary = await buildAdaptedItineraryByRemoval(
    currentItinerary,
    affectedLegIndex,
    preferences
  );

  const trafficSimDecision: TrafficSimulationInfo = {
    ...trafficSimBase,
    status: "heavy_delay_feasible",
  };

  const adaptation: ItineraryAdaptation = {
    applied: false,
    reasons: [
      `Heavy traffic on route from ${fromStop} to ${toStop}: +${delayMinutes} min delay (${trafficSimBase.originalLegTravelTime} min → ${trafficSimBase.simulatedLegTravelTime} min).`,
      `This delay makes the itinerary infeasible. An adapted route is available — choose to stay on the delayed route or switch to the re-optimized itinerary.`,
    ],
    feasibilityStatus: toAdaptFeasibilityStatus(proposedItinerary.feasibilityStatus),
    trafficSimulation: trafficSimDecision,
  };

  console.log("/api/itinerary/adapt-traffic heavy decision required:", {
    delayMinutes,
    newTotalDuration,
    proposedTotalDuration: proposedItinerary.totalDuration,
    removedStop: proposedItinerary.items.length < currentItinerary.items.length,
    decisionRequired: true,
  });

  return {
    trafficDecisionRequired: true,
    currentItinerary: delayedItinerary,
    proposedItinerary,
    adaptation,
  };
}

async function handleBlocked(
  currentItinerary: GeneratedItinerary,
  preferences: TrafficAdaptPreferences,
  affectedLegIndex: number,
  fromStop: string,
  toStop: string,
  trafficSimBase: TrafficSimulationInfo
): Promise<TrafficAdaptResponse> {
  const adaptedItinerary = await buildAdaptedItineraryByRemoval(
    currentItinerary,
    affectedLegIndex,
    preferences
  );

  const trafficSim: TrafficSimulationInfo = {
    ...trafficSimBase,
    status: "blocked_reoptimized",
    addedDelayMinutes: 0,
    simulatedLegTravelTime: trafficSimBase.originalLegTravelTime,
  };

  const removedStopNames = currentItinerary.items
    .filter((item) => !adaptedItinerary.items.some((ai) => ai.attraction.id === item.attraction.id))
    .map((item) => item.attraction.name);

  const removalNote = removedStopNames.length > 0
    ? ` ${removedStopNames.join(", ")} removed to free up time.`
    : "";

  const adaptation: ItineraryAdaptation = {
    applied: true,
    reasons: [
      `Route blocked between ${fromStop} and ${toStop}.`,
      `Itinerary re-optimized (stops reordered):${removalNote} Remaining stops rerouted for best available path.`,
    ],
    feasibilityStatus: toAdaptFeasibilityStatus(adaptedItinerary.feasibilityStatus),
    trafficSimulation: trafficSim,
  };

  console.log("/api/itinerary/adapt-traffic blocked auto-update:", {
    fromStop,
    toStop,
    affectedLegIndex,
    adaptedStopCount: adaptedItinerary.items.length,
    adaptedTotalDuration: adaptedItinerary.totalDuration,
    decisionRequired: false,
  });

  return {
    trafficDecisionRequired: false,
    itinerary: adaptedItinerary,
    adaptation,
  };
}

async function buildAdaptedItineraryByRemoval(
  currentItinerary: GeneratedItinerary,
  affectedLegIndex: number,
  preferences: TrafficAdaptPreferences
): Promise<GeneratedItinerary> {
  const items = currentItinerary.items;

  if (items.length <= 1) {
    return currentItinerary;
  }

  const removeIndex = chooseRemovalIndex(items, affectedLegIndex);

  console.log("/api/itinerary/adapt-traffic removed stop:", {
    removedStop: items[removeIndex].attraction.name,
    removeIndex,
    oldStopCount: items.length,
    newStopCount: items.length - 1,
    oldRoutePointCount: currentItinerary.routeGeometry?.coordinates.length ?? 0,
  });

  // Remove the stop (raw splice, travel times not yet corrected).
  const spliced = [
    ...items.slice(0, removeIndex),
    ...items.slice(removeIndex + 1),
  ];

  // Re-order remaining stops by proximity so blocked adaptation doesn't leave
  // an inefficient route. optimizeItemOrderByProximity recalculates
  // travelTimeFromPrevious via haversine for the new ordering.
  const reordered = optimizeItemOrderByProximity(spliced, preferences.transport);

  // Rebuild planned times using the new travel times.
  const newItems = recalculateSchedule(reordered);

  const availableDuration =
    timeToMinutes(preferences.endTime) - timeToMinutes(preferences.startTime);

  const { routeGeometry, routing, legTransports, legDurationsMinutes } =
    await recomputeRouteForItems(newItems, preferences.transport);

  // Apply accurate per-leg durations and transport modes from the new route.
  const firstStartMinutes =
    timeToMinutes(newItems[0]?.plannedStartTime ?? "09:00") -
    newItems[0].travelTimeFromPrevious;
  let cursorMinutes = firstStartMinutes;
  const finalItems = newItems.map((item, index) => {
    const visitDuration =
      timeToMinutes(item.plannedEndTime) - timeToMinutes(item.plannedStartTime);
    if (index === 0) {
      cursorMinutes = timeToMinutes(item.plannedStartTime) + visitDuration;
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

  const finalTravelTime = finalItems.reduce(
    (sum, item) => sum + item.travelTimeFromPrevious,
    0
  );
  const finalVisitTime = finalItems.reduce(
    (sum, item) =>
      sum + timeToMinutes(item.plannedEndTime) - timeToMinutes(item.plannedStartTime),
    0
  );
  const finalDuration = finalTravelTime + finalVisitTime;
  const finalFeasibilityStatus: FeasibilityStatus =
    finalItems.length === 0
      ? "infeasible"
      : finalDuration <= availableDuration
        ? "feasible"
        : "partial";

  console.log("/api/itinerary/adapt-traffic recomputed route:", {
    newRoutePointCount: routeGeometry?.coordinates.length ?? 0,
    provider: routing?.provider ?? "none",
    newTotalDuration: finalDuration,
  });

  return {
    ...currentItinerary,
    items: finalItems,
    totalVisitTime: finalVisitTime,
    totalTravelTime: finalTravelTime,
    totalDuration: finalDuration,
    feasibilityStatus: finalFeasibilityStatus,
    routeGeometry,
    routing,
  };
}

async function recomputeRouteForItems(
  items: ItineraryItem[],
  transport: string
): Promise<{
  routeGeometry: RouteGeometry | undefined;
  routing: RoutingMetadata | undefined;
  legTransports: Array<"walking" | "driving">;
  legDurationsMinutes: number[];
}> {
  const coordinates: Coordinates[] = items
    .map((item) => ({
      latitude: Number(item.attraction.latitude),
      longitude: Number(item.attraction.longitude),
    }))
    .filter(
      (c) =>
        Number.isFinite(c.latitude) &&
        Number.isFinite(c.longitude) &&
        !(c.latitude === 0 && c.longitude === 0) &&
        c.latitude >= -90 &&
        c.latitude <= 90 &&
        c.longitude >= -180 &&
        c.longitude <= 180
    );

  if (coordinates.length < 2) {
    return { routeGeometry: undefined, routing: undefined, legTransports: [], legDurationsMinutes: [] };
  }

  try {
    const preferredTransport = transport === "driving" ? "driving" : "walking";
    const result = await buildMixedModeRoute(coordinates, preferredTransport);

    return {
      routeGeometry: result.routeGeometry,
      routing: result.routing,
      legTransports: result.legTransports,
      legDurationsMinutes: result.legDurationsMinutes,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.warn("/api/itinerary/adapt-traffic route recompute failed:", message);
    return { routeGeometry: undefined, routing: undefined, legTransports: [], legDurationsMinutes: [] };
  }
}

function chooseRemovalIndex(
  items: ItineraryItem[],
  affectedLegIndex: number
): number {
  const fromIndex = affectedLegIndex - 1;
  const toIndex = affectedLegIndex;

  if (fromIndex <= 0) {
    return toIndex;
  }

  const fromScore = items[fromIndex].score;
  const toScore = items[toIndex].score;

  return fromScore < toScore ? fromIndex : toIndex;
}

function recalculateSchedule(items: ItineraryItem[]): ItineraryItem[] {
  if (items.length === 0) return [];

  const startMinutes =
    timeToMinutes(items[0].plannedStartTime) -
    items[0].travelTimeFromPrevious;
  const result: ItineraryItem[] = [];
  let cursor = startMinutes;

  for (const item of items) {
    const visitDuration = getItemVisitDuration(item);
    const plannedStart = cursor + item.travelTimeFromPrevious;
    const plannedEnd = plannedStart + visitDuration;

    result.push({
      ...item,
      plannedStartTime: minutesToTime(plannedStart),
      plannedEndTime: minutesToTime(plannedEnd),
    });

    cursor = plannedEnd;
  }

  return result;
}

function applyDelayToItems(
  items: ItineraryItem[],
  affectedLegIndex: number,
  delayMinutes: number
): ItineraryItem[] {
  const updated = items.map((item, index) => {
    if (index !== affectedLegIndex) return item;

    return {
      ...item,
      travelTimeFromPrevious: item.travelTimeFromPrevious + delayMinutes,
    };
  });

  return recalculateSchedule(updated);
}

function buildTrafficSimInfo(
  simulation: TrafficSimulationRequest,
  affectedLegIndex: number,
  fromStop: string,
  toStop: string,
  originalLegMinutes: number,
  simulatedLegMinutes: number,
  delayMinutes: number,
  status: TrafficSimulationStatus
): TrafficSimulationInfo {
  return {
    enabled: true,
    severity: simulation.severity,
    affectedLegIndex,
    affectedSegment: { from: fromStop, to: toStop },
    originalLegTravelTime: originalLegMinutes,
    simulatedLegTravelTime: simulatedLegMinutes,
    addedDelayMinutes: delayMinutes,
    status,
  };
}

function buildWalkingResponse(
  currentItinerary: GeneratedItinerary,
  simulation: TrafficSimulationRequest
): TrafficAdaptResponse {
  return {
    trafficDecisionRequired: false,
    itinerary: currentItinerary,
    adaptation: {
      applied: false,
      reasons: [
        "Traffic simulation applies only to driving routes and was ignored.",
      ],
      feasibilityStatus: toAdaptFeasibilityStatus(
        currentItinerary.feasibilityStatus
      ),
      trafficSimulation: {
        enabled: false,
        severity: simulation.severity,
        affectedLegIndex: 0,
        affectedSegment: { from: "", to: "" },
        originalLegTravelTime: 0,
        simulatedLegTravelTime: 0,
        addedDelayMinutes: 0,
        status: "ignored",
      },
    },
  };
}

function buildWalkingLegResponse(
  currentItinerary: GeneratedItinerary,
  simulation: TrafficSimulationRequest,
  affectedLegIndex: number,
  items: ItineraryItem[]
): TrafficAdaptResponse {
  const fromStop =
    affectedLegIndex > 0
      ? items[affectedLegIndex - 1].attraction.name
      : "Starting point";
  const toStop = items[affectedLegIndex].attraction.name;

  return {
    trafficDecisionRequired: false,
    itinerary: currentItinerary,
    adaptation: {
      applied: false,
      reasons: [
        `Traffic simulation applies only to driving legs. The segment from ${fromStop} to ${toStop} is a walking segment and was not affected.`,
      ],
      feasibilityStatus: toAdaptFeasibilityStatus(
        currentItinerary.feasibilityStatus
      ),
      trafficSimulation: {
        enabled: true,
        severity: simulation.severity,
        affectedLegIndex,
        affectedSegment: { from: fromStop, to: toStop },
        originalLegTravelTime: items[affectedLegIndex].travelTimeFromPrevious,
        simulatedLegTravelTime: items[affectedLegIndex].travelTimeFromPrevious,
        addedDelayMinutes: 0,
        status: "ignored",
      },
    },
  };
}

function buildNoEffectResponse(
  currentItinerary: GeneratedItinerary,
  simulation: TrafficSimulationRequest
): TrafficAdaptResponse {
  return {
    trafficDecisionRequired: false,
    itinerary: currentItinerary,
    adaptation: {
      applied: false,
      reasons: ["Not enough stops to simulate a traffic event."],
      feasibilityStatus: toAdaptFeasibilityStatus(
        currentItinerary.feasibilityStatus
      ),
      trafficSimulation: {
        enabled: true,
        severity: simulation.severity,
        affectedLegIndex: 0,
        affectedSegment: { from: "", to: "" },
        originalLegTravelTime: 0,
        simulatedLegTravelTime: 0,
        addedDelayMinutes: 0,
        status: "no_effect",
      },
    },
  };
}

function toAdaptFeasibilityStatus(
  status: FeasibilityStatus
): AdaptationFeasibilityStatus {
  if (status === "feasible") return "feasible";
  if (status === "partial") return "adjusted";
  return "not_feasible";
}

function getItemVisitDuration(item: ItineraryItem): number {
  return (
    timeToMinutes(item.plannedEndTime) -
    timeToMinutes(item.plannedStartTime)
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
