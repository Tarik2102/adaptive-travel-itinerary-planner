import type { Attraction } from "@/types/attraction";
import type { PlannerPreferences } from "@/types/preference";

export type FeasibilityStatus = "feasible" | "partial" | "infeasible";

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

export type ItinerarySuccessResponse = {
  success: true;
  itinerary: GeneratedItinerary;
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
