import "dotenv/config";
import dotenv from "dotenv";
import path from "path";
import { Pool } from "pg";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

// ── Constants ──────────────────────────────────────────────────────────────

const REQUEST_DELAY_MS = 500;
const MAX_DESCRIPTION_CHARS = 280;
const COORD_TOLERANCE_KM = 3;

// Priority order for Wikipedia language editions to try.
// Local-language articles are preferred for a Sarajevo app; enwiki is the final fallback.
const LANG_PRIORITY = ["bs", "hr", "sr", "en"] as const;
type Lang = (typeof LANG_PRIORITY)[number];

const WIKIPEDIA_USER_AGENT =
  "AdaptiveTravelItineraryPlanner/1.0 (academic master project; contact: tariktinjak123@gmail.com)";

const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
const OSM_API = "https://api.openstreetmap.org/api/0.6";

// ── Types ──────────────────────────────────────────────────────────────────

type DbAttraction = {
  id: number;
  name: string;
  description: string | null;
  latitude: string | number;
  longitude: string | number;
  wikidata_id: string | null;
  osm_type: string | null;
  osm_id: string | null;
  primary_category: string | null;
  category: string;
  secondary_categories: string[] | null;
  tags: string[] | null;
  indoor_outdoor: string | null;
  is_indoor: boolean | null;
  is_outdoor: boolean | null;
};

type EnrichmentResult = {
  description: string;
  // Encodes path + language: "wikidata_bs", "wikidata_en", "osm_wp_bs",
  // "name_bs", "name_en", "osm_template", etc.
  source: string;
};

type WikipediaSummary = {
  type: string;
  extract: string;
  coordinates?: { lat: number; lon: number };
};

// ── Helpers ────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Takes first 1–2 sentences up to maxChars. Never splits mid-sentence.
function extractFirstSentences(
  text: string,
  maxChars = MAX_DESCRIPTION_CHARS
): string {
  const cleaned = text.replace(/\s+/g, " ").trim();

  const matches = [...cleaned.matchAll(/[.!?]\s+(?=[A-Z])/g)];

  if (matches.length === 0) {
    return cleaned.length > maxChars
      ? cleaned.slice(0, maxChars - 1) + "…"
      : cleaned;
  }

  const firstEnd = (matches[0].index ?? 0) + 1;
  const firstSentence = cleaned.slice(0, firstEnd).trim();

  if (firstSentence.length > maxChars) {
    return firstSentence.slice(0, maxChars - 1) + "…";
  }

  if (matches.length >= 2 && firstSentence.length < 160) {
    const secondEnd = (matches[1].index ?? 0) + 1;
    const two = cleaned.slice(0, secondEnd).trim();
    if (two.length <= maxChars) return two;
  }

  return firstSentence;
}

// ── Wikidata: fetch sitelinks in all target languages ─────────────────────

async function getWikipediaLinksFromWikidata(
  wikidataId: string
): Promise<Array<{ lang: Lang; title: string }>> {
  const sitefilter = LANG_PRIORITY.map((l) => `${l}wiki`).join("|");

  const params = new URLSearchParams({
    action: "wbgetentities",
    ids: wikidataId,
    props: "sitelinks",
    sitefilter,
    format: "json",
    formatversion: "2",
  });

  let resp: Response;
  try {
    resp = await fetch(`${WIKIDATA_API}?${params}`, {
      headers: { "User-Agent": WIKIPEDIA_USER_AGENT },
    });
  } catch {
    return [];
  }

  if (!resp.ok) return [];

  try {
    const data = await resp.json();
    const sitelinks = data.entities?.[wikidataId]?.sitelinks ?? {};

    const results: Array<{ lang: Lang; title: string }> = [];
    for (const lang of LANG_PRIORITY) {
      const key = `${lang}wiki`;
      const title = sitelinks[key]?.title as string | undefined;
      if (title) results.push({ lang, title });
    }
    return results;
  } catch {
    return [];
  }
}

// ── Wikipedia REST summary (language-parameterised) ───────────────────────

async function fetchWikipediaSummary(
  lang: string,
  title: string
): Promise<WikipediaSummary | null> {
  const base = `https://${lang}.wikipedia.org/api/rest_v1/page/summary`;
  let resp: Response;
  try {
    resp = await fetch(`${base}/${encodeURIComponent(title)}`, {
      headers: {
        "User-Agent": WIKIPEDIA_USER_AGENT,
        Accept: "application/json",
      },
    });
  } catch {
    return null;
  }

  if (resp.status === 404) return null;
  if (!resp.ok) return null;

  try {
    return (await resp.json()) as WikipediaSummary;
  } catch {
    return null;
  }
}

