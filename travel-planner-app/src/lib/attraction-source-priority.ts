import type { Attraction } from "@/types/attraction";

const SARAJEVO_BOUNDS = {
  latMin: 43.65,
  latMax: 44.05,
  lonMin: 17.9,
  lonMax: 18.7,
} as const;

// Canonical alias groups for the 10 known original Sarajevo attractions.
// Each group key maps to normalized alias tokens derived from both OSM and manual_seed names.
const CANONICAL_ALIAS_GROUPS: Record<string, string[]> = {
  bascarsija: ["bascarsija", "old bazaar"],
  sebilj: ["sebilj"],
  "latin bridge": ["latin bridge", "latinska cuprija"],
  vijecnica: ["vijecnica", "sarajevo city hall"],
  "gazi husrev": ["gazi husrev"],
  "yellow fortress": ["yellow fortress", "zuta tabija"],
  "zemaljski muzej": ["zemaljski muzej", "national museum of bosnia"],
  "tunel spasa": ["tunel spasa", "tunnel of hope", "sarajevo war tunnel"],
  "vrelo bosne": ["vrelo bosne"],
  avaz: ["avaz"],
};

/**
 * Normalizes an attraction name for canonical key matching:
 * lowercase → NFD diacritic removal → đ→d → strip punctuation → collapse whitespace.
 */
export function normalizeAttractionName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Returns a stable canonical key for an attraction.
 * Attractions matching any known alias group share the same key.
 * Unrecognized attractions use their normalized name as the key.
 */
export function getCanonicalAttractionKey(attraction: { name: string }): string {
  const normalized = normalizeAttractionName(attraction.name);

  for (const [groupKey, aliases] of Object.entries(CANONICAL_ALIAS_GROUPS)) {
    for (const alias of aliases) {
      if (normalized.includes(alias)) {
        return groupKey;
      }
    }
  }

  return normalized;
}

/**
 * Returns true if an attraction has all fields required for reliable itinerary use:
 * valid Sarajevo-area coordinates, a name, a positive visit duration, and a category.
 */
export function isValidAttractionForItinerary(attraction: Attraction): boolean {
  const lat = Number(attraction.latitude);
  const lon = Number(attraction.longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat === 0 && lon === 0) return false;
  if (lat < SARAJEVO_BOUNDS.latMin || lat > SARAJEVO_BOUNDS.latMax) return false;
  if (lon < SARAJEVO_BOUNDS.lonMin || lon > SARAJEVO_BOUNDS.lonMax) return false;
  if (!attraction.name?.trim()) return false;
  if (!attraction.estimated_visit_duration || attraction.estimated_visit_duration <= 0) return false;
  if (!attraction.category?.trim() && !attraction.primary_category?.trim()) return false;

  return true;
}

/**
 * Resolves the preferred attraction list applying OSM-over-manual_seed source priority:
 * - When both an OSM and a manual_seed row exist for the same canonical attraction,
 *   the OSM row is used and the manual_seed row is suppressed.
 * - If the OSM row fails coordinate validation, the manual_seed row is used as fallback.
 * - Manual_seed rows with no OSM counterpart are kept unchanged.
 * - Missing OSM fields (description, rating, visit duration) are enriched from manual_seed.
 */
