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

type LogicalSelectionContext = {
  coveredInterestCounts: Map<string, number>;
  foodCafeStopLimit: number;
  foodCafeStopsSelected: number;
  hasMultipleSelectedInterests: boolean;
  onlyFoodCafeSelected: boolean;
  previousSelectedWasFoodCafe: boolean;
  primaryCategoryCounts: Map<string, number>;
  selectedInterests: string[];
  slotInterest: string | null;
  transportMode: TransportMode;
};

type RouteAwareSelectionDiagnostics = {
  fallbackSlots: string[];
  foodCafeSlotSelections: string[];
  penalizedLongLegs: string[];
  skippedConsecutiveFoodStops: string[];
  skippedLongWalkingLegs: string[];
  slotPlan: string[];
};

type LogicalCandidatePool = {
  candidates: RouteAwareScoredCandidate[];
  foodCafeSlotDiagnostics?: {
    slotInterest: string;
    strictCandidateCount: number;
    usedBroadFoodFallback: boolean;
  };
  usedFallback: boolean;
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

type ScheduleOptions = {
  preserveCandidateOrder?: boolean;
};

const REMOVAL_REASON =
  "Removed lowest-score attraction to keep itinerary feasible.";
const WALKING_SOFT_LEG_LIMIT_MIN = 30;
const WALKING_HARD_LEG_LIMIT_MIN = 45;
const DRIVING_SOFT_LEG_LIMIT_MIN = 35;
const DRIVING_HARD_LEG_LIMIT_MIN = 60;
const ROUTE_AWARE_LOG_LIMIT = 8;

const FOOD_CAFE_LABELS = new Set([
  "bar",
  "bakery",
  "cafe",
  "coffee",
  "cuisine",
  "fast_food",
  "food",
  "local_food",
  "pub",
  "restaurant",
  "traditional_bosnian_food",
]);

const STRICT_FOOD_CAFE_CATEGORY_LABELS = new Set([
  "bakery",
  "cafe",
  "fast_food",
  "food",
  "restaurant",
]);

const STRICT_FOOD_CAFE_SECONDARY_LABELS = new Set([
  "traditional_bosnian_food",
]);

const STRICT_FOOD_CAFE_TAG_LABELS = new Set([
  "bakery",
  "burek",
  "cafe",
  "cevapi",
  "coffee",
  "cuisine",
  "fast_food",
  "restaurant",
  "traditional_bosnian_food",
]);

const FOOD_CAFE_SEARCH_TERMS = [
  "bakery",
  "bosnian food",
  "burek",
  "cafe",
  "cevapi",
  "coffee",
  "cuisine",
  "fast food",
  "food",
  "local food",
  "pastry",
  "restaurant",
  "traditional bosnian food",
];

const FOOD_CAFE_INTEREST_LABELS = new Set([
  "cafe",
  "food",
  "traditional_bosnian_food",
]);

const INTEREST_ALIASES: Record<string, string[]> = {
  architecture: [
    "architecture",
    "architectural",
    "austro hungarian",
    "building",
    "bridge",
    "city hall",
    "facade",
    "landmark",
    "monument",
  ],
  austro_hungarian_heritage: [
    "architecture",
    "austro hungarian",
    "austrian",
    "facade",
    "historic",
    "hungarian",
    "landmark",
  ],
  cafe: [
    "bakery",
    "cafe",
    "coffee",
    "dessert",
    "local food",
    "pastry",
    "restaurant",
    "tea",
  ],
  cinema: ["cinema", "film", "movie"],
  culture: [
    "arts centre",
    "cultural",
    "culture",
    "gallery",
    "heritage",
    "museum",
    "performance",
    "traditional",
  ],
  entertainment: [
    "arts centre",
    "cinema",
    "entertainment",
    "nightlife",
    "performance",
    "theatre",
  ],
  family: [
    "children",
    "family",
    "kids",
    "park",
    "playground",
    "recreation",
    "zoo",
  ],
  food: [
    "bosnian cuisine",
    "bosnian food",
    "cafe",
    "cuisine",
    "fast food",
    "food",
    "local food",
    "restaurant",
    "traditional bosnian food",
  ],
  history: [
    "austro hungarian",
    "heritage",
    "historic",
    "history",
    "memorial",
    "monument",
    "old town",
    "ottoman",
    "siege",
    "war",
  ],
  local_experience: [
    "bazaar",
    "cafe",
    "food",
    "local",
    "local market",
    "market",
    "marketplace",
    "souvenir",
    "traditional",
  ],
  modern_sarajevo: [
    "contemporary",
    "entertainment",
    "mall",
    "modern",
    "shopping",
    "urban",
  ],
  museum: ["collection", "education", "exhibition", "gallery", "museum"],
  nature: [
    "garden",
    "green space",
    "hiking",
    "mountain",
    "nature",
    "outdoor",
    "park",
    "river",
    "viewpoint",
    "walking",
  ],
  ottoman_heritage: [
    "bazaar",
    "heritage",
    "islamic",
    "mosque",
    "old town",
    "ottoman",
  ],
  park: ["garden", "green space", "outdoor", "park", "recreation"],
  religion: [
    "cathedral",
    "church",
    "islamic",
    "jewish",
    "mosque",
    "orthodox",
    "place of worship",
    "religion",
    "religious",
    "synagogue",
    "worship",
  ],
  shopping: [
    "bazaar",
    "local market",
    "mall",
    "market",
    "marketplace",
    "retail",
    "shop",
    "shopping",
    "souvenir",
  ],
  sport: [
    "fitness",
    "hiking",
    "recreation",
    "sport",
    "sports",
    "stadium",
    "swimming",
    "walking",
  ],
  theatre: ["performance", "stage", "theater", "theatre"],
  traditional_bosnian_food: [
    "bosnian cuisine",
    "bosnian food",
    "burek",
    "cevapi",
    "cuisine",
    "local food",
    "restaurant",
    "traditional bosnian food",
  ],
  viewpoint: ["lookout", "panorama", "scenic", "viewpoint"],
  war_history: [
    "battle",
    "conflict",
    "defense",
    "memorial",
    "siege",
    "tunnel",
    "war",
    "war history",
  ],
};

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
    remainingCandidates,
    { preserveCandidateOrder: true }
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
    const removalIndex = findLowestScoreCandidateIndex(
      remainingCandidates,
      preferences
    );
    const removedCandidate = remainingCandidates.splice(removalIndex, 1)[0];

    removedAttractions.push({
      id: removedCandidate.attraction.id,
      name: removedCandidate.attraction.name,
      reason: REMOVAL_REASON,
    });

    itinerary = await buildScheduledItinerary(preferences, remainingCandidates, {
      preserveCandidateOrder: true,
    });
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
  candidates: ItineraryCandidate[],
  options: ScheduleOptions = {}
): Promise<GeneratedItinerary> {
  const startMinutes = timeToMinutes(preferences.startTime);
  const availableDuration = getAvailableDurationMinutes(preferences);
  const selectedCandidates = candidates.slice(0, preferences.maxAttractions);
  const startLocation = getPreferenceStartLocation(preferences);
  const travelTimeCache: TravelTimeCache = new Map();
  const orderedCandidates = options.preserveCandidateOrder
    ? selectedCandidates
    : await orderStopsByNearestNeighborWithCache(
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
  const selectedInterests = getUniqueInterests(preferences.interests);
  const slotPlan = buildInterestSlotPlan(
    selectedInterests,
    preferences.maxAttractions,
    preferences.startTime,
    preferences.endTime
  );
  const onlyFoodCafeSelected =
    selectedInterests.length > 0 && selectedInterests.every(isFoodCafeInterest);
  const hasMultipleSelectedInterests = selectedInterests.length > 1;
  const foodCafeStopLimit = getFoodCafeStopLimit(
    preferences,
    onlyFoodCafeSelected
  );
  const remainingCandidates: OrderedCandidate[] = candidates.map(
    (candidate, originalIndex) => ({
      candidate,
      originalIndex,
    })
  );
  const selectedCandidates: ItineraryCandidate[] = [];
  const diagnostics: RouteAwareSelectionDiagnostics = {
    fallbackSlots: [],
    foodCafeSlotSelections: [],
    penalizedLongLegs: [],
    skippedConsecutiveFoodStops: [],
    skippedLongWalkingLegs: [],
    slotPlan,
  };
  const availableDuration = getAvailableDurationMinutes(preferences);
  let currentLocation = getRouteAwareStartLocation(preferences);
  let currentStopName = getRouteAwareStartName(preferences);
  let hasPreviousSelectedStop = hasValidPreferenceStartLocation(preferences);
  let selectedDuration = 0;
  let foodCafeStopsSelected = 0;
  let previousSelectedWasFoodCafe = false;
  const coveredInterestCounts = new Map<string, number>();
  const primaryCategoryCounts = new Map<string, number>();

  while (
    selectedCandidates.length < preferences.maxAttractions &&
    remainingCandidates.length > 0
  ) {
    const slotInterest =
      slotPlan[selectedCandidates.length] ??
      getFallbackSlotInterest(selectedInterests, selectedCandidates.length);
    const logicalContext: LogicalSelectionContext = {
      coveredInterestCounts,
      foodCafeStopLimit,
      foodCafeStopsSelected,
      hasMultipleSelectedInterests,
      onlyFoodCafeSelected,
      previousSelectedWasFoodCafe,
      primaryCategoryCounts,
      selectedInterests,
      slotInterest,
      transportMode: preferences.transportMode,
    };
    const scoredCandidates = scoreRouteAwareCandidates(
      remainingCandidates,
      currentLocation,
      preferences,
      availableDuration,
      selectedDuration,
      hasPreviousSelectedStop,
      logicalContext
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
    const logicalCandidatePool = getLogicalCandidatePool(
      routeFeasibleCandidates,
      logicalContext,
      diagnostics,
      currentStopName
    );
    const bestCandidate = logicalCandidatePool.candidates.reduce(
      findBetterRouteAwareCandidate
    );
    const selectedCandidate = withLogicalSelectionReason(
      bestCandidate,
      logicalContext,
      logicalCandidatePool
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

    if (logicalCandidatePool.usedFallback && slotInterest) {
      recordDiagnostic(
        diagnostics.fallbackSlots,
        `${slotInterest} -> ${bestCandidate.candidate.attraction.name}`
      );
    }

    recordFoodCafeSlotSelectionDiagnostic(
      diagnostics,
      logicalCandidatePool,
      bestCandidate
    );

    selectedCandidates.push(selectedCandidate);
    selectedDuration +=
      bestCandidate.travelContributionMinutes + bestCandidate.visitDuration;
    currentLocation = getAttractionCoordinates(bestCandidate.candidate.attraction);
    currentStopName = bestCandidate.candidate.attraction.name;
    hasPreviousSelectedStop = true;
    previousSelectedWasFoodCafe = isFoodCafeCandidate(
      bestCandidate.candidate.attraction
    );
    if (previousSelectedWasFoodCafe) {
      foodCafeStopsSelected += 1;
    }
    updateCoveredInterestCounts(
      coveredInterestCounts,
      selectedInterests,
      bestCandidate.candidate.attraction
    );
    incrementCount(
      primaryCategoryCounts,
      getPrimaryCategoryKey(bestCandidate.candidate.attraction)
    );
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
  hasPreviousSelectedStop: boolean,
  logicalContext: LogicalSelectionContext
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
    const logicalAdjustment = getLogicalSelectionScoreAdjustment(
      candidate.candidate,
      logicalContext
    );

    return {
      ...candidate,
      baseScore,
      exceedsHardLimit: routeAssessment.exceedsHardLimit,
      exceedsSoftLimit: routeAssessment.exceedsSoftLimit,
      fitsWindow,
      selectionScore:
        baseScore + logicalAdjustment - routeAssessment.penalty - windowPenalty,
      travelContributionMinutes,
      travelMinutes,
      visitDuration,
    };
  });
}

function getLogicalSelectionScoreAdjustment(
  candidate: ItineraryCandidate,
  context: LogicalSelectionContext
): number {
  const attraction = candidate.attraction;
  const slotMatchStrength = context.slotInterest
    ? getInterestMatchStrength(attraction, context.slotInterest)
    : 0;
  const matchedSelectedInterests = getMatchedSelectedInterests(
    attraction,
    context.selectedInterests
  );
  const uncoveredMatches = matchedSelectedInterests.filter(
    (interest) =>
      (context.coveredInterestCounts.get(normalizeLabel(interest)) ?? 0) === 0
  );
  const primaryCategoryCount =
    context.primaryCategoryCounts.get(getPrimaryCategoryKey(attraction)) ?? 0;
  const isFoodCafe = isFoodCafeCandidate(attraction);
  let adjustment = 0;

  if (slotMatchStrength > 0) {
    adjustment += 0.3 * slotMatchStrength;
  }

  if (matchedSelectedInterests.length > 0) {
    adjustment += 0.06 + Math.min(0.08, matchedSelectedInterests.length * 0.02);
  }

  if (context.hasMultipleSelectedInterests && uncoveredMatches.length > 0) {
    adjustment += 0.2 + Math.min(0.08, (uncoveredMatches.length - 1) * 0.04);
  }

  if (context.hasMultipleSelectedInterests && primaryCategoryCount > 0) {
    adjustment -= Math.min(0.24, primaryCategoryCount * 0.08);
  }

  if (
    !context.onlyFoodCafeSelected &&
    isFoodCafe &&
    hasSelectedFoodCafeInterest(context.selectedInterests)
  ) {
    if (context.foodCafeStopsSelected >= context.foodCafeStopLimit) {
      adjustment -= 0.7;
    }

    if (context.previousSelectedWasFoodCafe) {
      adjustment -= 0.5;
    }
  }

  return adjustment;
}

function getLogicalCandidatePool(
  candidates: RouteAwareScoredCandidate[],
  context: LogicalSelectionContext,
  diagnostics: RouteAwareSelectionDiagnostics,
  currentStopName: string
): LogicalCandidatePool {
  const eligibleCandidates = getFoodEligibleCandidates(
    candidates,
    context,
    diagnostics,
    currentStopName
  );
  const isFoodCafeSlot =
    context.slotInterest !== null && isFoodCafeInterest(context.slotInterest);

  if (isFoodCafeSlot && context.slotInterest) {
    const strictFoodCafeCandidates = eligibleCandidates.filter((candidate) =>
      isStrictFoodCafeCandidate(candidate.candidate.attraction)
    );
    const foodCafeSlotDiagnostics = {
      slotInterest: context.slotInterest,
      strictCandidateCount: strictFoodCafeCandidates.length,
      usedBroadFoodFallback: false,
    };

    if (strictFoodCafeCandidates.length > 0) {
      return {
        candidates: strictFoodCafeCandidates,
        foodCafeSlotDiagnostics,
        usedFallback: false,
      };
    }

    const broadFoodCandidates = eligibleCandidates.filter((candidate) =>
      candidateMatchesInterest(candidate.candidate, context.slotInterest)
    );

    if (broadFoodCandidates.length > 0) {
      return {
        candidates: broadFoodCandidates,
        foodCafeSlotDiagnostics: {
          ...foodCafeSlotDiagnostics,
          usedBroadFoodFallback: true,
        },
        usedFallback: true,
      };
    }
  }

  const slotCandidates = context.slotInterest
    ? eligibleCandidates.filter((candidate) =>
        candidateMatchesInterest(candidate.candidate, context.slotInterest)
      )
    : [];

  if (slotCandidates.length > 0) {
    return {
      candidates: slotCandidates,
      usedFallback: false,
    };
  }

  const selectedInterestCandidates = eligibleCandidates.filter((candidate) =>
    candidateMatchesAnySelectedInterest(
      candidate.candidate,
      context.selectedInterests
    )
  );

  if (selectedInterestCandidates.length > 0) {
    return {
      candidates: selectedInterestCandidates,
      usedFallback: context.slotInterest !== null,
    };
  }

  return {
    candidates: eligibleCandidates.length > 0 ? eligibleCandidates : candidates,
    usedFallback: context.slotInterest !== null,
  };
}

function getFoodEligibleCandidates(
  candidates: RouteAwareScoredCandidate[],
  context: LogicalSelectionContext,
  diagnostics: RouteAwareSelectionDiagnostics,
  currentStopName: string
): RouteAwareScoredCandidate[] {
  if (context.onlyFoodCafeSelected) {
    return candidates;
  }

  if (!hasSelectedFoodCafeInterest(context.selectedInterests)) {
    return candidates;
  }

  let eligibleCandidates = candidates;

  if (context.foodCafeStopsSelected >= context.foodCafeStopLimit) {
    const nonFoodCafeCandidates = eligibleCandidates.filter(
      (candidate) => !isFoodCafeCandidate(candidate.candidate.attraction)
    );

    if (nonFoodCafeCandidates.length > 0) {
      eligibleCandidates = nonFoodCafeCandidates;
    }
  }

  if (!context.previousSelectedWasFoodCafe) {
    return eligibleCandidates;
  }

  const nonConsecutiveCandidates = eligibleCandidates.filter(
    (candidate) => !isFoodCafeCandidate(candidate.candidate.attraction)
  );

  if (nonConsecutiveCandidates.length === 0) {
    return eligibleCandidates;
  }

  eligibleCandidates
    .filter((candidate) => isFoodCafeCandidate(candidate.candidate.attraction))
    .forEach((candidate) => {
      recordDiagnostic(
        diagnostics.skippedConsecutiveFoodStops,
        formatLegDiagnostic(
          currentStopName,
          candidate.candidate.attraction.name,
          candidate.travelMinutes,
          context.transportMode
        )
      );
    });

  return nonConsecutiveCandidates;
}

function withLogicalSelectionReason(
  scoredCandidate: RouteAwareScoredCandidate,
  context: LogicalSelectionContext,
  logicalCandidatePool: LogicalCandidatePool
): ItineraryCandidate {
  const candidate = scoredCandidate.candidate;
  const attraction = candidate.attraction;
  const reasonSegments: string[] = [];
  const isStrictFoodCafe = isStrictFoodCafeCandidate(attraction);
  const hasFoodCafeRelevance = isFoodCafeCandidate(attraction);
  const hasSelectedFoodCafe = hasSelectedFoodCafeInterest(
    context.selectedInterests
  );
  const usedBroadFoodFallback =
    logicalCandidatePool.foodCafeSlotDiagnostics?.usedBroadFoodFallback ?? false;
  const matchesSlot =
    context.slotInterest !== null &&
    candidateMatchesInterest(candidate, context.slotInterest);
  const uncoveredMatches = getMatchedSelectedInterests(
    attraction,
    context.selectedInterests
  ).filter(
    (interest) =>
      (context.coveredInterestCounts.get(normalizeLabel(interest)) ?? 0) === 0
  );

  if (usedBroadFoodFallback && hasFoodCafeRelevance && !isStrictFoodCafe) {
    reasonSegments.push(
      "Selected as a food-related area because no nearby restaurant/cafe candidate was feasible"
    );
  } else if (isStrictFoodCafe && hasSelectedFoodCafe) {
    reasonSegments.push(getStrictFoodCafeReason(attraction, context.slotInterest));
  } else if (
    hasSelectedFoodCafe &&
    hasFoodCafeRelevance &&
    !isStrictFoodCafe &&
    matchesSlot
  ) {
    reasonSegments.push("Selected as a cultural stop with local food relevance");
  } else if (matchesSlot && context.slotInterest) {
    reasonSegments.push(
      `Selected as a nearby ${formatInterestForReason(
        context.slotInterest
      )} stop`
    );
  } else if (logicalCandidatePool.usedFallback && context.slotInterest) {
    reasonSegments.push(
      `Selected as a feasible fallback for ${formatInterestForReason(
        context.slotInterest
      )}`
    );
  }

  if (context.hasMultipleSelectedInterests && uncoveredMatches.length > 0) {
    reasonSegments.push("Selected to balance selected interests");
  }

  if (
    context.transportMode === "walking" &&
    !scoredCandidate.exceedsSoftLimit
  ) {
    reasonSegments.push("Selected as a compact walking stop");
  }

  return {
    ...candidate,
    rank: {
      ...candidate.rank,
      reason: mergeReasonSegments(reasonSegments, candidate.rank.reason),
    },
  };
}

function recordFoodCafeSlotSelectionDiagnostic(
  diagnostics: RouteAwareSelectionDiagnostics,
  logicalCandidatePool: LogicalCandidatePool,
  selectedCandidate: RouteAwareScoredCandidate
): void {
  const foodCafeSlotDiagnostics =
    logicalCandidatePool.foodCafeSlotDiagnostics;

  if (!foodCafeSlotDiagnostics) {
    return;
  }

  recordDiagnostic(
    diagnostics.foodCafeSlotSelections,
    [
      `slot=${foodCafeSlotDiagnostics.slotInterest}`,
      `strictCandidates=${foodCafeSlotDiagnostics.strictCandidateCount}`,
      `selected=${selectedCandidate.candidate.attraction.name}`,
      `category=${getDisplayPrimaryCategory(
        selectedCandidate.candidate.attraction
      )}`,
      `fallbackBroad=${foodCafeSlotDiagnostics.usedBroadFoodFallback}`,
    ].join("; ")
  );
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

export function buildInterestSlotPlan(
  interests: string[],
  maxStops: number,
  startTime: string,
  endTime: string
): string[] {
  const selectedInterests = getUniqueInterests(interests);

  if (maxStops <= 0 || selectedInterests.length === 0) {
    return [];
  }

  const onlyFoodCafeSelected = selectedInterests.every(isFoodCafeInterest);

  if (onlyFoodCafeSelected) {
    return buildFoodOnlySlotPlan(selectedInterests, maxStops);
  }

  if (selectedInterests.length === 1) {
    return Array.from({ length: maxStops }, () => selectedInterests[0]);
  }

  const foodCafeInterests = selectedInterests.filter(isFoodCafeInterest);
  const nonFoodCafeInterests = selectedInterests.filter(
    (interest) => !isFoodCafeInterest(interest)
  );

  if (foodCafeInterests.length === 0) {
    return buildRoundRobinSlotPlan(selectedInterests, maxStops);
  }

  const foodCafeStopCount = getFoodCafeStopLimitForWindow(
    maxStops,
    startTime,
    endTime
  );
  const foodSlotPositions = getFoodSlotPositions(
    foodCafeStopCount,
    maxStops,
    startTime
  );
  const foodSlotInterests = buildFoodSlotInterests(
    foodCafeInterests,
    foodCafeStopCount
  );
  const baseInterests =
    nonFoodCafeInterests.length > 0 ? nonFoodCafeInterests : selectedInterests;
  const slotPlan: string[] = [];
  let baseIndex = 0;
  let foodIndex = 0;

  for (let index = 0; index < maxStops; index += 1) {
    if (foodSlotPositions.has(index)) {
      slotPlan.push(foodSlotInterests[foodIndex] ?? foodCafeInterests[0]);
      foodIndex += 1;
    } else {
      slotPlan.push(baseInterests[baseIndex % baseInterests.length]);
      baseIndex += 1;
    }
  }

  return slotPlan;
}

function buildFoodOnlySlotPlan(interests: string[], maxStops: number): string[] {
  const normalizedInterestLabels = new Set(interests.map(normalizeLabel));
  const foodCycle = [...interests];

  if (!normalizedInterestLabels.has("food")) {
    foodCycle.push("Food");
  }

  if (!normalizedInterestLabels.has("cafe")) {
    foodCycle.push("Cafe");
  }

  return Array.from(
    { length: maxStops },
    (_, index) => foodCycle[index % foodCycle.length]
  );
}

function buildRoundRobinSlotPlan(interests: string[], maxStops: number): string[] {
  return Array.from(
    { length: maxStops },
    (_, index) => interests[index % interests.length]
  );
}

function buildFoodSlotInterests(
  foodCafeInterests: string[],
  foodCafeStopCount: number
): string[] {
  return Array.from(
    { length: foodCafeStopCount },
    (_, index) => foodCafeInterests[index % foodCafeInterests.length]
  );
}

function getFoodSlotPositions(
  foodCafeStopCount: number,
  maxStops: number,
  startTime: string
): Set<number> {
  if (foodCafeStopCount <= 0 || maxStops <= 0) {
    return new Set();
  }

  if (foodCafeStopCount === 1) {
    return new Set([
      timeToMinutes(startTime) < 10 * 60 + 30
        ? 0
        : Math.min(maxStops - 1, Math.max(1, Math.floor(maxStops / 2))),
    ]);
  }

  return new Set([0, maxStops - 1]);
}

function getFoodCafeStopLimit(
  preferences: PlannerPreferences,
  onlyFoodCafeSelected: boolean
): number {
  if (onlyFoodCafeSelected) {
    return preferences.maxAttractions;
  }

  if (!hasSelectedFoodCafeInterest(preferences.interests)) {
    return 0;
  }

  return getFoodCafeStopLimitForWindow(
    preferences.maxAttractions,
    preferences.startTime,
    preferences.endTime
  );
}

function getFoodCafeStopLimitForWindow(
  maxStops: number,
  startTime: string,
  endTime: string
): number {
  if (maxStops <= 0) {
    return 0;
  }

  const availableDuration = timeToMinutes(endTime) - timeToMinutes(startTime);

  if (availableDuration < 4 * 60) {
    return 1;
  }

  if (availableDuration < 7 * 60) {
    return maxStops >= 6 ? 2 : 1;
  }

  const mealOpportunities = getMealOpportunityCount(startTime, endTime);
  const stopCapacity = maxStops >= 5 ? 2 : 1;

  return Math.min(2, stopCapacity, Math.max(1, mealOpportunities));
}

function getMealOpportunityCount(startTime: string, endTime: string): number {
  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);
  let opportunities = 0;

  if (startMinutes < 10 * 60 + 30) {
    opportunities += 1;
  }

  if (startMinutes < 14 * 60 + 30 && endMinutes > 12 * 60) {
    opportunities += 1;
  }

  if (endMinutes >= 18 * 60) {
    opportunities += 1;
  }

  return opportunities;
}

function getFallbackSlotInterest(
  selectedInterests: string[],
  selectedCount: number
): string | null {
  if (selectedInterests.length === 0) {
    return null;
  }

  return selectedInterests[selectedCount % selectedInterests.length];
}

function getUniqueInterests(interests: string[]): string[] {
  const uniqueInterests = new Map<string, string>();

  for (const interest of interests) {
    const trimmedInterest = interest.trim();

    if (trimmedInterest.length === 0) {
      continue;
    }

    const normalizedInterest = normalizeLabel(trimmedInterest);

    if (!uniqueInterests.has(normalizedInterest)) {
      uniqueInterests.set(normalizedInterest, trimmedInterest);
    }
  }

  return [...uniqueInterests.values()];
}

function candidateMatchesInterest(
  candidate: ItineraryCandidate,
  interest: string | null
): boolean {
  return interest !== null && getInterestMatchStrength(candidate.attraction, interest) > 0;
}

function candidateMatchesAnySelectedInterest(
  candidate: ItineraryCandidate,
  selectedInterests: string[]
): boolean {
  return getMatchedSelectedInterests(candidate.attraction, selectedInterests).length > 0;
}

function getMatchedSelectedInterests(
  attraction: Attraction,
  selectedInterests: string[]
): string[] {
  return selectedInterests.filter(
    (interest) => getInterestMatchStrength(attraction, interest) > 0
  );
}

function getInterestMatchStrength(
  attraction: Attraction,
  interest: string
): number {
  const interestLabels = expandInterestLabels(interest);
  const interestTerms = expandInterestTerms(interest);
  const primaryLabels = labelsFromValues([
    attraction.category,
    attraction.primary_category,
  ]);
  const secondaryLabels = labelsFromValues(attraction.secondary_categories ?? []);
  const tagLabels = labelsFromValues(attraction.tags ?? []);
  const searchText = getAttractionSearchText(attraction);

  if (hasSetOverlap(primaryLabels, interestLabels)) {
    return 1;
  }

  if (hasSetOverlap(secondaryLabels, interestLabels)) {
    return 0.9;
  }

  if (hasSetOverlap(tagLabels, interestLabels)) {
    return 0.8;
  }

  if ([...interestTerms].some((term) => containsSearchTerm(searchText, term))) {
    return 0.65;
  }

  return 0;
}

function isFoodCafeInterest(interest: string): boolean {
  return FOOD_CAFE_INTEREST_LABELS.has(normalizeLabel(interest));
}

function hasSelectedFoodCafeInterest(interests: string[]): boolean {
  return interests.some(isFoodCafeInterest);
}

function isFoodCafeCandidate(attraction: Attraction): boolean {
  const labels = labelsFromValues(getAttractionMetadataValues(attraction));

  if (hasSetOverlap(labels, FOOD_CAFE_LABELS)) {
    return true;
  }

  const searchText = getAttractionSearchText(attraction);

  return FOOD_CAFE_SEARCH_TERMS.some((term) =>
    containsSearchTerm(searchText, normalizeSearchText(term))
  );
}

function isStrictFoodCafeCandidate(attraction: Attraction): boolean {
  const primaryLabels = labelsFromValues([
    attraction.category,
    attraction.primary_category,
  ]);

  if (hasSetOverlap(primaryLabels, STRICT_FOOD_CAFE_CATEGORY_LABELS)) {
    return true;
  }

  const secondaryLabels = labelsFromValues(attraction.secondary_categories ?? []);

  if (hasSetOverlap(secondaryLabels, STRICT_FOOD_CAFE_SECONDARY_LABELS)) {
    return true;
  }

  const tagLabels = labelsFromValues(attraction.tags ?? []);

  return hasSetOverlap(tagLabels, STRICT_FOOD_CAFE_TAG_LABELS);
}

function getStrictFoodCafeReason(
  attraction: Attraction,
  slotInterest: string | null
): string {
  const labels = labelsFromValues([
    attraction.category,
    attraction.primary_category,
    ...(attraction.tags ?? []),
  ]);

  if (
    normalizeLabel(slotInterest) === "cafe" ||
    labels.has("cafe") ||
    labels.has("coffee") ||
    labels.has("bakery")
  ) {
    return "Selected as a cafe stop";
  }

  return "Selected as a food stop";
}

function updateCoveredInterestCounts(
  coveredInterestCounts: Map<string, number>,
  selectedInterests: string[],
  attraction: Attraction
): void {
  for (const interest of getMatchedSelectedInterests(attraction, selectedInterests)) {
    incrementCount(coveredInterestCounts, normalizeLabel(interest));
  }
}

function getPrimaryCategoryKey(attraction: Attraction): string {
  return normalizeLabel(attraction.primary_category ?? attraction.category);
}

function getDisplayPrimaryCategory(attraction: Attraction): string {
  return attraction.primary_category ?? attraction.category;
}

function incrementCount(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function expandInterestTerms(interest: string): Set<string> {
  const normalizedInterest = normalizeSearchText(interest);
  const interestLabel = normalizeLabel(interest);
  const terms = new Set<string>([
    normalizedInterest,
    interestLabel.replaceAll("_", " "),
  ]);

  for (const alias of INTEREST_ALIASES[interestLabel] ?? []) {
    terms.add(normalizeSearchText(alias));
  }

  return new Set([...terms].filter((term) => term.length > 0));
}

function expandInterestLabels(interest: string): Set<string> {
  return new Set([...expandInterestTerms(interest)].map(normalizeLabel));
}

function getAttractionMetadataValues(attraction: Attraction): string[] {
  return [
    attraction.category,
    attraction.primary_category,
    ...(attraction.secondary_categories ?? []),
    ...(attraction.tags ?? []),
  ].flatMap((value) => (value ? [value] : []));
}

function getAttractionSearchText(attraction: Attraction): string {
  return [
    attraction.category,
    attraction.primary_category,
    ...(attraction.secondary_categories ?? []),
    ...(attraction.tags ?? []),
    attraction.description,
  ]
    .flatMap((value) => (value ? [normalizeSearchText(value)] : []))
    .join(" ");
}

function labelsFromValues(values: Array<string | null | undefined>): Set<string> {
  return new Set(
    values
      .flatMap((value) => (value ? [normalizeLabel(value)] : []))
      .filter((value) => value.length > 0)
  );
}

function hasSetOverlap<T>(left: Set<T>, right: Set<T>): boolean {
  for (const value of left) {
    if (right.has(value)) {
      return true;
    }
  }

  return false;
}

function containsSearchTerm(searchText: string, term: string): boolean {
  const normalizedTerm = normalizeSearchText(term);

  if (normalizedTerm.length === 0) {
    return false;
  }

  if (normalizedTerm.length <= 3) {
    return ` ${searchText} `.includes(` ${normalizedTerm} `);
  }

  return searchText.includes(normalizedTerm);
}

function formatInterestForReason(interest: string): string {
  return normalizeSearchText(interest);
}

function mergeReasonSegments(
  logicalReasonSegments: string[],
  existingReason: string
): string {
  const mergedSegments = [
    ...logicalReasonSegments,
    ...existingReason.split(";").map((segment) => segment.trim()),
  ];
  const uniqueSegments = new Map<string, string>();

  for (const segment of mergedSegments) {
    if (segment.length === 0) {
      continue;
    }

    const key = normalizeSearchText(segment);

    if (!uniqueSegments.has(key)) {
      uniqueSegments.set(key, segment);
    }
  }

  return [...uniqueSegments.values()].join("; ");
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLabel(value: string | null | undefined): string {
  return normalizeSearchText(value ?? "").replaceAll(" ", "_");
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
  console.log("Logical route-aware itinerary selection:", {
    approximateTravelMinutesBetweenStops:
      getApproximateTravelMinutesBetweenStops(
        itinerary.items.map((item) => item.attraction),
        preferences.transportMode
      ),
    fallbackSlots: diagnostics.fallbackSlots,
    foodCafeSlotSelections: diagnostics.foodCafeSlotSelections,
    interests: preferences.interests,
    penalizedLongLegs: diagnostics.penalizedLongLegs,
    selectedAttractions: itinerary.items.map((item) => item.attraction.name),
    selectedPrimaryCategories: itinerary.items.map(
      (item) => getDisplayPrimaryCategory(item.attraction)
    ),
    skippedConsecutiveFoodStops: diagnostics.skippedConsecutiveFoodStops,
    skippedLongWalkingLegs: diagnostics.skippedLongWalkingLegs,
    slotPlan: diagnostics.slotPlan,
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

function findLowestScoreCandidateIndex(
  candidates: ItineraryCandidate[],
  preferences: PlannerPreferences
): number {
  const coverageCounts = getSelectedInterestCoverageCounts(
    candidates,
    getUniqueInterests(preferences.interests)
  );

  return candidates.reduce((lowestIndex, candidate, index) => {
    const lowestCandidate = candidates[lowestIndex];
    const removalScore = getCandidateRemovalScore(
      candidate,
      preferences,
      coverageCounts
    );
    const lowestRemovalScore = getCandidateRemovalScore(
      lowestCandidate,
      preferences,
      coverageCounts
    );

    if (removalScore < lowestRemovalScore) {
      return index;
    }

    if (removalScore === lowestRemovalScore && index > lowestIndex) {
      return index;
    }

    return lowestIndex;
  }, 0);
}

function getSelectedInterestCoverageCounts(
  candidates: ItineraryCandidate[],
  selectedInterests: string[]
): Map<string, number> {
  const coverageCounts = new Map<string, number>();

  for (const candidate of candidates) {
    updateCoveredInterestCounts(
      coverageCounts,
      selectedInterests,
      candidate.attraction
    );
  }

  return coverageCounts;
}

function getCandidateRemovalScore(
  candidate: ItineraryCandidate,
  preferences: PlannerPreferences,
  coverageCounts: Map<string, number>
): number {
  const selectedInterests = getUniqueInterests(preferences.interests);
  const protectsMultipleInterestCoverage = selectedInterests.length > 1;
  const matchedInterests = getMatchedSelectedInterests(
    candidate.attraction,
    selectedInterests
  );
  const uniquelyCoveredInterests = matchedInterests.filter(
    (interest) => (coverageCounts.get(normalizeLabel(interest)) ?? 0) === 1
  );
  const foodCafeProtection =
    !selectedInterests.every(isFoodCafeInterest) &&
    hasSelectedFoodCafeInterest(selectedInterests) &&
    isFoodCafeCandidate(candidate.attraction)
      ? 0.1
      : 0;
  const coverageProtection =
    protectsMultipleInterestCoverage && uniquelyCoveredInterests.length > 0
      ? 0.16
      : 0;

  return candidate.rank.score + foodCafeProtection + coverageProtection;
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