// ── OSM API: read the `wikipedia` tag from raw OSM data (Step 3) ──────────
// Parses the raw XML from the OSM element API and extracts a "lang:Title" value.

async function fetchOsmWikipediaTag(
  osmType: string,
  osmId: string
): Promise<{ lang: string; title: string } | null> {
  let resp: Response;
  try {
    resp = await fetch(`${OSM_API}/${osmType}/${osmId}`, {
      headers: { "User-Agent": WIKIPEDIA_USER_AGENT, Accept: "application/xml" },
    });
  } catch {
    return null;
  }

  if (!resp.ok) return null;

  try {
    const xml = await resp.text();
    const m = xml.match(/<tag k="wikipedia" v="([^"]+)"/);
    if (!m) return null;

    const value = m[1]; // e.g. "bs:Bijela tabija" or "en:White Fortress"
    const colon = value.indexOf(":");
    if (colon < 1) return null;

    return {
      lang: value.slice(0, colon).toLowerCase(),
      title: value.slice(colon + 1),
    };
  } catch {
    return null;
  }
}

// ── OSM attribute-based template ───────────────────────────────────────────

function buildOsmTemplate(attraction: DbAttraction): string {
  const cat = (
    attraction.primary_category || attraction.category || ""
  ).toLowerCase();
  const secondaryCats = (attraction.secondary_categories ?? []).map((s) =>
    s.toLowerCase()
  );
  const tags = (attraction.tags ?? []).map((t) => t.toLowerCase());
  const io = (attraction.indoor_outdoor ?? "").toLowerCase();

  const isOttoman =
    secondaryCats.includes("ottoman") ||
    tags.includes("ottoman era") ||
    tags.includes("ottoman");
  const isWarHistory =
    secondaryCats.includes("war history") ||
    tags.includes("war history") ||
    tags.includes("wartime");
  const isHistoric =
    tags.includes("historic") ||
    isOttoman ||
    secondaryCats.includes("history") ||
    secondaryCats.includes("heritage") ||
    secondaryCats.includes("architecture");

  const isIndoor =
    io === "indoor" || io === "both" || attraction.is_indoor === true;
  const isOutdoor =
    io === "outdoor" || io === "both" || attraction.is_outdoor === true;
  const locationAdj =
    isIndoor && !isOutdoor
      ? "indoor"
      : isOutdoor && !isIndoor
        ? "outdoor"
        : null;

  const historicNote = isOttoman
    ? " with roots in the Ottoman period"
    : isWarHistory
      ? ", connected to Sarajevo's wartime history"
      : isHistoric
        ? " of historic significance"
        : "";

  switch (cat) {
    case "museum":
      return `A${locationAdj ? ` ${locationAdj}` : ""} museum in Sarajevo dedicated to local history and cultural heritage.`;
    case "history":
      return `A historic site in Sarajevo${historicNote} with cultural and historical significance.`;
    case "religious":
      return `A religious landmark in Sarajevo${historicNote} representing the city's diverse spiritual heritage.`;
    case "nature":
    case "park":
      return `A natural attraction near Sarajevo offering scenic surroundings and space for outdoor exploration.`;
    case "culture":
      return `A cultural landmark in Sarajevo${historicNote} reflecting the city's rich and layered heritage.`;
    case "art":
      return `An${locationAdj ? ` ${locationAdj}` : ""} art venue in Sarajevo showcasing local and regional creative works.`;
    case "sports":
      return `A sports and recreation facility in Sarajevo welcoming active visitors and local enthusiasts.`;
    case "viewpoint":
      return `An outdoor viewpoint in Sarajevo offering panoramic views over the city and its surrounding hills.`;
    case "entertainment":
      return `An entertainment venue in Sarajevo offering a variety of leisure and social activities for visitors.`;
    case "shopping":
      return `A shopping destination in Sarajevo featuring local goods, crafts, and traditional Bosnian products.`;
    case "food":
      return `A dining venue in Sarajevo serving local Bosnian and regional cuisine to residents and visitors.`;
    case "nightlife":
      return `A nightlife venue in Sarajevo offering evening entertainment and a lively social atmosphere.`;
    default:
      if (
        cat === "nature" ||
        tags.includes("park") ||
        tags.includes("nature")
      ) {
        return `A natural attraction near Sarajevo offering scenic surroundings and space for outdoor exploration.`;
      }
      if (isHistoric) {
        return `A historic point of interest in Sarajevo${historicNote}, worth a visit for its cultural value.`;
      }
      return `A notable attraction in Sarajevo offering a glimpse into the city's local character and culture.`;
  }
}

// ── Per-attraction enrichment logic ────────────────────────────────────────

