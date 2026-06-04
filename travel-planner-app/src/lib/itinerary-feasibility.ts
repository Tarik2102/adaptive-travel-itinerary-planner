import { createEmptyAdaptation, SARAJEVO_COORDINATES } from "@/lib/adaptation";
import {
  calculateHaversineDistanceKm,
  estimateDrivingTimeMinutes,
  estimateWalkingTimeMinutes,
  getRoute,
  type Coordinates,
} from "@/lib/routing";
import type { Attraction } from "@/types/attraction";
import type {
  GeneratedItinerary,
  ItineraryAdaptation,
  RankedAttraction,
  RemovedAttraction,
} from "@/types/itinerary";
import type { PlannerPreferences, TransportMode } from "@/types/preference";

export type ItineraryCandidate = {
  attraction: Attraction;
  rank: RankedAttraction;
};

export type RouteOrderingOptions = {
  transportMode: TransportMode;
  startLocation?: Coordinates;
};

type OrderedCandidate = {
  candidate: ItineraryCandidate;
  originalIndex: number;
};

type RouteAwareScoredCandidate = OrderedCandidate & {
  baseScore: number;
  exceedsHardLimit: boolean;
  exceedsSoftLimit: boolean;
  fitsWindow: boolean;
  selectionScore: number;
  travelContributionMinutes: number;
  travelMinutes: number;
  visitDuration: number;
};

type RouteAwareSelectionDiagnostics = {
  penalizedLongLegs: string[];
  skippedLongWalkingLegs: string[];
};

type RouteAwareSelectionResult = {
  candidates: ItineraryCandidate[];
  diagnostics: RouteAwareSelectionDiagnostics;
};

type TravelTimeCache = Map<string, number>;

type FeasibilityAdaptationResult = {
  itinerary: GeneratedItinerary;
  adaptation: ItineraryAdaptation;
};

const REMOVAL_REASON =
  "Removed lowest-score attraction to keep itinerary feasible.";
const WALKING_SOFT_LEG_LIMIT_MIN = 30;
const WALKING_HARD_LEG_LIMIT_MIN = 45;
const DRIVING_SOFT_LEG_LIMIT_MIN = 35;
const DRIVING_HARD_LEG_LIMIT_MIN = 60;
const ROUTE_AWARE_LOG_LIMIT = 8;

export async function adaptItineraryFeasibility(
  preferences: PlannerPreferences,
  candidates: ItineraryCandidate[]
): Promise<FeasibilityAdaptationResult> {
  const availableDuration = getAvailableDurationMinutes(preferences);
  const routeAwareSelection = selectRouteAwareCandidates(preferences, candidates);
  const remainingCandidates = routeAwareSelection.candidates.slice();
  const removedAttractions: RemovedAttraction[] = [];
  let itinerary = await buildScheduledItinerary(
    preferences,
    remainingCandidates
  );

  if (itinerary.items.length === 0) {
    logRouteAwareSelection(
      preferences,
      itinerary,
      routeAwareSelection.diagnostics
    );

    return {
      itinerary: {
        ...itinerary,
        feasibilityStatus: "infeasible",
      },
      adaptation: createEmptyAdaptation({
        feasibilityStatus: "not_feasible",
      }),
    };
  }

  if (itinerary.totalDuration <= availableDuration) {
    logRouteAwareSelection(
      preferences,
      itinerary,
      routeAwareSelection.diagnostics
    );

    return {
      itinerary: {
        ...itinerary,
        feasibilityStatus: "feasible",
      },
      adaptation: createEmptyAdaptation({
        feasibilityStatus: "feasible",
      }),
    };
  }

  while (
    itinerary.totalDuration > availableDuration &&
    remainingCandidates.length > 1
  ) {
    const removalIndex = findLowestScoreCandidateIndex(remainingCandidates);
    const removedCandidate = remainingCandidates.splice(removalIndex, 1)[0];

    removedAttractions.push({
      id: removedCandidate.attraction.id,
      name: removedCandidate.attraction.name,
      reason: REMOVAL_REASON,
    });

    itinerary = await buildScheduledItinerary(preferences, remainingCandidates);
  }

  const adjustedSuccessfully =
    itinerary.items.length > 0 && itinerary.totalDuration <= availableDuration;
  const adaptation = createEmptyAdaptation({
    applied: removedAttractions.length > 0,
    reasons: removedAttractions.length > 0 ? [REMOVAL_REASON] : [],
    ...(removedAttractions.length > 0 ? { removedAttractions } : {}),
    feasibilityStatus: adjustedSuccessfully ? "adjusted" : "not_feasible",
  });

  logRouteAwareSelection(
    preferences,
    itinerary,
    routeAwareSelection.diagnostics
  );

  return {
    itinerary: {
      ...itinerary,
      feasibilityStatus: adjustedSuccessfully ? "feasible" : "infeasible",
    },
    adaptation,
  };
}

