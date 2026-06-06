import type { Attraction } from "@/types/attraction";
import type { RankedAttraction } from "@/types/itinerary";
import type { PlannerPreferences } from "@/types/preference";

// Weights for the final score formula.
const INTEREST_WEIGHT = 0.6;
const QUALITY_WEIGHT = 0.4;

export function rankAttractionsLocally(
  attractions: Attraction[],
  preferences: PlannerPreferences
): RankedAttraction[] {
  const interests = preferences.interests.map((i) => i.toLowerCase());

  const qualityById = new Map(
    attractions.map((a) => [a.id, a.data_quality_score ?? 0])
  );

  return attractions
    .map((attraction): RankedAttraction => {
      const primaryCat = (attraction.primary_category ?? "").toLowerCase();
      const secondaryCats = (attraction.secondary_categories ?? []).map((c) =>
        c.toLowerCase()
      );
      const tags = (attraction.tags ?? []).map((t) => t.toLowerCase());

      const primaryMatch = interests.some(
        (i) => primaryCat.includes(i) || i.includes(primaryCat)
      );
      const secondaryMatch =
        !primaryMatch &&
        interests.some(
          (i) =>
            secondaryCats.some((c) => c.includes(i) || i.includes(c)) ||
            tags.some((t) => t.includes(i) || i.includes(t))
        );

      const interestMatch = primaryMatch ? 1.0 : secondaryMatch ? 0.6 : 0.0;

      const qualityScores: number[] = [];
      if (attraction.data_quality_score !== undefined) {
        qualityScores.push(clamp(attraction.data_quality_score, 0, 1));
      }
      if (attraction.popularity_score !== undefined) {
        qualityScores.push(clamp(attraction.popularity_score, 0, 1));
      }
      if (attraction.rating !== null && attraction.rating !== undefined) {
        qualityScores.push(clamp(toNumber(attraction.rating) / 5, 0, 1));
      }
      const quality =
        qualityScores.length > 0
          ? qualityScores.reduce((sum, s) => sum + s, 0) / qualityScores.length
          : 0;

      const score = clamp(
        INTEREST_WEIGHT * interestMatch + QUALITY_WEIGHT * quality,
        0,
        1
      );

      const reason =
        interestMatch === 1.0
          ? "Matches your primary interests"
          : interestMatch === 0.6
            ? "Partially matches your interests"
            : "Recommended based on quality";

      return { id: attraction.id, score, reason };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (qualityById.get(b.id) ?? 0) - (qualityById.get(a.id) ?? 0);
    });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toNumber(value: string | number | null | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