async function enrichAttraction(
  attraction: DbAttraction
): Promise<EnrichmentResult> {
  const lat = Number(attraction.latitude);
  const lon = Number(attraction.longitude);

  // ── Source 1: Wikidata sitelinks → bs > hr > sr > en ─────────────────────
  // A Wikidata-linked article is authoritative regardless of language;
  // prefer local-language articles for a Sarajevo context.
  if (attraction.wikidata_id) {
    await delay(REQUEST_DELAY_MS);
    const links = await getWikipediaLinksFromWikidata(attraction.wikidata_id);

    for (const { lang, title } of links) {
      await delay(REQUEST_DELAY_MS);
      const summary = await fetchWikipediaSummary(lang, title);

      if (
        summary &&
        summary.type !== "disambiguation" &&
        summary.extract?.trim()
      ) {
        const description = extractFirstSentences(summary.extract);
        if (description.length >= 40) {
          console.log(
            `  → Wikipedia via Wikidata (${attraction.wikidata_id} → ${lang}wiki: "${title}")`
          );
          return { description, source: `wikidata_${lang}` };
        }
      }
    }
  }

  // ── Source 2: OSM `wikipedia` tag (Step 3) ────────────────────────────────
  // For OSM-sourced attractions with no wikidata_id, the raw OSM element may
  // carry a `wikipedia=bs:Article Name` tag that specifies language + title
  // directly — treat as high-confidence (no coord check needed).
  if (!attraction.wikidata_id && attraction.osm_type && attraction.osm_id) {
    await delay(REQUEST_DELAY_MS);
    const osmWp = await fetchOsmWikipediaTag(attraction.osm_type, attraction.osm_id);

    if (osmWp) {
      await delay(REQUEST_DELAY_MS);
      const summary = await fetchWikipediaSummary(osmWp.lang, osmWp.title);

      if (
        summary &&
        summary.type !== "disambiguation" &&
        summary.extract?.trim()
      ) {
        const description = extractFirstSentences(summary.extract);
        if (description.length >= 40) {
          console.log(
            `  → Wikipedia via OSM tag (${osmWp.lang}:${osmWp.title})`
          );
          return { description, source: `osm_wp_${osmWp.lang}` };
        }
      }
    }
  }

  // ── Source 3: Name search across language editions (bs > hr > sr > en) ────
  // Same confidence guards as before: no disambiguation, coordinates present,
  // article coords within COORD_TOLERANCE_KM of the attraction.
  // For local-language editions only try the bare name (the article IS the name).
  // For English, also try "name Sarajevo" to handle disambiguation pages.
  for (const lang of LANG_PRIORITY) {
    const namesToTry =
      lang === "en"
        ? [attraction.name, `${attraction.name} Sarajevo`]
        : [attraction.name];

    for (const nameAttempt of namesToTry) {
      await delay(REQUEST_DELAY_MS);
      const summary = await fetchWikipediaSummary(lang, nameAttempt);
      if (!summary) continue;

      if (summary.type === "disambiguation") {
        console.log(
          `  → Wikipedia [${lang}] "${nameAttempt}": disambiguation, skipping`
        );
        continue;
      }

      if (!summary.extract?.trim()) continue;

      // Require coordinates for name-based lookup — no other way to confirm
      // we have the right article.
      if (!summary.coordinates) {
        console.log(
          `  → Wikipedia [${lang}] "${nameAttempt}": no coordinates, skipping`
        );
        continue;
      }

      const distKm = haversineKm(
        lat,
        lon,
        summary.coordinates.lat,
        summary.coordinates.lon
      );

      if (distKm > COORD_TOLERANCE_KM) {
        console.log(
          `  → Wikipedia [${lang}] "${nameAttempt}": ${distKm.toFixed(1)} km away (>${COORD_TOLERANCE_KM} km), skipping`
        );
        continue;
      }

      const description = extractFirstSentences(summary.extract);
      if (description.length >= 40) {
        console.log(
          `  → Wikipedia by name [${lang}] "${nameAttempt}" (${distKm.toFixed(1)} km)`
        );
        return { description, source: `name_${lang}` };
      }
    }
  }

  // ── Source 4: OSM attribute-based template — always succeeds ─────────────
  console.log(`  → OSM template fallback`);
  return { description: buildOsmTemplate(attraction), source: "osm_template" };
}

// ── CLI argument parsing ────────────────────────────────────────────────────

type CliOptions = { apply: boolean; limit: number | null };