export async function buildScheduledItinerary(
  preferences: PlannerPreferences,
  candidates: ItineraryCandidate[]
): Promise<GeneratedItinerary> {
  const startMinutes = timeToMinutes(preferences.startTime);
  const availableDuration = getAvailableDurationMinutes(preferences);
  const selectedCandidates = candidates.slice(0, preferences.maxAttractions);
  const startLocation = getPreferenceStartLocation(preferences);
  const travelTimeCache: TravelTimeCache = new Map();
  const orderedCandidates = await orderStopsByNearestNeighborWithCache(
    selectedCandidates,
    {
      transportMode: preferences.transportMode,
      ...(startLocation ? { startLocation } : {}),
    },
    travelTimeCache
  );
  const items: GeneratedItinerary["items"] = [];
  let totalVisitTime = 0;
  let totalTravelTime = 0;
  let cursorMinutes = startMinutes;
  let previousLocation: Coordinates | null = startLocation ?? null;
  const routeLegTravelTimes = await getRouteLegTravelTimesMinutes(
    orderedCandidates,
    startLocation ?? null,
    preferences.transportMode
  );

  for (const [index, candidate] of orderedCandidates.entries()) {
    const currentLocation = getAttractionCoordinates(candidate.attraction);
    const travelTimeFromPrevious = previousLocation
      ? getTravelTimeFromRouteLegs(routeLegTravelTimes, index, !!startLocation)
      : 0;
    const plannedStartMinutes = cursorMinutes + travelTimeFromPrevious;
    const visitDuration = normalizeVisitDuration(
      candidate.attraction.estimated_visit_duration
    );
    const plannedEndMinutes = plannedStartMinutes + visitDuration;

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
    previousLocation = currentLocation;
  }

  const totalDuration = calculateTotalItineraryDuration(
    totalVisitTime,
    totalTravelTime
  );

  return {
    items,
    totalVisitTime,
    totalTravelTime,
    totalDuration,
    feasibilityStatus:
      items.length === 0
        ? "infeasible"
        : totalDuration <= availableDuration
          ? "feasible"
          : "partial",
  };
}

export async function orderStopsByNearestNeighbor(
  candidates: ItineraryCandidate[],
  options: RouteOrderingOptions
): Promise<ItineraryCandidate[]> {
  return orderStopsByNearestNeighborWithCache(candidates, options, new Map());
}

export function calculateDistanceKm(
  from: Coordinates,
  to: Coordinates
): number {
  return calculateHaversineDistanceKm(from, to);
}

export function calculateTotalItineraryDuration(
  totalVisitTime: number,
  totalTravelTime: number
): number {
  return totalVisitTime + totalTravelTime;
}

