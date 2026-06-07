import type { Coordinates } from "@/lib/routing";

export const interestGroups = [
  {
    label: "Heritage & Culture",
    interests: [
      "History",
      "Culture",
      "Architecture",
      "Religion",
      "Museum",
      "War History",
      "Ottoman Heritage",
      "Austro-Hungarian Heritage",
    ],
  },
  {
    label: "Food & Local Life",
    interests: [
      "Food",
      "Cafe",
      "Shopping",
      "Local Experience",
      "Traditional Bosnian Food",
    ],
  },
  {
    label: "Nature & Recreation",
    interests: ["Nature", "Viewpoint", "Park", "Sport", "Family"],
  },
  {
    label: "Entertainment",
    interests: ["Entertainment", "Theatre", "Cinema", "Modern Sarajevo"],
  },
] as const;

export type TravelInterest =
  (typeof interestGroups)[number]["interests"][number];

export const travelInterestOptions: TravelInterest[] = interestGroups.flatMap(
  (group) => [...group.interests]
);

export const budgetLevelValues = ["free", "low", "medium", "high"] as const;
export const transportModeValues = ["walking", "driving"] as const;
export const preferredPaceValues = ["relaxed", "moderate", "fast"] as const;

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
  startLocation?: Coordinates;
};
