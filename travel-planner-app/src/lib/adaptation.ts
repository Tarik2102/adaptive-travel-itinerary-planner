import type { ItineraryAdaptation } from "@/types/itinerary";

export const SARAJEVO_COORDINATES = {
  latitude: 43.8563,
  longitude: 18.4131,
};

export function createEmptyAdaptation(
  overrides: Partial<ItineraryAdaptation> = {}
): ItineraryAdaptation {
  return {
    applied: false,
    reasons: [],
    recommendationSource: "ml",
    ...overrides,
  };
}

export function mergeAdaptations(
  ...adaptations: ItineraryAdaptation[]
): ItineraryAdaptation {
  const reasons = uniqueStrings(
    adaptations.flatMap((adaptation) => adaptation.reasons)
  );
  const removedAttractions = adaptations.flatMap(
    (adaptation) => adaptation.removedAttractions ?? []
  );
  const replacedAttractions = adaptations.flatMap(
    (adaptation) => adaptation.replacedAttractions ?? []
  );
  const affectedAttractions = adaptations.flatMap(
    (adaptation) => adaptation.affectedAttractions ?? []
  );
  const weatherCondition = findLastDefined(
    adaptations.map((adaptation) => adaptation.weatherCondition)
  );
  const feasibilityStatus = findLastDefined(
    adaptations.map((adaptation) => adaptation.feasibilityStatus)
  );
  const sparseCategory = adaptations.some((adaptation) => adaptation.sparseCategory === true);

  return {
    applied: adaptations.some((adaptation) => adaptation.applied),
    reasons,
    ...(weatherCondition ? { weatherCondition } : {}),
    ...(removedAttractions.length > 0 ? { removedAttractions } : {}),
    ...(replacedAttractions.length > 0 ? { replacedAttractions } : {}),
    ...(affectedAttractions.length > 0 ? { affectedAttractions } : {}),
    ...(feasibilityStatus ? { feasibilityStatus } : {}),
    ...(sparseCategory ? { sparseCategory: true } : {}),
  };
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function findLastDefined<T>(values: Array<T | undefined>): T | undefined {
  return values.findLast((value): value is T => value !== undefined);
}