function selectRouteAwareCandidates(
  preferences: PlannerPreferences,
  candidates: ItineraryCandidate[]
): RouteAwareSelectionResult {
  const remainingCandidates: OrderedCandidate[] = candidates.map(
    (candidate, originalIndex) => ({
      candidate,
      originalIndex,
    })
  );
  const selectedCandidates: ItineraryCandidate[] = [];
  const diagnostics: RouteAwareSelectionDiagnostics = {
    penalizedLongLegs: [],
    skippedLongWalkingLegs: [],
  };
  const availableDuration = getAvailableDurationMinutes(preferences);
  let currentLocation = getRouteAwareStartLocation(preferences);
  let currentStopName = getRouteAwareStartName(preferences);
  let hasPreviousSelectedStop = hasValidPreferenceStartLocation(preferences);
  let selectedDuration = 0;

  while (
    selectedCandidates.length < preferences.maxAttractions &&
    remainingCandidates.length > 0
  ) {
    const scoredCandidates = scoreRouteAwareCandidates(
      remainingCandidates,
      currentLocation,
      preferences,
      availableDuration,
      selectedDuration,
      hasPreviousSelectedStop
    );
    const windowFeasibleCandidates = scoredCandidates.some(
      (candidate) => candidate.fitsWindow
    )
      ? scoredCandidates.filter((candidate) => candidate.fitsWindow)
      : scoredCandidates;
    const routeFeasibleCandidates = getRouteFeasibleCandidates(
      windowFeasibleCandidates,
      preferences.transportMode,
      diagnostics,
      currentStopName
    );
    const bestCandidate = routeFeasibleCandidates.reduce(
      findBetterRouteAwareCandidate
    );

    if (bestCandidate.exceedsSoftLimit) {
      recordDiagnostic(
        diagnostics.penalizedLongLegs,
        formatLegDiagnostic(
          currentStopName,
          bestCandidate.candidate.attraction.name,
          bestCandidate.travelMinutes,
          preferences.transportMode
        )
      );
    }

    selectedCandidates.push(bestCandidate.candidate);
    selectedDuration +=
      bestCandidate.travelContributionMinutes + bestCandidate.visitDuration;
    currentLocation = getAttractionCoordinates(bestCandidate.candidate.attraction);
    currentStopName = bestCandidate.candidate.attraction.name;
    hasPreviousSelectedStop = true;
    remainingCandidates.splice(
      remainingCandidates.findIndex(
        (candidate) => candidate.originalIndex === bestCandidate.originalIndex
      ),
      1
    );
  }

  return {
    candidates: selectedCandidates,
    diagnostics,
  };
}

function scoreRouteAwareCandidates(
  candidates: OrderedCandidate[],
  currentLocation: Coordinates,
  preferences: PlannerPreferences,
  availableDuration: number,
  selectedDuration: number,
  hasPreviousSelectedStop: boolean
): RouteAwareScoredCandidate[] {
  return candidates.map((candidate) => {
    const travelMinutes = estimateTravelTimeMinutes(
      calculateDistanceKm(
        currentLocation,
        getAttractionCoordinates(candidate.candidate.attraction)
      ),
      preferences.transportMode
    );
    const visitDuration = normalizeVisitDuration(
      candidate.candidate.attraction.estimated_visit_duration
    );
    const travelContributionMinutes = hasPreviousSelectedStop
      ? travelMinutes
      : 0;
    const routeAssessment = getRoutePenaltyAssessment(
      travelMinutes,
      preferences.transportMode
    );
    const fitsWindow =
      selectedDuration + travelContributionMinutes + visitDuration <=
      availableDuration;
    const windowPenalty = fitsWindow ? 0 : 0.45;
    const baseScore = getCandidateSelectionBaseScore(candidate.candidate);

    return {
      ...candidate,
      baseScore,
      exceedsHardLimit: routeAssessment.exceedsHardLimit,
      exceedsSoftLimit: routeAssessment.exceedsSoftLimit,
      fitsWindow,
      selectionScore: baseScore - routeAssessment.penalty - windowPenalty,
      travelContributionMinutes,
      travelMinutes,
      visitDuration,
    };
  });
}

