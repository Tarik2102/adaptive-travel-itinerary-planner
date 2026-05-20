export const travelInterestOptions = [
  "history",
  "culture",
  "nature",
  "architecture",
  "religion",
  "museum",
] as const;

export const budgetLevelValues = ["free", "low", "medium", "high"] as const;
export const transportModeValues = ["walking", "driving"] as const;
export const preferredPaceValues = ["relaxed", "moderate", "fast"] as const;

export type TravelInterest = (typeof travelInterestOptions)[number];
export type BudgetLevel = (typeof budgetLevelValues)[number];
export type TransportMode = (typeof transportModeValues)[number];
export type PreferredPace = (typeof preferredPaceValues)[number];

export type PlannerPreferences = {
  interests: string[];
  startTime: string;
  endTime: string;
  budgetLevel: BudgetLevel;
  transportMode: TransportMode;
  preferredPace: PreferredPace;
  maxAttractions: number;
};
