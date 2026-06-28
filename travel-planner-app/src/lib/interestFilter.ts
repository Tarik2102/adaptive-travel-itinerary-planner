import type { Attraction } from "@/types/attraction";

export type InterestGroupId = "heritage" | "food" | "nature" | "entertainment";

export type InterestGroup = {
  id: InterestGroupId;
  label: string;
  keywords: string[];
};

export const INTEREST_GROUPS: InterestGroup[] = [
  {
    id: "heritage",
    label: "Heritage & Culture",
    keywords: [
      "history", "historic", "historical", "culture", "cultural",
      "museum", "architecture", "architectural", "religious", "religion",
      "landmark", "memorial", "mosque", "church", "cathedral", "synagogue",
      "temple", "ottoman", "heritage", "monument", "palace", "fortress",
      "castle", "cemetery", "bazaar", "old town", "gazi husrev",
    ],
  },
  {
    id: "food",
    label: "Food & Local Life",
    keywords: [
      "food", "cafe", "coffee", "restaurant", "dining", "bar",
      "market", "local", "shopping", "čaršija", "carsija", "bakery",
      "burek", "grill", "cuisine", "brewery", "pub", "snack",
    ],
  },
  {
    id: "nature",
    label: "Nature & Recreation",
    keywords: [
      "nature", "park", "viewpoint", "view", "recreation", "outdoor",
      "mountain", "river", "waterfall", "forest", "hike", "hiking",
      "garden", "vista", "panorama", "trebević", "trebevic", "bjelašnica",
      "bjelasnica", "ski", "lake", "canyon", "trail", "summit",
    ],
  },
  {
    id: "entertainment",
    label: "Entertainment",
    keywords: [
      "entertainment", "theatre", "theater", "cinema", "film", "movie",
      "sports", "sport", "event", "nightlife", "concert", "gallery",
      "art", "festival", "club", "venue",
    ],
  },
];

function normalize(s: string): string {
  return s.toLowerCase().replace(/[_-]+/g, " ").trim();
}

export function getInterestGroups(attraction: Attraction): InterestGroupId[] {
  const parts: string[] = [];
  if (attraction.primary_category) parts.push(attraction.primary_category);
  if (attraction.category) parts.push(attraction.category);
  if (Array.isArray(attraction.secondary_categories)) {
    parts.push(...attraction.secondary_categories);
  }
  if (Array.isArray(attraction.tags)) {
    parts.push(...attraction.tags);
  }

  const combined = normalize(parts.join(" "));
  const matched: InterestGroupId[] = [];

  for (const group of INTEREST_GROUPS) {
    if (group.keywords.some((kw) => combined.includes(normalize(kw)))) {
      matched.push(group.id);
    }
  }

  return matched.length > 0 ? matched : ["heritage"];
}

export function isGenericDescription(description: string | null | undefined): boolean {
  if (!description) return true;
  const d = description.trim();
  if (d.length < 60) return true;
  const lower = d.toLowerCase();
  if (lower.includes("imported from openstreetmap")) return true;
  if (lower.includes("categorized as")) return true;
  if (lower.includes("sarajevo point of interest")) return true;
  if (lower.includes("osm_id:")) return true;
  if (/^\w[\w\s,]+ is (a|an) [\w\s]+ (in|of) sarajevo\.?$/i.test(d)) return true;
  return false;
}

// Truncates text cleanly — never mid-word — and only appends "…" when it actually truncated.
//
// Algorithm:
//   1. Strip any trailing U+2026 written by the DB enrichment scripts.
//   2. If preferSentence, try the last sentence-ending punctuation (. ! ?)
//      at or before maxLen; if found, return it without "…".
//   3. Fall back to the last word boundary at or before maxLen, append "…".
//   4. If the text fits entirely, return it untouched (truncated: false).
//
// Returns { preview, truncated } so callers can decide whether to show a "Read more" link.
export function truncateClean(
  text: string,
  maxLen: number,
  { preferSentence = false }: { preferSentence?: boolean } = {}
): { preview: string; truncated: boolean } {
  // Strip trailing enrichment ellipsis (U+2026) before any logic.
  const t = text.endsWith("…") ? text.slice(0, -1).trimEnd() : text;

  if (t.length <= maxLen) return { preview: t, truncated: false };

  // Sentence-boundary pass (period only qualifies when followed by space or end-of-string,
  // so abbreviations like "U.S.A." are skipped).
  if (preferSentence) {
    let lastSentenceEnd = -1;
    for (let i = 0; i < maxLen && i < t.length; i++) {
      const c = t[i];
      if (c === "!" || c === "?") {
        lastSentenceEnd = i;
      } else if (c === ".") {
        const next = t[i + 1];
        if (!next || next === " ") lastSentenceEnd = i;
      }
    }
    if (lastSentenceEnd >= 0) {
      return { preview: t.slice(0, lastSentenceEnd + 1), truncated: true };
    }
  }

  // Word-boundary fallback — never cut mid-word.
  const slice = t.slice(0, maxLen);
  const lastSpace = slice.lastIndexOf(" ");
  const cutAt = lastSpace > 0 ? lastSpace : maxLen;
  return { preview: t.slice(0, cutAt).trimEnd() + "…", truncated: true };
}

export function getDisplayDescription(attraction: Attraction): string {
  const raw = (() => {
    if (attraction.description_en?.trim()) return attraction.description_en.trim();
    if (attraction.description_source && attraction.description?.trim()) return attraction.description.trim();
    if (!isGenericDescription(attraction.description)) return attraction.description!.trim();
    return null;
  })();
  if (!raw) return "A point of interest in Sarajevo worth exploring.";
  return truncateClean(raw, 200, { preferSentence: true }).preview;
}

type FilteredGroup = { label: string; items: Attraction[]; total: number };

export function getFilteredGroups(
  attractions: Attraction[],
  activeFilters: Set<InterestGroupId>,
): FilteredGroup[] {
  const count = activeFilters.size;
  if (count === 0) return [];

  const maxPerGroup: number | null = count === 4 ? 4 : count === 3 ? 8 : null;

  const result: FilteredGroup[] = [];

  for (const groupId of ["heritage", "food", "nature", "entertainment"] as InterestGroupId[]) {
    if (!activeFilters.has(groupId)) continue;
    const groupDef = INTEREST_GROUPS.find((g) => g.id === groupId)!;
    const matching = attractions.filter((a) => getInterestGroups(a).includes(groupId));
    const items = maxPerGroup !== null ? matching.slice(0, maxPerGroup) : matching;
    if (items.length > 0) {
      result.push({ label: groupDef.label, items, total: matching.length });
    }
  }

  return result;
}
