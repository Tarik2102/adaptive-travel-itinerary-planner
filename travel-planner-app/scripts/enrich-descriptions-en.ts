import "dotenv/config";
import dotenv from "dotenv";
import path from "path";
import { Pool } from "pg";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

// ── Constants ──────────────────────────────────────────────────────────────

const REQUEST_DELAY_MS = 500;
const TRANSLATE_DELAY_MS = 1000; // polite delay between MyMemory API calls

// MyMemory free tier: 10 000 chars/day with email, no API key.
// Using the project contact email to raise the daily char limit.
const MYMEMORY_API = "https://api.mymemory.translated.net/get";
const MYMEMORY_EMAIL = "tariktinjak123@gmail.com";
const MAX_DESCRIPTION_CHARS = 280;
const DRY_RUN_LLM_SAMPLES = 10;

const WIKIPEDIA_USER_AGENT =
  "AdaptiveTravelItineraryPlanner/1.0 (academic master project; contact: tariktinjak123@gmail.com)";

const WIKIDATA_API = "https://www.wikidata.org/w/api.php";

// ── Types ──────────────────────────────────────────────────────────────────

type DbAttraction = {
  id: number;
  name: string;
  description: string | null;
  description_source: string | null;
  latitude: string | number;
  longitude: string | number;
  wikidata_id: string | null;
};

type EnrichResult = {
  description_en: string;
  description_en_source: string;
};

type WikipediaSummary = {
  type: string;
  extract: string;
  coordinates?: { lat: number; lon: number };
};

// ── Source classification ──────────────────────────────────────────────────

function isLocalLanguageSource(source: string | null): boolean {
  if (!source) return false;
  return (
    source.endsWith("_bs") ||
    source.endsWith("_sr") ||
    source.endsWith("_hr")
  );
}

// Maps source suffix to a BCP-47 tag accepted by Google Translate.
function sourceLanguageCode(source: string): string {
  if (source.endsWith("_bs")) return "bs";
  if (source.endsWith("_sr")) return "sr";
  if (source.endsWith("_hr")) return "hr";
  return "auto";
}

function sourceLanguageLabel(source: string): string {
  if (source.endsWith("_bs")) return "Bosnian";
  if (source.endsWith("_sr")) return "Serbian";
  if (source.endsWith("_hr")) return "Croatian";
  return "local";
}

// ── Helpers ────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Takes the first 1–2 sentences up to maxChars. Never splits mid-sentence.
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

// ── Layer 1: English Wikipedia via Wikidata ────────────────────────────────
// Checks if the Wikidata entity has an enwiki sitelink and fetches its English summary.
// Authoritative match — no coordinate check needed (Wikidata link is canonical).