function getRouteFeasibleCandidates(
  candidates: RouteAwareScoredCandidate[],
  transportMode: TransportMode,
  diagnostics: RouteAwareSelectionDiagnostics,
  currentStopName: string
): RouteAwareScoredCandidate[] {
  if (transportMode !== "walking") {
    return candidates;
  }

  const compactWalkingCandidates = candidates.filter(
    (candidate) => !candidate.exceedsHardLimit
  );

  if (compactWalkingCandidates.length === 0) {
    return candidates;
  }

  // Walking itineraries should feel walkable, not just mathematically possible
  // inside an all-day window, so very long legs are skipped when compact
  // alternatives exist.
  candidates
    .filter((candidate) => candidate.exceedsHardLimit)
    .forEach((candidate) => {
      recordDiagnostic(
        diagnostics.skippedLongWalkingLegs,
        formatLegDiagnostic(
          currentStopName,
          candidate.candidate.attraction.name,
          candidate.travelMinutes,
          transportMode
        )
      );
    });

  return compactWalkingCandidates;
}

function findBetterRouteAwareCandidate(
  bestCandidate: RouteAwareScoredCandidate,
  candidate: RouteAwareScoredCandidate
): RouteAwareScoredCandidate {
  if (candidate.selectionScore > bestCandidate.selectionScore) {
    return candidate;
  }

  if (candidate.selectionScore < bestCandidate.selectionScore) {
    return bestCandidate;
  }

  if (candidate.travelMinutes < bestCandidate.travelMinutes) {
    return candidate;
  }

  if (candidate.travelMinutes > bestCandidate.travelMinutes) {
    return bestCandidate;
  }

  return candidate.originalIndex < bestCandidate.originalIndex
    ? candidate
    : bestCandidate;
}

function getCandidateSelectionBaseScore(candidate: ItineraryCandidate): number {
  const attraction = candidate.attraction;
  const qualityScore = normalizeTenPointScore(attraction.data_quality_score);
  const popularityScore = normalizeTenPointScore(attraction.popularity_score);
  const ratingScore =
    attraction.rating === null
      ? 0
      : clamp(toFiniteNumber(attraction.rating, 0), 0, 5) / 5;
  const featuredBonus = attraction.is_featured ? 0.08 : 0;

  return (
    candidate.rank.score * 0.72 +
    qualityScore * 0.12 +
    popularityScore * 0.06 +
    ratingScore * 0.04 +
    featuredBonus
  );
}

function getRoutePenaltyAssessment(
  travelMinutes: number,
  transportMode: TransportMode
): {
  exceedsHardLimit: boolean;
  exceedsSoftLimit: boolean;
  penalty: number;
} {
  const limits = getTransportLegLimits(transportMode);

  if (travelMinutes <= limits.softLimit) {
    return {
      exceedsHardLimit: false,
      exceedsSoftLimit: false,
      penalty: 0,
    };
  }

  const softRange = Math.max(1, limits.hardLimit - limits.softLimit);
  const softOverage = Math.min(travelMinutes, limits.hardLimit) - limits.softLimit;
  const hardOverage = Math.max(0, travelMinutes - limits.hardLimit);

  // Driving can reasonably connect farther Sarajevo POIs, so its penalty ramps
  // more gently than walking and does not skip hard-limit legs.
  const penalty =
    transportMode === "walking"
      ? (softOverage / softRange) * 0.25 +
        (hardOverage / limits.hardLimit) * 0.9
      : (softOverage / softRange) * 0.12 +
        (hardOverage / limits.hardLimit) * 0.35;

  return {
    exceedsHardLimit: travelMinutes > limits.hardLimit,
    exceedsSoftLimit: true,
    penalty,
  };
}

