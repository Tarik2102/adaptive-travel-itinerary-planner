import { createEmptyAdaptation } from "@/lib/adaptation";
import {
  calculateHaversineDistanceKm,
  estimateWalkingTimeMinutes,
  getOsrmRouteTime,
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

type TravelTimeCache = Map<string, number>;

type FeasibilityAdaptationResult = {
  itinerary: GeneratedItinerary;
  adaptation: ItineraryAdaptation;
};

const REMOVAL_REASON =
  "Removed lowest-score attraction to keep itinerary feasible.";

export async function adaptItineraryFeasibility(
  preferences: PlannerPreferences,
  candidates: ItineraryCandidate[]
): Promise<FeasibilityAdaptationResult> {
  const availableDuration = getAvailableDurationMinutes(preferences);
  const remainingCandidates = candidates.slice(0, preferences.maxAttractions);
  const removedAttractions: RemovedAttraction[] = [];
  let itinerary = await buildScheduledItinerary(
    preferences,
    remainingCandidates
  );

  if (itinerary.items.length === 0) {
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

  for (const candidate of orderedCandidates) {
    const currentLocation = getAttractionCoordinates(candidate.attraction);
    const travelTimeFromPrevious = previousLocation
      ? await calculateTravelTimeMinutes(
          previousLocation,
          currentLocation,
          preferences.transportMode,
          travelTimeCache
        )
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

  const travelTime =
    transportMode === "walking"
      ? estimateWalkingTimeMinutes(calculateDistanceKm(from, to))
      : await getOsrmRouteTime(from, to);

  travelTimeCache.set(cacheKey, travelTime);
  return travelTime;
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