async function fetchEnglishWikipediaFromWikidata(
  wikidataId: string
): Promise<string | null> {
  const params = new URLSearchParams({
    action: "wbgetentities",
    ids: wikidataId,
    props: "sitelinks",
    sitefilter: "enwiki",
    format: "json",
    formatversion: "2",
  });

  let wdResp: Response;
  try {
    wdResp = await fetch(`${WIKIDATA_API}?${params}`, {
      headers: { "User-Agent": WIKIPEDIA_USER_AGENT },
    });
  } catch {
    return null;
  }

  if (!wdResp.ok) return null;

  let enTitle: string | undefined;
  try {
    const data = await wdResp.json();
    enTitle = data.entities?.[wikidataId]?.sitelinks?.enwiki?.title as
      | string
      | undefined;
  } catch {
    return null;
  }

  if (!enTitle) return null;

  await delay(REQUEST_DELAY_MS);

  let wpResp: Response;
  try {
    wpResp = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(enTitle)}`,
      {
        headers: {
          "User-Agent": WIKIPEDIA_USER_AGENT,
          Accept: "application/json",
        },
      }
    );
  } catch {
    return null;
  }

  if (!wpResp.ok) return null;

  let summary: WikipediaSummary;
  try {
    summary = (await wpResp.json()) as WikipediaSummary;
  } catch {
    return null;
  }

  if (summary.type === "disambiguation") return null;
  if (!summary.extract?.trim()) return null;

  const description = extractFirstSentences(summary.extract);
  return description.length >= 40 ? description : null;
}

// ── Layer 2: Free machine translation (MyMemory) ──────────────────────────
// MyMemory (mymemory.translated.net) is a free REST API designed for
// programmatic translation — no API key, no npm package, just fetch.
// Using the project email raises the daily free limit to 10 000 chars.
// Supports bs, hr, sr → en. Sequential with small polite delays.

type MyMemoryResponse = {
  responseData: { translatedText: string; match: number };
  responseStatus: number;
  responseDetails?: string;
};

async function machineTranslate(
  text: string,
  from: string
): Promise<string | null> {
  const url = new URL(MYMEMORY_API);
  url.searchParams.set("q", text);
  url.searchParams.set("langpair", `${from}|en`);
  url.searchParams.set("de", MYMEMORY_EMAIL);

  let resp: Response;
  try {
    resp = await fetch(url.toString(), {
      headers: { "User-Agent": WIKIPEDIA_USER_AGENT },
    });
  } catch (err) {
    console.error("  Network error:", (err as Error).message);
    return null;
  }

  if (!resp.ok) {
    console.error(`  MyMemory error: HTTP ${resp.status}`);
    return null;
  }

  let data: MyMemoryResponse;
  try {
    data = (await resp.json()) as MyMemoryResponse;
  } catch {
    console.error("  MyMemory: invalid JSON response");
    return null;
  }

  if (data.responseStatus !== 200) {
    console.error(`  MyMemory: status ${data.responseStatus} — ${data.responseDetails ?? ""}`);
    return null;
  }

  const translated = data.responseData.translatedText?.trim();
  if (!translated || translated.length < 20) return null;

  return translated.length > MAX_DESCRIPTION_CHARS
    ? translated.slice(0, MAX_DESCRIPTION_CHARS - 1) + "…"
    : translated;
}

// ── Per-attraction logic ───────────────────────────────────────────────────
// Returns:
//   EnrichResult    — a resolved English description (copy, Wikipedia, or translated)
//   "translate_me"  — local-language, no English Wikipedia; needs machine translation
//   null            — skip (no description or unknown source)

async function resolveEnglish(
  attraction: DbAttraction
): Promise<EnrichResult | "translate_me" | null> {
  const src = attraction.description_source;
  const desc = attraction.description?.trim();

  if (!desc) return null;

  // NULL source = manual seed (real English descriptions) — copy as-is.
  if (!src) {
    return { description_en: desc, description_en_source: "manual_en" };
  }

  // Already-English sources — copy as-is.
  if (src === "wikidata_en" || src === "name_en") {
    return { description_en: desc, description_en_source: "wikipedia_en" };
  }

  if (src === "osm_template") {
    return { description_en: desc, description_en_source: "osm_template_en" };
  }

  // Local-language sources: try English Wikipedia first (Layer 1).
  if (isLocalLanguageSource(src)) {
    if (attraction.wikidata_id) {
      await delay(REQUEST_DELAY_MS);
      const enDesc = await fetchEnglishWikipediaFromWikidata(attraction.wikidata_id);
      if (enDesc) {
        console.log(
          `  → English Wikipedia (${attraction.wikidata_id} → enwiki)`
        );
        return { description_en: enDesc, description_en_source: "wikipedia_en" };
      }
    }
    // No English Wikipedia found — signal that machine translation is needed.
    return "translate_me";
  }

  return null;
}

// ── CLI argument parsing ───────────────────────────────────────────────────

type CliOptions = { apply: boolean; limit: number | null };

function parseCliArgs(): CliOptions {
  const all = process.argv;
  const apply = all.some((a) => a === "--apply");

  let limit: number | null = null;
  for (let i = 0; i < all.length; i++) {
    if (all[i] === "--limit" && i + 1 < all.length) {
      const v = parseInt(all[i + 1], 10);
      if (!isNaN(v) && v > 0) { limit = v; break; }
    }
    if (all[i].startsWith("--limit=")) {
      const v = parseInt(all[i].slice("--limit=".length), 10);
      if (!isNaN(v) && v > 0) { limit = v; break; }
    }
  }

  return { apply, limit };
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const { apply, limit } = parseCliArgs();

  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) throw new Error("DATABASE_URL missing — check .env.local");

  const pool = new Pool({ connectionString: DATABASE_URL });

  console.log("=".repeat(60));
  console.log(
    `Mode: ${apply ? "APPLY (writing to database)" : "DRY-RUN (no writes)"}`
  );
  if (limit !== null) console.log(`Limit: ${limit} attractions`);
  console.log("=".repeat(60));

  let attractions: DbAttraction[];
  try {
    const result = await pool.query<DbAttraction>(`
      SELECT id, name, description, description_source, latitude, longitude, wikidata_id
      FROM attractions
      WHERE COALESCE(is_active, true) = true
        AND description_en IS NULL
        AND description IS NOT NULL
        AND trim(description) != ''
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

  console.log(`\nAttractions to process: ${attractions.length}\n`);

  // Counters
  let copyManual = 0;
  let copyWikipediaEn = 0;
  let copyOsmTemplate = 0;
  let layer1WikipediaEn = 0;
  let layer2Translated = 0;
  let layer2Pending = 0; // dry-run: sample limit reached
  let errors = 0;

  // Samples for dry-run preview (original → translated)
  const samples: Array<{ name: string; original: string; english: string }> = [];

  for (const attraction of attractions) {
    console.log(
      `\n[${attraction.id}] ${attraction.name}` +
      (attraction.description_source ? ` [${attraction.description_source}]` : " [manual_seed]")
    );

    let outcome: EnrichResult | null = null;

    try {
      const resolved = await resolveEnglish(attraction);

      if (resolved === null) {
        continue;
      }

      if (resolved === "translate_me") {
        // Local-language, no English Wikipedia — machine translate.
        const shouldTranslate = apply || samples.length < DRY_RUN_LLM_SAMPLES;

        if (!shouldTranslate) {
          layer2Pending++;
          console.log(
            `  (dry-run sample limit — would machine-translate ${sourceLanguageLabel(attraction.description_source ?? "")})`
          );
          continue;
        }

        const from = sourceLanguageCode(attraction.description_source ?? "auto");
        const srcLang = sourceLanguageLabel(attraction.description_source ?? "");
        const original = attraction.description!.trim();

        console.log(
          `  → Machine-translating (${srcLang}): "${original.slice(0, 70)}${original.length > 70 ? "…" : ""}"`
        );

        await delay(TRANSLATE_DELAY_MS);
        const translated = await machineTranslate(original, from);

        if (!translated) {
          errors++;
          console.log("  ERROR: translation returned null");
          continue;
        }

        outcome = {
          description_en: translated,
          description_en_source: "machine_translation",
        };
        layer2Translated++;

        if (!apply) {
          samples.push({ name: attraction.name, original, english: translated });
        }
      } else {
        outcome = resolved;

        switch (outcome.description_en_source) {
          case "manual_en":       copyManual++;      break;
          case "wikipedia_en":
            if (
              attraction.description_source === "wikidata_en" ||
              attraction.description_source === "name_en"
            ) {
              copyWikipediaEn++;
            } else {
              layer1WikipediaEn++;
            }
            break;
          case "osm_template_en": copyOsmTemplate++; break;
        }
      }
    } catch (err) {
      console.error(`  ERROR: ${(err as Error).message}`);
      errors++;
      continue;
    }

    if (!outcome) continue;

    const preview =
      outcome.description_en.length > 80
        ? outcome.description_en.slice(0, 77) + "…"
        : outcome.description_en;
    console.log(`  [${outcome.description_en_source}] "${preview}"`);

    if (apply) {
      try {
        await pool.query(
          `UPDATE attractions SET description_en = $1, description_en_source = $2 WHERE id = $3`,
          [outcome.description_en, outcome.description_en_source, attraction.id]
        );
      } catch (err) {
        console.error(`  DB write failed for ${attraction.id}:`, err);
        errors++;
      }
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  const totalCopy = copyManual + copyWikipediaEn + copyOsmTemplate;
  const totalLlmNeeded = layer2Translated + layer2Pending;

  console.log("\n" + "=".repeat(60));
  console.log("Summary:");
  console.log(`  Attractions processed     : ${attractions.length}`);
  console.log("");
  console.log("  Already-English (copied)  :");
  console.log(`    manual seed             : ${copyManual}`);
  console.log(`    English Wikipedia       : ${copyWikipediaEn}`);
  console.log(`    OSM template            : ${copyOsmTemplate}`);
  console.log(`    subtotal                : ${totalCopy}`);
  console.log("");
  console.log("  Layer 1 — English Wikipedia re-fetch (free):");
  console.log(`    wikipedia_en            : ${layer1WikipediaEn}`);
  console.log("");
  console.log("  Layer 2 — machine translation (free, mymemory.translated.net):");
  console.log(`    translated              : ${layer2Translated}`);
  if (!apply) {
    console.log(`    pending (sample limit)  : ${layer2Pending}`);
    console.log(`    total MT candidates     : ${totalLlmNeeded}`);
  }
  console.log("");
  console.log(`  Errors                    : ${errors}`);
  console.log(apply ? "\n  Database updated." : "\n  Dry-run — no writes made.");
  console.log("=".repeat(60));

  if (!apply && samples.length > 0) {
    console.log(
      `\n── Translation samples (${samples.length} shown of ~${totalLlmNeeded} MT candidates) ──`
    );
    for (const s of samples) {
      console.log(`\n  ${s.name}`);
      console.log(`  ORIGINAL : ${s.original}`);
      console.log(`  ENGLISH  : ${s.english}`);
    }
    console.log("\n" + "─".repeat(60));
  }

  await pool.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