function getTransportLegLimits(transportMode: TransportMode): {
  hardLimit: number;
  softLimit: number;
} {
  return transportMode === "walking"
    ? {
        hardLimit: WALKING_HARD_LEG_LIMIT_MIN,
        softLimit: WALKING_SOFT_LEG_LIMIT_MIN,
      }
    : {
        hardLimit: DRIVING_HARD_LEG_LIMIT_MIN,
        softLimit: DRIVING_SOFT_LEG_LIMIT_MIN,
      };
}

function estimateTravelTimeMinutes(
  distanceKm: number,
  transportMode: TransportMode
): number {
  return transportMode === "walking"
    ? estimateWalkingTimeMinutes(distanceKm)
    : estimateDrivingTimeMinutes(distanceKm);
}

function getRouteAwareStartLocation(
  preferences: PlannerPreferences
): Coordinates {
  return getPreferenceStartLocation(preferences) ?? SARAJEVO_COORDINATES;
}

function getRouteAwareStartName(preferences: PlannerPreferences): string {
  return hasValidPreferenceStartLocation(preferences)
    ? "selected start location"
    : "Sarajevo center";
}

function hasValidPreferenceStartLocation(preferences: PlannerPreferences): boolean {
  return getPreferenceStartLocation(preferences) !== undefined;
}

function logRouteAwareSelection(
  preferences: PlannerPreferences,
  itinerary: GeneratedItinerary,
  diagnostics: RouteAwareSelectionDiagnostics
): void {
  console.log("Route-aware itinerary selection:", {
    approximateTravelMinutesBetweenStops:
      getApproximateTravelMinutesBetweenStops(
        itinerary.items.map((item) => item.attraction),
        preferences.transportMode
      ),
    interests: preferences.interests,
    penalizedLongLegs: diagnostics.penalizedLongLegs,
    selectedAttractions: itinerary.items.map((item) => item.attraction.name),
    skippedLongWalkingLegs: diagnostics.skippedLongWalkingLegs,
    transportMode: preferences.transportMode,
  });
}

function getApproximateTravelMinutesBetweenStops(
  attractions: Attraction[],
  transportMode: TransportMode
): number[] {
  return attractions.slice(1).map((attraction, index) =>
    estimateTravelTimeMinutes(
      calculateDistanceKm(
        getAttractionCoordinates(attractions[index]),
        getAttractionCoordinates(attraction)
      ),
      transportMode
    )
  );
}

function formatLegDiagnostic(
  fromName: string,
  toName: string,
  travelMinutes: number,
  transportMode: TransportMode
): string {
  return `${fromName} -> ${toName}: ${travelMinutes} min ${transportMode}`;
}

function recordDiagnostic(diagnostics: string[], message: string): void {
  if (
    diagnostics.length >= ROUTE_AWARE_LOG_LIMIT ||
    diagnostics.includes(message)
  ) {
    return;
  }

  diagnostics.push(message);
}

function normalizeTenPointScore(value: number | undefined): number {
  if (value === undefined) {
    return 0;
  }

  return clamp(toFiniteNumber(value, 0), 0, 10) / 10;
}

async function orderStopsByNearestNeighborWithCache(
  candidates: ItineraryCandidate[],
  options: RouteOrderingOptions,
  travelTimeCache: TravelTimeCache
): Promise<ItineraryCandidate[]> {
  const remainingCandidates: OrderedCandidate[] = candidates.map(
    (candidate, originalIndex) => ({
      candidate,
      originalIndex,
    })
  );

  if (remainingCandidates.length === 0) {
    return [];
  }

  const orderedCandidates: ItineraryCandidate[] = [];
  let currentLocation = getValidStartLocation(options.startLocation);

  if (!currentLocation) {
    const startIndex = findHighestScoreOrderedCandidateIndex(
      remainingCandidates
    );
    const [startCandidate] = remainingCandidates.splice(startIndex, 1);
    orderedCandidates.push(startCandidate.candidate);
    currentLocation = getAttractionCoordinates(startCandidate.candidate.attraction);
  }

  while (remainingCandidates.length > 0) {
    const nearestIndex = await findNearestOrderedCandidateIndex(
      currentLocation,
      remainingCandidates,
      options.transportMode,
      travelTimeCache
    );
    const [nextCandidate] = remainingCandidates.splice(nearestIndex, 1);
    orderedCandidates.push(nextCandidate.candidate);
    currentLocation = getAttractionCoordinates(nextCandidate.candidate.attraction);
  }

  return orderedCandidates;
}

