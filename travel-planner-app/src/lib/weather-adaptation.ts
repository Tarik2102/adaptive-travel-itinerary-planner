import { createEmptyAdaptation } from "@/lib/adaptation";
import type { Attraction } from "@/types/attraction";
import type {
  AffectedAttraction,
  ItineraryAdaptation,
  RankedAttraction,
  ReplacedAttraction,
} from "@/types/itinerary";
import type { WeatherInfo } from "@/lib/weather";

type AttractionEnvironment = "indoor" | "outdoor" | "unknown";

type WeatherAdaptationResult = {
  rankedAttractions: RankedAttraction[];
  adaptation: ItineraryAdaptation;
};

const BAD_WEATHER_CONDITIONS = new Set([
  "rain",
  "snow",
  "thunderstorm",
  "drizzle",
  "squall",
  "tornado",
]);

const OUTDOOR_KEYWORDS = [
  "park",
  "viewpoint",
  "bridge",
  "mountain",
  "outdoor",
  "square",
  "street",
  "fortress",
  "nature",
];

const INDOOR_KEYWORDS = [
  "museum",
  "gallery",
  "library",
  "shopping",
  "mall",
  "mosque",
  "church",
  "synagogue",
  "indoor",
];

const WEATHER_REASON =
  "Bad weather detected, outdoor attractions were deprioritized.";
const AFFECTED_ATTRACTION_REASON =
  "Outdoor attraction deprioritized because bad weather is expected.";
const REPLACEMENT_REASON =
  "Indoor attraction preferred because bad weather increased outdoor risk.";
const OUTDOOR_SCORE_PENALTY = 0.25;
const INDOOR_SCORE_BOOST = 0.05;

export function applyWeatherAdaptation(
  rankedAttractions: RankedAttraction[],
  attractions: Attraction[],
  weather: WeatherInfo | null,
  maxAttractions: number
): WeatherAdaptationResult {
  if (!weather) {
    return {
      rankedAttractions,
      adaptation: createEmptyAdaptation(),
    };
  }

  const weatherCondition = weather.condition;

  if (!isBadWeatherCondition(weatherCondition)) {
    return {
      rankedAttractions,
      adaptation: createEmptyAdaptation(),
    };
  }

  const attractionsById = new Map(
    attractions.map((attraction) => [attraction.id, attraction])
  );
  // Whether bad weather deprioritized anything at all in the ranked pool. This
  // is what `applied`/`weatherCondition` have always been gated on, so it stays
  // computed over the full pool — narrowing below is reporting-only.
  const hasDeprioritizedOutdoor = rankedAttractions.some((rank) => {
    const attraction = attractionsById.get(rank.id);
    return (
      attraction !== undefined &&
      inferAttractionEnvironment(attraction) === "outdoor"
    );
  });
  const adjustedRanks = rankedAttractions
    .map((rank, index) => {
      const attraction = attractionsById.get(rank.id);
      const environment = attraction
        ? inferAttractionEnvironment(attraction)
        : "unknown";

      return {
        index,
        rank: {
          ...rank,
          score: adjustScoreForWeather(rank.score, environment),
        },
      };
    })
    .sort((left, right) => {
      const scoreDifference = right.rank.score - left.rank.score;
      return scoreDifference === 0 ? left.index - right.index : scoreDifference;
    })
    .map(({ rank }) => rank);

  const affectedAttractions = getAffectedAttractions(
    rankedAttractions,
    adjustedRanks,
    attractionsById,
    maxAttractions
  );
  const replacedAttractions = getReplacedAttractions(
    rankedAttractions,
    adjustedRanks,
    attractionsById,
    maxAttractions
  );

  return {
    rankedAttractions: adjustedRanks,
    adaptation: createEmptyAdaptation({
      applied: hasDeprioritizedOutdoor,
      reasons: hasDeprioritizedOutdoor ? [WEATHER_REASON] : [],
      ...(hasDeprioritizedOutdoor ? { weatherCondition } : {}),
      ...(affectedAttractions.length > 0 ? { affectedAttractions } : {}),
      ...(replacedAttractions.length > 0 ? { replacedAttractions } : {}),
    }),
  };
}

export function isBadWeatherCondition(condition: string): boolean {
  return BAD_WEATHER_CONDITIONS.has(condition.trim().toLowerCase());
}

/**
 * Resolves an attraction's environment from the most authoritative source
 * available, in this order:
 *
 *   1. `indoor_outdoor` — the curated column, set on manual_seed rows only.
 *   2. `is_indoor` / `is_outdoor` — the booleans the OSM import populates.
 *      97% of active attractions have a null `indoor_outdoor` but a definite
 *      value here, so for most of the catalogue this is the real signal.
 *   3. Keyword inference over name/category/description — a safety net for the
 *      handful of rows that carry no structured environment data at all.
 *
 * A row flagged as both indoor and outdoor is ambiguous under either structured
 * source and falls through to the keyword pass, matching how
 * `indoor_outdoor = 'both'` has always been treated.
 */
