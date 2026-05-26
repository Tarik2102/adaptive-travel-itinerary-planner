import type { Attraction } from "@/types/attraction";
import type { PlannerPreferences } from "@/types/preference";

export type FeasibilityStatus = "feasible" | "partial" | "infeasible";
export type AdaptationFeasibilityStatus =
  | "feasible"
  | "adjusted"
  | "not_feasible";

export type RankedAttraction = {
  id: number;
  score: number;
  reason: string;
};

export type ItineraryItem = {
  attraction: Attraction;
  score: number;
  reason: string;
  plannedStartTime: string;
  plannedEndTime: string;
  travelTimeFromPrevious: number;
};

export type GeneratedItinerary = {
  items: ItineraryItem[];
  totalVisitTime: number;
  totalTravelTime: number;
  totalDuration: number;
  feasibilityStatus: FeasibilityStatus;
};

export type AdaptationAttraction = {
  id: number;
  name: string;
};

export type RemovedAttraction = AdaptationAttraction & {
  reason: string;
};

export type ReplacedAttraction = {
  removed: AdaptationAttraction;
  replacement: AdaptationAttraction;
  reason: string;
};

export type AffectedAttraction = AdaptationAttraction & {
  reason: string;
};

export type ItineraryAdaptation = {
  applied: boolean;
  reasons: string[];
  weatherCondition?: string;
  removedAttractions?: RemovedAttraction[];
  replacedAttractions?: ReplacedAttraction[];
  affectedAttractions?: AffectedAttraction[];
  feasibilityStatus?: AdaptationFeasibilityStatus;
};

export type ItineraryPlan = {
  itinerary: GeneratedItinerary;
  adaptation: ItineraryAdaptation;
};

export type ItinerarySuccessResponse = {
  success: true;
  itinerary: GeneratedItinerary;
  adaptation: ItineraryAdaptation;
};

export type ItineraryErrorResponse = {
  success: false;
  error: string;
  details?: string | string[];
};

export type ItineraryApiResponse =
  | ItinerarySuccessResponse
  | ItineraryErrorResponse;

export type ItineraryRequest = {
  preferences: PlannerPreferences;
};