function findHighestScoreOrderedCandidateIndex(
  candidates: OrderedCandidate[]
): number {
  return candidates.reduce((highestIndex, candidate, index) => {
    const highestCandidate = candidates[highestIndex];

    if (candidate.candidate.rank.score > highestCandidate.candidate.rank.score) {
      return index;
    }

    if (
      candidate.candidate.rank.score ===
        highestCandidate.candidate.rank.score &&
      candidate.originalIndex < highestCandidate.originalIndex
    ) {
      return index;
    }

    return highestIndex;
  }, 0);
}

async function findNearestOrderedCandidateIndex(
  currentLocation: Coordinates,
  candidates: OrderedCandidate[],
  transportMode: TransportMode,
  travelTimeCache: TravelTimeCache
): Promise<number> {
  const candidateTravelTimes = await Promise.all(
    candidates.map(async (candidate, index) => ({
      index,
      travelTime: await calculateTravelTimeMinutes(
        currentLocation,
        getAttractionCoordinates(candidate.candidate.attraction),
        transportMode,
        travelTimeCache
      ),
    }))
  );

  return candidateTravelTimes.reduce((nearestIndex, candidateTravelTime) => {
    const nearestTravelTime = candidateTravelTimes[nearestIndex];

    if (
      isCloserOrderedCandidate(
        candidateTravelTime,
        nearestTravelTime,
        candidates
      )
    ) {
      return candidateTravelTime.index;
    }

    return nearestIndex;
  }, 0);
}

function isCloserOrderedCandidate(
  candidateTravelTime: { index: number; travelTime: number },
  nearestTravelTime: { index: number; travelTime: number },
  candidates: OrderedCandidate[]
): boolean {
  if (candidateTravelTime.travelTime < nearestTravelTime.travelTime) {
    return true;
  }

  if (candidateTravelTime.travelTime > nearestTravelTime.travelTime) {
    return false;
  }

  const candidate = candidates[candidateTravelTime.index];
  const nearest = candidates[nearestTravelTime.index];

  if (candidate.candidate.rank.score > nearest.candidate.rank.score) {
    return true;
  }

  if (candidate.candidate.rank.score < nearest.candidate.rank.score) {
    return false;
  }

  return candidate.originalIndex < nearest.originalIndex;
}

function findLowestScoreCandidateIndex(candidates: ItineraryCandidate[]): number {
  return candidates.reduce((lowestIndex, candidate, index) => {
    const lowestCandidate = candidates[lowestIndex];

    if (candidate.rank.score < lowestCandidate.rank.score) {
      return index;
    }

    if (
      candidate.rank.score === lowestCandidate.rank.score &&
      index > lowestIndex
    ) {
      return index;
    }

    return lowestIndex;
  }, 0);
}

async function calculateTravelTimeMinutes(
  from: Coordinates,
  to: Coordinates,
  transportMode: TransportMode,
  travelTimeCache: TravelTimeCache
): Promise<number> {
  const cacheKey = getTravelTimeCacheKey(from, to, transportMode);
  const cachedTravelTime = travelTimeCache.get(cacheKey);

  if (cachedTravelTime !== undefined) {
    return cachedTravelTime;
  }

  const travelTime = estimateLocalTravelTimeMinutes(
    calculateDistanceKm(from, to),
    transportMode
  );

  travelTimeCache.set(cacheKey, travelTime);
  return travelTime;
}

