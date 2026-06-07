import type { GeneratedItinerary } from "@/types/itinerary";
import type { Attraction } from "@/types/attraction";
import type { InterestGroupId } from "@/lib/interestFilter";
import { getInterestGroups } from "@/lib/interestFilter";

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeToMinutes(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

// Case-insensitive substring match mirroring recommendation-fallback.ts logic.
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

// ── Metric functions ──────────────────────────────────────────────────────────

/**
 * Precision: fraction of stops in the plan whose category matches any requested interest.
 * Denominator = number of stops in the plan (excluding empty itineraries).
 * 0…1 (1 = every stop matches a requested interest).
 */
export function interestPrecision(
  itinerary: GeneratedItinerary,
  requestedInterests: string[]
): number {
  if (itinerary.items.length === 0) return 0;
  if (requestedInterests.length === 0) return 1;

  const matching = itinerary.items.filter((item) =>
    requestedInterests.some((interest) => attractionMatchesInterest(item.attraction, interest))
  );

  return matching.length / itinerary.items.length;
}

/**
 * Recall: fraction of requested interests covered by at least one itinerary stop.
 * 0…1 (1 = all requested interests represented in the plan).
 */
export function interestRecall(
  itinerary: GeneratedItinerary,
  requestedInterests: string[]
): number {
  if (requestedInterests.length === 0) return 1;
  if (itinerary.items.length === 0) return 0;

  const covered = requestedInterests.filter((interest) =>
    itinerary.items.some((item) => attractionMatchesInterest(item.attraction, interest))
  );

  return covered.length / requestedInterests.length;
}

/**
 * Number of stops whose attraction is classified as outdoor.
 */
export function outdoorStopCount(itinerary: GeneratedItinerary): number {
  return itinerary.items.filter((item) => item.attraction.indoor_outdoor === "outdoor").length;
}

/**
 * Fraction of requested interest groups (from INTEREST_GROUPS in interestFilter.ts)
 * that have at least one matching stop. Uses getInterestGroups() for stop membership.
 * 0…1 (1 = every requested group represented).
 */
export function interestGroupCoverage(
  itinerary: GeneratedItinerary,
  requestedGroups: InterestGroupId[]
): number {
  if (requestedGroups.length === 0) return 1;
  if (itinerary.items.length === 0) return 0;

  const coveredGroups = new Set<InterestGroupId>(
    itinerary.items.flatMap((item) => getInterestGroups(item.attraction))
  );

  const covered = requestedGroups.filter((g) => coveredGroups.has(g));
  return covered.length / requestedGroups.length;
}

/**
 * Sum of all per-leg travel times in the itinerary (minutes).
 */
export function totalTravelTimeMinutes(itinerary: GeneratedItinerary): number {
  return itinerary.items.reduce((sum, item) => sum + item.travelTimeFromPrevious, 0);
}

/**
 * True iff the itinerary is non-empty, not marked infeasible, AND the last
 * stop's planned end time falls within the requested time window.
 */
export function isFeasible(itinerary: GeneratedItinerary, endTime: string): boolean {
  if (itinerary.items.length === 0) return false;
  if (itinerary.feasibilityStatus === "infeasible") return false;

  const lastEnd = itinerary.items.at(-1)!.plannedEndTime;
  return timeToMinutes(lastEnd) <= timeToMinutes(endTime);
}

/**
 * Fraction of stop slots that changed (different attraction ID or position)
 * between original and adapted itinerary.
 * 0 = identical plan, 1 = completely different.
 */
export function planChangeRatio(
  original: GeneratedItinerary,
  adapted: GeneratedItinerary
): number {
  const origIds = original.items.map((i) => i.attraction.id);
  const adaptIds = adapted.items.map((i) => i.attraction.id);
  const total = Math.max(origIds.length, adaptIds.length);
  if (total === 0) return 0;

  let changed = 0;
  for (let i = 0; i < total; i++) {
    if (origIds[i] !== adaptIds[i]) changed++;
  }

  return changed / total;
}