export function inferAttractionEnvironment(
  attraction: Attraction
): AttractionEnvironment {
  const explicitEnvironment = normalizeText(attraction.indoor_outdoor ?? "");

  if (
    explicitEnvironment.includes("indoor") &&
    !explicitEnvironment.includes("outdoor")
  ) {
    return "indoor";
  }

  if (
    explicitEnvironment.includes("outdoor") &&
    !explicitEnvironment.includes("indoor")
  ) {
    return "outdoor";
  }

  const isIndoor = attraction.is_indoor === true;
  const isOutdoor = attraction.is_outdoor === true;

  if (isIndoor && !isOutdoor) {
    return "indoor";
  }

  if (isOutdoor && !isIndoor) {
    return "outdoor";
  }

  const searchableText = normalizeText(
    [
      attraction.name,
      attraction.category,
      attraction.description ?? "",
      explicitEnvironment,
    ].join(" ")
  );

  if (hasKeyword(searchableText, INDOOR_KEYWORDS)) {
    return "indoor";
  }

  if (hasKeyword(searchableText, OUTDOOR_KEYWORDS)) {
    return "outdoor";
  }

  return "unknown";
}

/**
 * The outdoor attractions genuinely affected by the weather penalty for THIS
 * request: those holding a selectable rank before it was applied, plus those
 * still holding one after. The ranked pool passed in covers the whole active
 * catalogue, and its ordering is already interest-driven, so this window is the
 * set that was actually in contention for the traveller's day. Anything further
 * down was never going to be selected, and reporting it buried the meaningful
 * changes under a list of the entire outdoor catalogue.
 *
 * Scoping only affects what is reported — the -0.25 penalty is applied across
 * the full pool exactly as before, and `applied`/`weatherCondition` still
 * reflect the unscoped outcome.
 */
function getAffectedAttractions(
  originalRanks: RankedAttraction[],
  adjustedRanks: RankedAttraction[],
  attractionsById: Map<number, Attraction>,
  maxAttractions: number
): AffectedAttraction[] {
  const contendingIds = new Set([
    ...originalRanks.slice(0, maxAttractions).map((rank) => rank.id),
    ...adjustedRanks.slice(0, maxAttractions).map((rank) => rank.id),
  ]);

  return originalRanks.flatMap((rank) => {
    if (!contendingIds.has(rank.id)) {
      return [];
    }

    const attraction = attractionsById.get(rank.id);

    if (!attraction || inferAttractionEnvironment(attraction) !== "outdoor") {
      return [];
    }

    return [
      {
        id: attraction.id,
        name: attraction.name,
        reason: AFFECTED_ATTRACTION_REASON,
      },
    ];
  });
}

function getReplacedAttractions(
  originalRanks: RankedAttraction[],
  adjustedRanks: RankedAttraction[],
  attractionsById: Map<number, Attraction>,
  maxAttractions: number
): ReplacedAttraction[] {
  const originalTopIds = originalRanks
    .slice(0, maxAttractions)
    .map((rank) => rank.id);
  const adjustedTopIds = adjustedRanks
    .slice(0, maxAttractions)
    .map((rank) => rank.id);
  const adjustedTopIdSet = new Set(adjustedTopIds);
  const originalTopIdSet = new Set(originalTopIds);
  const removedOutdoorAttractions = originalTopIds.flatMap((id) => {
    const attraction = attractionsById.get(id);

    if (
      !attraction ||
      adjustedTopIdSet.has(id) ||
      inferAttractionEnvironment(attraction) !== "outdoor"
    ) {
      return [];
    }

    return [attraction];
  });
  const addedIndoorAttractions = adjustedTopIds.flatMap((id) => {
    const attraction = attractionsById.get(id);

    if (
      !attraction ||
      originalTopIdSet.has(id) ||
      inferAttractionEnvironment(attraction) !== "indoor"
    ) {
      return [];
    }

    return [attraction];
  });

  return removedOutdoorAttractions.flatMap((removed, index) => {
    const replacement = addedIndoorAttractions[index];

    if (!replacement) {
      return [];
    }

    return [
      {
        removed: {
          id: removed.id,
          name: removed.name,
        },
        replacement: {
          id: replacement.id,
          name: replacement.name,
        },
        reason: REPLACEMENT_REASON,
      },
    ];
  });
}

function adjustScoreForWeather(
  score: number,
  environment: AttractionEnvironment
): number {
  if (environment === "outdoor") {
    return clamp(score - OUTDOOR_SCORE_PENALTY, 0, 1);
  }

  if (environment === "indoor") {
    return clamp(score + INDOOR_SCORE_BOOST, 0, 1);
  }

  return score;
}

function hasKeyword(value: string, keywords: string[]): boolean {
  return keywords.some((keyword) => value.includes(keyword));
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
