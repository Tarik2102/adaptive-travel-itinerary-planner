import type { Attraction } from "@/types/attraction";
import type { Persona } from "./scenarios";

export const RELEVANCE_MIN_RATING = 4.0;

function attractionMatchesInterest(attraction: Attraction, interest: string): boolean {
  const iLower = interest.toLowerCase().replace(/[_-]+/g, " ").trim();
  const fields = [
    attraction.primary_category ?? "",
    attraction.category,
    ...(attraction.secondary_categories ?? []),
    ...(attraction.tags ?? []),
  ]
    .map((v) => v.toLowerCase().replace(/[_-]+/g, " ").trim())
    .filter((v) => v.length > 0);
  return fields.some((f) => f.includes(iLower) || iLower.includes(f));
}

function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Build binary relevance ground truth for each persona.
 *
 * Relevant = category matches ≥1 requested interest AND
 *   (rating >= RELEVANCE_MIN_RATING)
 *   OR (rating is null/0/NaN AND data_quality_score >= median(data_quality_score))
 *
 * Returns:
 *   groundTruth      — Map<personaId, Set<attractionId>>
 *   relevantCounts   — Map<personaId, number> (|relevant set|)
 *   emptyPersonas    — personaIds whose relevant set is empty (excluded from recall means)
 */
export function buildGroundTruth(
  personas: Persona[],
  allAttractions: Attraction[]
): {
  groundTruth: Map<string, Set<number>>;
  relevantCounts: Map<string, number>;
  emptyPersonas: string[];
} {
  // Median over all attractions that have a numeric data_quality_score.
  const dqsValues = allAttractions
    .map((a) => a.data_quality_score)
    .filter((s): s is number => s !== undefined && s !== null && Number.isFinite(s));
  const medianDqs = computeMedian(dqsValues);

  const groundTruth = new Map<string, Set<number>>();
  const relevantCounts = new Map<string, number>();
  const emptyPersonas: string[] = [];

  for (const persona of personas) {
    const relevant = new Set<number>();

    for (const attraction of allAttractions) {
      if (!persona.interests.some((i) => attractionMatchesInterest(attraction, i))) {
        continue;
      }

      const rawRating = attraction.rating;
      const rating =
        rawRating === null || rawRating === undefined
          ? null
          : Number(rawRating);
      const ratingIsUsable =
        rating !== null && Number.isFinite(rating) && rating > 0;

      if (ratingIsUsable && rating! >= RELEVANCE_MIN_RATING) {
        relevant.add(attraction.id);
        continue;
      }

      // Rating absent/zero/NaN → fall back to data_quality_score threshold.
      if (!ratingIsUsable) {
        const dqs = attraction.data_quality_score;
        if (dqs !== undefined && dqs !== null && Number.isFinite(dqs) && dqs >= medianDqs) {
          relevant.add(attraction.id);
        }
      }
    }

    groundTruth.set(persona.id, relevant);
    relevantCounts.set(persona.id, relevant.size);
    if (relevant.size === 0) emptyPersonas.push(persona.id);
  }

  return { groundTruth, relevantCounts, emptyPersonas };
}
