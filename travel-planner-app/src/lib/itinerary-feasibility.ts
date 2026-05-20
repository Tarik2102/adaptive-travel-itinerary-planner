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
  const items: GeneratedItinerary["items"] = [];
  let totalVisitTime = 0;
  let totalTravelTime = 0;
  let cursorMinutes = startMinutes;
  let previousAttraction: Attraction | null = null;

  for (const candidate of candidates.slice(0, preferences.maxAttractions)) {
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

  const totalDuration = totalVisitTime + totalTravelTime;

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
