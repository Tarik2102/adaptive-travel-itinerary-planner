import {
  buildRoutingMetadata,
  getRoute,
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
  const originalLegMinutes = items[affectedLegIndex].travelTimeFromPrevious;
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

  let maxTime = -1;
  let maxIndex = 1;

  for (let i = 1; i < items.length; i++) {
    if (items[i].travelTimeFromPrevious > maxTime) {
      maxTime = items[i].travelTimeFromPrevious;
      maxIndex = i;
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
      `Moderate simulated traffic delay added ${delayMinutes} minutes between ${fromStop} and ${toStop}.`,
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
        `Heavy simulated traffic delay added ${delayMinutes} minutes between ${fromStop} and ${toStop}.`,
        "The itinerary remains feasible despite the delay.",
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
      `Heavy simulated traffic delay added ${delayMinutes} minutes between ${fromStop} and ${toStop}.`,
      "An adapted itinerary is available. Choose whether to switch.",
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

  const adaptation: ItineraryAdaptation = {
    applied: true,
    reasons: [
      `Simulated traffic blockage detected between ${fromStop} and ${toStop}.`,
      "The itinerary was automatically updated because the current route is blocked.",
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

  const newTotalTravelTime = newItems.reduce(
    (sum, item) => sum + item.travelTimeFromPrevious,
    0
  );
  const newTotalVisitTime = newItems.reduce(
    (sum, item) =>
      sum +
      (timeToMinutes(item.plannedEndTime) -
        timeToMinutes(item.plannedStartTime)),
    0
  );
  const newTotalDuration = newTotalTravelTime + newTotalVisitTime;
  const availableDuration =
    timeToMinutes(preferences.endTime) - timeToMinutes(preferences.startTime);
  const newFeasibilityStatus: FeasibilityStatus =
    newItems.length === 0
      ? "infeasible"
      : newTotalDuration <= availableDuration
        ? "feasible"
        : "partial";

  const { routeGeometry, routing } = await recomputeRouteForItems(
    newItems,
    preferences.transport
  );

  console.log("/api/itinerary/adapt-traffic recomputed route:", {
    newRoutePointCount: routeGeometry?.coordinates.length ?? 0,
    provider: routing?.provider ?? "none",
    newTotalDuration,
  });

  return {
    ...currentItinerary,
    items: newItems,
    totalVisitTime: newTotalVisitTime,
    totalTravelTime: newTotalTravelTime,
    totalDuration: newTotalDuration,
    feasibilityStatus: newFeasibilityStatus,
    routeGeometry,
    routing,
  };
}

async function recomputeRouteForItems(
  items: ItineraryItem[],
  transport: string
): Promise<{ routeGeometry: RouteGeometry | undefined; routing: RoutingMetadata | undefined }> {
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
    return { routeGeometry: undefined, routing: undefined };
  }

  try {
    const route = await getRoute(coordinates, {
      includeGeometry: true,
      transport: transport === "driving" ? "driving" : "walking",
    });
    const routing = buildRoutingMetadata(route);

    return {
      routeGeometry: route.routeGeometry,
      routing,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.warn("/api/itinerary/adapt-traffic route recompute failed:", message);
    return { routeGeometry: undefined, routing: undefined };
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
