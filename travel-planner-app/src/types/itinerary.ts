import type { Attraction } from "@/types/attraction";
import type { PlannerPreferences, TransportMode } from "@/types/preference";
import type { RouteGeometry, RoutingMetadata } from "@/lib/routing";

export type {
  Coordinate,
  RouteGeometry,
  RoutingFallbackReason,
  RoutingMetadata,
  RoutingProvider,
  RoutingResponse,
} from "@/lib/routing";

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
  transportMode?: TransportMode;
  routeGeometry?: RouteGeometry;
  routing?: RoutingMetadata;
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

export type TrafficSeverity = "moderate" | "heavy" | "blocked";

export type TrafficSimulationStatus =
  | "delayed_but_feasible"
  | "heavy_delay_feasible"
  | "blocked_reoptimized"
  | "ignored"
  | "no_effect";

export type TrafficSimulationInfo = {
  enabled: boolean;
  severity: TrafficSeverity;
  affectedLegIndex: number;
  affectedSegment: {
    from: string;
    to: string;
  };
  originalLegTravelTime: number;
  simulatedLegTravelTime: number;
  addedDelayMinutes: number;
  status: TrafficSimulationStatus;
};

export type TrafficSimulationRequest = {
  enabled: boolean;
  severity: TrafficSeverity;
  affectedLegIndex: number | "auto";
  delayMinutes?: number;
};

export type ItineraryAdaptation = {
  applied: boolean;
  reasons: string[];
  weatherCondition?: string;
  removedAttractions?: RemovedAttraction[];
  replacedAttractions?: ReplacedAttraction[];
  affectedAttractions?: AffectedAttraction[];
  feasibilityStatus?: AdaptationFeasibilityStatus;
  trafficSimulation?: TrafficSimulationInfo;
};

export type TrafficAdaptRequest = {
  currentItinerary: GeneratedItinerary;
  preferences: {
    interests: string[];
    transport: string;
    startTime: string;
    endTime: string;
    maxStops?: number;
  };
  trafficSimulation: TrafficSimulationRequest;
};

export type TrafficAdaptResponseNoDecision = {
  trafficDecisionRequired: false;
  itinerary: GeneratedItinerary;
  adaptation: ItineraryAdaptation;
};

export type TrafficAdaptResponseDecision = {
  trafficDecisionRequired: true;
  currentItinerary: GeneratedItinerary;
  proposedItinerary: GeneratedItinerary;
  adaptation: ItineraryAdaptation;
};

export type TrafficAdaptResponse =
  | TrafficAdaptResponseNoDecision
  | TrafficAdaptResponseDecision;

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

export type ItineraryResponse = ItineraryApiResponse;

export type ItineraryRequest = {
  preferences: PlannerPreferences;
};