export function resolvePreferredAttractions(attractions: Attraction[]): Attraction[] {
  type AttractionGroup = { osm: Attraction[]; manual: Attraction[] };
  const groups = new Map<string, AttractionGroup>();
  const otherAttractions: Attraction[] = [];

  for (const a of attractions) {
    if (a.source === "openstreetmap" || a.source === "manual_seed") {
      const key = getCanonicalAttractionKey(a);
      const group = groups.get(key) ?? { osm: [], manual: [] };
      if (a.source === "openstreetmap") group.osm.push(a);
      else group.manual.push(a);
      groups.set(key, group);
    } else {
      otherAttractions.push(a);
    }
  }

  const resolved: Attraction[] = [];
  let osmPrimaryCount = 0;
  let manualFallbackCount = 0;
  let manualOnlyCount = 0;
  let suppressedCount = 0;
  let duplicateGroupCount = 0;

  for (const [key, { osm, manual }] of groups) {
    if (osm.length > 0 && manual.length > 0) duplicateGroupCount++;

    if (osm.length > 0) {
      const sortedOsm = [...osm].sort(byValidityThenQuality);
      const bestOsm = sortedOsm[0];
      const bestManual =
        manual.find(isValidAttractionForItinerary) ?? manual[0] ?? null;
      const osmValid = isValidAttractionForItinerary(bestOsm);

      if (!osmValid && bestManual && isValidAttractionForItinerary(bestManual)) {
        // OSM coordinates are invalid — use manual_seed as fallback
        resolved.push({
          ...bestManual,
          source_priority: "manual_fallback" as const,
          canonical_key: key,
        });
        manualFallbackCount++;
        console.log(
          `[source-priority] Using manual fallback for "${key}" — OSM row failed validation`
        );
      } else {
        // OSM is primary; optionally enrich missing fields from manual_seed
        const enriched = bestManual ? enrichWithFallback(bestOsm, bestManual) : bestOsm;
        resolved.push({
          ...enriched,
          source_priority: "osm_primary" as const,
          canonical_key: key,
        });
        osmPrimaryCount++;

        // Include additional OSM rows for the same canonical key (distinct physical attractions)
        for (const extra of sortedOsm.slice(1)) {
          resolved.push({
            ...extra,
            source_priority: "osm_primary" as const,
            canonical_key: key,
          });
        }
      }

      // All manual_seed rows in this group are suppressed (either replaced or not needed)
      suppressedCount += manual.length;
    } else {
      // No OSM equivalent found — keep manual_seed rows as the only source
      for (const m of manual) {
        resolved.push({
          ...m,
          source_priority: "manual_only" as const,
          canonical_key: key,
        });
        manualOnlyCount++;
      }
    }
  }

  // Pass through attractions with unrecognized or null source unchanged
  resolved.push(...otherAttractions);

  console.log("[source-priority] Attraction resolution complete:", {
    input: attractions.length,
    resolved: resolved.length,
    duplicateGroups: duplicateGroupCount,
    osmPrimary: osmPrimaryCount,
    manualFallback: manualFallbackCount,
    manualOnly: manualOnlyCount,
    manualSuppressed: suppressedCount,
  });

  return resolved;
}

/**
 * Builds a Map from canonical key → manual_seed attraction for fast fallback lookup.
 * Only the first valid manual_seed row per key is stored.
 */
export function buildAttractionFallbackMap(
  manualAttractions: Attraction[]
): Map<string, Attraction> {
  const map = new Map<string, Attraction>();
  for (const a of manualAttractions) {
    const key = getCanonicalAttractionKey(a);
    if (!map.has(key)) {
      map.set(key, a);
    }
  }
  return map;
}

/**
 * Finds the manual_seed fallback row for a given OSM attraction, if one exists.
 */
export function findManualFallbackForOsm(
  osmAttraction: Attraction,
  allAttractions: Attraction[]
): Attraction | null {
  const key = getCanonicalAttractionKey(osmAttraction);
  return (
    allAttractions.find(
      (a) =>
        a.source === "manual_seed" && getCanonicalAttractionKey(a) === key
    ) ?? null
  );
}

function enrichWithFallback(primary: Attraction, fallback: Attraction | null): Attraction {
  if (!fallback) return primary;
  return {
    ...primary,
    description: primary.description ?? fallback.description,
    rating: primary.rating ?? fallback.rating,
    estimated_visit_duration:
      primary.estimated_visit_duration > 0
        ? primary.estimated_visit_duration
        : fallback.estimated_visit_duration,
  };
}

function byValidityThenQuality(a: Attraction, b: Attraction): number {
  const aValid = isValidAttractionForItinerary(a) ? 1 : 0;
  const bValid = isValidAttractionForItinerary(b) ? 1 : 0;
  if (aValid !== bValid) return bValid - aValid;
  return (Number(b.data_quality_score) || 0) - (Number(a.data_quality_score) || 0);
}