function parseCliArgs(): CliOptions {
  const all = process.argv;
  const apply = all.some((a) => a === "--apply");

  let limit: number | null = null;
  for (let i = 0; i < all.length; i++) {
    if (all[i] === "--limit" && i + 1 < all.length) {
      const v = parseInt(all[i + 1], 10);
      if (!isNaN(v) && v > 0) {
        limit = v;
        break;
      }
    }
    if (all[i].startsWith("--limit=")) {
      const v = parseInt(all[i].slice("--limit=".length), 10);
      if (!isNaN(v) && v > 0) {
        limit = v;
        break;
      }
    }
  }

  return { apply, limit };
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const { apply, limit } = parseCliArgs();

  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is missing. Check travel-planner-app/.env.local"
    );
  }

  const pool = new Pool({ connectionString: DATABASE_URL });

  console.log("=".repeat(60));
  console.log(
    `Mode: ${apply ? "APPLY (writing to database)" : "DRY-RUN (no writes)"}`
  );
  if (limit !== null) console.log(`Limit: ${limit} attractions`);
  console.log("=".repeat(60));

  // Only select attractions that:
  //   (a) have not already been enriched by this script (description_source IS NULL)
  //   (b) have a null/empty description OR an OSM-generated generic one
  // This is idempotent: re-running never overwrites existing enriched descriptions.
  let attractions: DbAttraction[];
  try {
    const result = await pool.query<DbAttraction>(`
      SELECT
        id, name, description, latitude, longitude, wikidata_id,
        osm_type, osm_id,
        primary_category, category, secondary_categories, tags,
        indoor_outdoor, is_indoor, is_outdoor
      FROM attractions
      WHERE COALESCE(is_active, true) = true
        AND description_source IS NULL
        AND (
          description IS NULL
          OR trim(description) = ''
          OR lower(description) LIKE '%imported from openstreetmap%'
          OR lower(description) LIKE '%categorized as%'
          OR lower(description) LIKE '%sarajevo point of interest%'
          OR lower(description) LIKE '%osm_id:%'
        )
      ORDER BY
        COALESCE(data_quality_score, 0) DESC,
        COALESCE(popularity_score, 0) DESC,
        name ASC
      ${limit !== null ? `LIMIT ${limit}` : ""}
    `);
    attractions = result.rows;
  } catch (err) {
    console.error("Failed to load attractions:", err);
    await pool.end();
    process.exit(1);
  }

  console.log(`\nAttractions needing descriptions: ${attractions.length}\n`);

  // Track sources for the final summary
  const sourceCounts: Record<string, number> = {};

  for (const attraction of attractions) {
    console.log(
      `\n[${attraction.id}] ${attraction.name}${attraction.wikidata_id ? ` (${attraction.wikidata_id})` : ""}`
    );

    let result: EnrichmentResult;
    try {
      result = await enrichAttraction(attraction);
    } catch (err) {
      console.error(
        `  ERROR processing ${attraction.id}:`,
        (err as Error).message
      );
      sourceCounts["error"] = (sourceCounts["error"] ?? 0) + 1;
      continue;
    }

    console.log(
      `  [${result.source}] "${result.description.slice(0, 80)}${result.description.length > 80 ? "…" : ""}"`
    );

    if (apply) {
      try {
        await pool.query(
          `UPDATE attractions
           SET description = $1, description_source = $2
           WHERE id = $3`,
          [result.description, result.source, attraction.id]
        );
        console.log(`  Applied to database.`);
      } catch (err) {
        console.error(`  DB write failed for ${attraction.id}:`, err);
        sourceCounts["error"] = (sourceCounts["error"] ?? 0) + 1;
        continue;
      }
    }

    sourceCounts[result.source] = (sourceCounts[result.source] ?? 0) + 1;
  }

  // Compute totals for the summary
  let totalWikipedia = 0;
  let totalOsmTemplate = 0;
  for (const [src, cnt] of Object.entries(sourceCounts)) {
    if (src === "osm_template") totalOsmTemplate += cnt;
    else if (src !== "error") totalWikipedia += cnt;
  }

  console.log("\n" + "=".repeat(60));
  console.log("Summary:");
  console.log(`  Attractions processed : ${attractions.length}`);
  console.log(`  Wikipedia total       : ${totalWikipedia}`);
  console.log(`  OSM template fallbacks: ${totalOsmTemplate}`);
  console.log(`  Errors                : ${sourceCounts["error"] ?? 0}`);
  console.log("");
  console.log("  Breakdown by source:");
  for (const [src, cnt] of Object.entries(sourceCounts).sort()) {
    console.log(`    ${src.padEnd(20)}: ${cnt}`);
  }
  console.log(apply ? "\n  Database updated." : "\n  Dry-run — no writes made.");
  console.log("=".repeat(60));

  await pool.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