async function getRouteLegTravelTimesMinutes(
  orderedCandidates: ItineraryCandidate[],
  startLocation: Coordinates | null,
  transportMode: TransportMode
): Promise<number[]> {
  const attractionCoordinates = orderedCandidates.map((candidate) =>
    getAttractionCoordinates(candidate.attraction)
  );
  const routeCoordinates = startLocation
    ? [startLocation, ...attractionCoordinates]
    : attractionCoordinates;

  if (routeCoordinates.length < 2) {
    return [];
  }

  const fallbackLegTravelTimes = getFallbackLegTravelTimesMinutes(
    routeCoordinates,
    transportMode
  );
  const route = await getRoute(routeCoordinates, {
    includeGeometry: false,
    transport: transportMode,
  });
  const expectedLegCount = routeCoordinates.length - 1;

  const legDurationsSeconds = route.legDurationsSeconds ?? [];

  if (legDurationsSeconds.length >= expectedLegCount) {
    return legDurationsSeconds
      .slice(0, expectedLegCount)
      .map((durationSeconds) => Math.max(0, Math.round(durationSeconds / 60)));
  }

  return fallbackLegTravelTimes;
}

function getFallbackLegTravelTimesMinutes(
  coordinates: Coordinates[],
  transportMode: TransportMode
): number[] {
  return coordinates.slice(1).map((coordinate, index) =>
    estimateLocalTravelTimeMinutes(
      calculateDistanceKm(coordinates[index], coordinate),
      transportMode
    )
  );
}

function getTravelTimeFromRouteLegs(
  routeLegTravelTimes: number[],
  itemIndex: number,
  hasStartLocation: boolean
): number {
  const legIndex = hasStartLocation ? itemIndex : itemIndex - 1;

  if (legIndex < 0) {
    return 0;
  }

  return routeLegTravelTimes[legIndex] ?? 0;
}

function estimateLocalTravelTimeMinutes(
  distanceKm: number,
  transportMode: TransportMode
): number {
  if (transportMode === "walking") {
    const averageWalkingSpeedKmH = 4.5;
    return Math.round((distanceKm / averageWalkingSpeedKmH) * 60);
  }

  const urbanDrivingSpeedKmH = 25;
  return Math.max(1, Math.round((distanceKm / urbanDrivingSpeedKmH) * 60));
}

function getTravelTimeCacheKey(
  from: Coordinates,
  to: Coordinates,
  transportMode: TransportMode
): string {
  return [
    transportMode,
    from.latitude.toFixed(6),
    from.longitude.toFixed(6),
    to.latitude.toFixed(6),
    to.longitude.toFixed(6),
  ].join(":");
}

function getPreferenceStartLocation(
  preferences: PlannerPreferences
): Coordinates | undefined {
  return getValidStartLocation(preferences.startLocation);
}

function getValidStartLocation(
  startLocation: Coordinates | undefined
): Coordinates | undefined {
  if (!startLocation) {
    return undefined;
  }

  if (!isValidCoordinates(startLocation)) {
    return undefined;
  }

  return startLocation;
}

function getAttractionCoordinates(attraction: Attraction): Coordinates {
  return {
    latitude: toFiniteNumber(attraction.latitude, 0),
    longitude: toFiniteNumber(attraction.longitude, 0),
  };
}

function isValidCoordinates(coordinates: Coordinates): boolean {
  return (
    Number.isFinite(coordinates.latitude) &&
    Number.isFinite(coordinates.longitude) &&
    coordinates.latitude >= -90 &&
    coordinates.latitude <= 90 &&
    coordinates.longitude >= -180 &&
    coordinates.longitude <= 180
  );
}

function getAvailableDurationMinutes(preferences: PlannerPreferences): number {
  return timeToMinutes(preferences.endTime) - timeToMinutes(preferences.startTime);
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
