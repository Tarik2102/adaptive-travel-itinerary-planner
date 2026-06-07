import type { InterestGroupId } from "@/lib/interestFilter";

// ── Persona definition ────────────────────────────────────────────────────────

export type Persona = {
  id: string;
  name: string;
  interests: string[];
  startTime: string;
  endTime: string;
  transportMode: "walking" | "driving";
  budgetLevel: "free" | "low" | "medium" | "high";
  preferredPace: "relaxed" | "moderate" | "fast";
  maxAttractions: number;
};

// ── Scenario dimension types ──────────────────────────────────────────────────

export type DisruptionLevel = "none" | "moderate" | "heavy" | "blocked";
export type WeatherCondition = "clear" | "rain";
export type SystemMode = "adaptive" | "static";

export type Scenario = {
  id: string;
  persona: Persona;
  weather: WeatherCondition;
  disruption: DisruptionLevel;
  mode: SystemMode;
  requestedGroups: InterestGroupId[];
};

// ── Four-group mapping ────────────────────────────────────────────────────────
// Maps persona interest strings → InterestGroupId from interestFilter.ts.
// Reuses the same four group IDs (heritage / food / nature / entertainment)
// without redefining the keyword-based attraction matching logic.

const INTEREST_TO_GROUP: Record<string, InterestGroupId> = {
  History: "heritage",
  Religion: "heritage",
  Museum: "heritage",
  Culture: "heritage",
  Architecture: "heritage",
  Food: "food",
  Cafe: "food",
  Shopping: "food",
  Nature: "nature",
  Viewpoint: "nature",
  Sport: "nature",
  Entertainment: "entertainment",
};

export function getRequestedGroups(interests: string[]): InterestGroupId[] {
  const seen = new Set<InterestGroupId>();
  for (const interest of interests) {
    const group = INTEREST_TO_GROUP[interest];
    if (group) seen.add(group);
  }
  return Array.from(seen);
}

// ── Personas ──────────────────────────────────────────────────────────────────

const PERSONAS: Persona[] = [
  {
    id: "P1",
    name: "History buff",
    interests: ["History", "Museum", "Religion", "Culture", "Architecture"],
    startTime: "09:00",
    endTime: "18:00",
    transportMode: "walking",
    budgetLevel: "medium",
    preferredPace: "moderate",
    maxAttractions: 8,
  },
  {
    id: "P2",
    name: "Foodie",
    interests: ["Food", "Cafe"],
    startTime: "12:00",
    endTime: "17:00",
    transportMode: "walking",
    budgetLevel: "low",
    preferredPace: "relaxed",
    maxAttractions: 6,
  },
  {
    id: "P3",
    name: "Nature and views",
    interests: ["Nature", "Viewpoint"],
    startTime: "10:00",
    endTime: "16:00",
    transportMode: "driving",
    budgetLevel: "medium",
    preferredPace: "moderate",
    maxAttractions: 6,
  },
  {
    id: "P4",
    name: "Sampler",
    interests: ["History", "Food", "Nature", "Entertainment"],
    startTime: "09:00",
    endTime: "18:00",
    transportMode: "driving",
    budgetLevel: "high",
    preferredPace: "fast",
    maxAttractions: 8,
  },
  {
    id: "P5",
    name: "Time-crunched",
    interests: ["History", "Food"],
    startTime: "09:00",
    endTime: "12:00",
    transportMode: "walking",
    budgetLevel: "medium",
    preferredPace: "fast",
    maxAttractions: 5,
  },
  {
    id: "P6",
    name: "Budget mixed",
    interests: ["History", "Culture", "Nature"],
    startTime: "10:00",
    endTime: "17:00",
    transportMode: "walking",
    budgetLevel: "low",
    preferredPace: "moderate",
    maxAttractions: 7,
  },
];

// ── Dimension arrays ──────────────────────────────────────────────────────────

const WEATHER_OPTIONS: WeatherCondition[] = ["clear", "rain"];
const DISRUPTION_OPTIONS: DisruptionLevel[] = ["none", "moderate", "heavy", "blocked"];
const MODE_OPTIONS: SystemMode[] = ["adaptive", "static"];

// ── Scenario generator ────────────────────────────────────────────────────────
// Produces all 6 × 2 × 4 × 2 = 96 scenario combinations.

export function generateScenarios(): Scenario[] {
  const scenarios: Scenario[] = [];

  for (const persona of PERSONAS) {
    for (const weather of WEATHER_OPTIONS) {
      for (const disruption of DISRUPTION_OPTIONS) {
        for (const mode of MODE_OPTIONS) {
          scenarios.push({
            id: `${persona.id}-${weather}-${disruption}-${mode}`,
            persona,
            weather,
            disruption,
            mode,
            requestedGroups: getRequestedGroups(persona.interests),
          });
        }
      }
    }
  }

  return scenarios;
}
