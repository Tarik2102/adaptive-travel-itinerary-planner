import "dotenv/config";
import dotenv from "dotenv";
import path from "path";
import { Pool } from "pg";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

// ── Constants ──────────────────────────────────────────────────────────────

const MAX_IMAGES_PER_ATTRACTION = 5;
const REQUEST_DELAY_MS = 350;
const GEO_RADIUS_METERS = 150;
const GEO_RESULT_LIMIT = 10;
const CATEGORY_RESULT_LIMIT = 8;
const NAME_SEARCH_LIMIT = 5;
const MIN_IMAGE_DIMENSION = 100;

const WIKIMEDIA_USER_AGENT =
  "AdaptiveTravelItineraryPlanner/1.0 (academic master project; contact: tariktinjak123@gmail.com)";

const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const WIKIDATA_API = "https://www.wikidata.org/w/api.php";

// ── Types ──────────────────────────────────────────────────────────────────

type DbAttraction = {
  id: number;
  name: string;
  latitude: string | number;
  longitude: string | number;
  wikidata_id: string | null;
  category: string;
  primary_category: string | null;
};

type ImageCandidate = {
  image_url: string;
  thumbnail_url: string | null;
  source: string;
  source_page: string | null;
  title: string | null;
  author: string | null;
  license: string | null;
  attribution: string | null;
  width: number | null;
  height: number | null;
};

type CommonsImageInfo = {
  url: string;
  thumburl?: string;
  width: number;
  height: number;
  mediatype: string;
  extmetadata?: Record<string, { value: string }>;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

function commonsFilePageUrl(fileTitle: string): string {
  const withPrefix = fileTitle.startsWith("File:")
    ? fileTitle
    : `File:${fileTitle}`;
  return `https://commons.wikimedia.org/wiki/${encodeURIComponent(withPrefix).replace(/%20/g, "_")}`;
}

function parseImageInfo(
  title: string,
  info: CommonsImageInfo,
  source: string
): ImageCandidate | null {
  if (!info.url) return null;
  if (info.mediatype !== "BITMAP" && info.mediatype !== "DRAWING") return null;
  if (info.width < MIN_IMAGE_DIMENSION || info.height < MIN_IMAGE_DIMENSION)
    return null;

  const meta = info.extmetadata ?? {};
  const licenseRaw =
    meta.LicenseShortName?.value ?? meta.License?.value ?? null;
  const license = licenseRaw ? stripHtml(licenseRaw) : null;
  const authorRaw = meta.Artist?.value ?? meta.Credit?.value ?? null;
  const author = authorRaw ? stripHtml(authorRaw) : null;
  const attribution =
    author && license
      ? `${author} / Wikimedia Commons / ${license}`
      : author
        ? `${author} / Wikimedia Commons`
        : license
          ? `Wikimedia Commons / ${license}`
          : "Wikimedia Commons";

  const fileTitle = title.startsWith("File:") ? title : `File:${title}`;

  return {
    image_url: info.url,
    thumbnail_url: info.thumburl ?? null,
    source,
    source_page: commonsFilePageUrl(fileTitle),
    title: fileTitle,
    author,
    license,
    attribution,
    width: info.width,
    height: info.height,
  };
}

// ── Wikimedia Commons imageinfo fetcher ────────────────────────────────────

async function fetchCommonsImageInfo(
  fileTitles: string[],
  source: string
): Promise<ImageCandidate[]> {
  if (fileTitles.length === 0) return [];

  const titlesParam = fileTitles
    .map((t) => (t.startsWith("File:") ? t : `File:${t}`))
    .join("|");

  const params = new URLSearchParams({
    action: "query",
    titles: titlesParam,
    prop: "imageinfo",
    iiprop: "url|extmetadata|size|mediatype",
    iiurlwidth: "800",
    format: "json",
    formatversion: "2",
  });

  const resp = await fetch(`${COMMONS_API}?${params}`, {
    headers: { "User-Agent": WIKIMEDIA_USER_AGENT },
  });

  if (!resp.ok) return [];

  const data = await resp.json();
  const pages: Array<{ title: string; imageinfo?: CommonsImageInfo[] }> =
    data.query?.pages ?? [];

  const results: ImageCandidate[] = [];

  for (const page of pages) {
    const info = page.imageinfo?.[0];
    if (!info) continue;
    const candidate = parseImageInfo(page.title, info, source);
    if (candidate) results.push(candidate);
  }

  return results;
}

// ── Wikidata claims fetcher ────────────────────────────────────────────────

async function fetchWikidataClaims(
  wikidataId: string
): Promise<{ p18Files: string[]; p373Category: string | null }> {
  const params = new URLSearchParams({
    action: "wbgetentities",
    ids: wikidataId,
    format: "json",
    props: "claims",
    formatversion: "2",
  });

  const resp = await fetch(`${WIKIDATA_API}?${params}`, {
    headers: { "User-Agent": WIKIMEDIA_USER_AGENT },
  });

  if (!resp.ok) return { p18Files: [], p373Category: null };

  const data = await resp.json();
  const entity = data.entities?.[wikidataId];
  if (!entity?.claims) return { p18Files: [], p373Category: null };

  const p18Claims: Array<{ mainsnak?: { datavalue?: { value?: string } } }> =
    entity.claims.P18 ?? [];
  const p18Files = p18Claims
    .map((c) => c.mainsnak?.datavalue?.value ?? "")
    .filter(Boolean);

  const p373Claims: Array<{ mainsnak?: { datavalue?: { value?: string } } }> =
    entity.claims.P373 ?? [];
  const p373Category =
    p373Claims[0]?.mainsnak?.datavalue?.value ?? null;

  return { p18Files, p373Category };
}

// ── Commons category members ───────────────────────────────────────────────

async function fetchCommonsCategoryFiles(
  category: string,
  limit: number
): Promise<string[]> {
  const params = new URLSearchParams({
    action: "query",
    list: "categorymembers",
    cmtitle: `Category:${category}`,
    cmtype: "file",
    cmlimit: String(limit),
    format: "json",
    formatversion: "2",
  });

  const resp = await fetch(`${COMMONS_API}?${params}`, {
    headers: { "User-Agent": WIKIMEDIA_USER_AGENT },
  });

  if (!resp.ok) return [];

  const data = await resp.json();
  const members: Array<{ title: string }> = data.query?.categorymembers ?? [];
  return members.map((m) => m.title).filter((t) => t.startsWith("File:"));
}

// ── Commons geosearch ──────────────────────────────────────────────────────

async function fetchCommonsGeosearchFiles(
  lat: number,
  lon: number,
  radius: number,
  limit: number
): Promise<string[]> {
  const params = new URLSearchParams({
    action: "query",
    list: "geosearch",
    gscoord: `${lat}|${lon}`,
    gsradius: String(radius),
    gsnamespace: "6",
    gslimit: String(limit),
    format: "json",
    formatversion: "2",
  });

  const resp = await fetch(`${COMMONS_API}?${params}`, {
    headers: { "User-Agent": WIKIMEDIA_USER_AGENT },
  });

  if (!resp.ok) return [];

  const data = await resp.json();
  const results: Array<{ title: string }> = data.query?.geosearch ?? [];
  return results.map((r) => r.title).filter((t) => t.startsWith("File:"));
}

// ── Commons name search ────────────────────────────────────────────────────

async function fetchCommonsByName(
  name: string,
  limit: number
): Promise<string[]> {
  const params = new URLSearchParams({
    action: "query",
    list: "search",
    srsearch: `${name} Sarajevo`,
    srnamespace: "6",
    srlimit: String(limit),
    format: "json",
    formatversion: "2",
  });

  const resp = await fetch(`${COMMONS_API}?${params}`, {
    headers: { "User-Agent": WIKIMEDIA_USER_AGENT },
  });

  if (!resp.ok) return [];

  const data = await resp.json();
  const results: Array<{ title: string }> = data.query?.search ?? [];
  return results.map((r) => r.title).filter((t) => t.startsWith("File:"));
}

// ── Per-attraction enrichment ──────────────────────────────────────────────

async function enrichAttraction(
  attraction: DbAttraction
): Promise<ImageCandidate[]> {
  const candidates: ImageCandidate[] = [];
  const seenUrls = new Set<string>();

  function addCandidates(incoming: ImageCandidate[]) {
    for (const c of incoming) {
      if (!seenUrls.has(c.image_url)) {
        seenUrls.add(c.image_url);
        candidates.push(c);
      }
    }
  }

  const lat = Number(attraction.latitude);
  const lon = Number(attraction.longitude);

  // 1. Wikidata P18 image
  if (attraction.wikidata_id) {
    try {
      const { p18Files, p373Category } = await fetchWikidataClaims(
        attraction.wikidata_id
      );
      await delay(REQUEST_DELAY_MS);

      if (p18Files.length > 0) {
        const images = await fetchCommonsImageInfo(
          p18Files.slice(0, MAX_IMAGES_PER_ATTRACTION),
          "wikidata"
        );
        addCandidates(images);
        await delay(REQUEST_DELAY_MS);
      }

      // 2. Wikidata P373 Commons category
      if (p373Category && candidates.length < MAX_IMAGES_PER_ATTRACTION) {
        const fileTitles = await fetchCommonsCategoryFiles(
          p373Category,
          CATEGORY_RESULT_LIMIT
        );
        await delay(REQUEST_DELAY_MS);

        if (fileTitles.length > 0) {
          const images = await fetchCommonsImageInfo(
            fileTitles.slice(0, MAX_IMAGES_PER_ATTRACTION),
            "wikimedia_commons"
          );
          addCandidates(images);
          await delay(REQUEST_DELAY_MS);
        }
      }
    } catch (err) {
      console.warn(
        `  [warn] Wikidata/category lookup failed for "${attraction.name}":`,
        (err as Error).message
      );
    }
  }

  // 3. Commons geosearch fallback
  if (
    candidates.length < MAX_IMAGES_PER_ATTRACTION &&
    Number.isFinite(lat) &&
    Number.isFinite(lon)
  ) {
    try {
      const fileTitles = await fetchCommonsGeosearchFiles(
        lat,
        lon,
        GEO_RADIUS_METERS,
        GEO_RESULT_LIMIT
      );
      await delay(REQUEST_DELAY_MS);

      if (fileTitles.length > 0) {
        const images = await fetchCommonsImageInfo(
          fileTitles.slice(0, MAX_IMAGES_PER_ATTRACTION),
          "wikimedia_commons"
        );
        addCandidates(images);
        await delay(REQUEST_DELAY_MS);
      }
    } catch (err) {
      console.warn(
        `  [warn] Geosearch failed for "${attraction.name}":`,
        (err as Error).message
      );
    }
  }

  // 4. Name-based Commons search fallback
  if (candidates.length < MAX_IMAGES_PER_ATTRACTION) {
    try {
      const fileTitles = await fetchCommonsByName(
        attraction.name,
        NAME_SEARCH_LIMIT
      );
      await delay(REQUEST_DELAY_MS);

      if (fileTitles.length > 0) {
        const images = await fetchCommonsImageInfo(
          fileTitles.slice(0, MAX_IMAGES_PER_ATTRACTION),
          "wikimedia_commons"
        );
        addCandidates(images);
        await delay(REQUEST_DELAY_MS);
      }
    } catch (err) {
      console.warn(
        `  [warn] Name search failed for "${attraction.name}":`,
        (err as Error).message
      );
    }
  }

  return candidates.slice(0, MAX_IMAGES_PER_ATTRACTION);
}

// ── Argument parsing ──────────────────────────────────────────────────────

type CliOptions = { apply: boolean; limit: number | null };

function parseCliArgs(): CliOptions {
  // Scan the full process.argv rather than slice(2).
  // tsx 4.x on Windows via npm can put the script path at argv[2],
  // and some npm/shell combinations may shift positions further.
  // Scanning everything ensures we find our flags regardless of position.
  const all = process.argv;

  const apply = all.some((a) => a === "--apply");

  let limit: number | null = null;
  for (let i = 0; i < all.length; i++) {
    // Support: --limit 10
    if (all[i] === "--limit" && i + 1 < all.length) {
      const v = parseInt(all[i + 1], 10);
      if (!isNaN(v) && v > 0) {
        limit = v;
        break;
      }
    }
    // Support: --limit=10
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
    `Parsed options: { dryRun: ${!apply}, apply: ${apply}, limit: ${limit ?? "none"} }`
  );
  console.log(
    apply ? "MODE: APPLY (writing to database)" : "MODE: DRY-RUN (no writes)"
  );
  if (limit !== null) console.log(`LIMIT: ${limit} attractions`);
  console.log("=".repeat(60));

  let attractions: DbAttraction[];
  try {
    const result = await pool.query<DbAttraction>(`
      SELECT id, name, latitude, longitude, wikidata_id, category, primary_category
      FROM attractions
      WHERE COALESCE(is_active, true) = true
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

  console.log(`\nLoaded ${attractions.length} active attractions.\n`);

  let totalImagesFound = 0;
  let attractionsWithImages = 0;
  let attractionsWithoutImages = 0;

  for (const attraction of attractions) {
    console.log(
      `\n[${attraction.id}] ${attraction.name}${attraction.wikidata_id ? ` (${attraction.wikidata_id})` : ""}`
    );

    let images: ImageCandidate[] = [];
    try {
      images = await enrichAttraction(attraction);
    } catch (err) {
      console.error(
        `  ERROR processing attraction ${attraction.id}:`,
        (err as Error).message
      );
    }

    if (images.length === 0) {
      console.log("  No images found.");
      attractionsWithoutImages++;
      continue;
    }

    attractionsWithImages++;
    totalImagesFound += images.length;
    const primary = images[0];

    console.log(`  Found ${images.length} image(s).`);
    console.log(
      `  Primary: ${primary.title ?? primary.image_url.split("/").pop()} [${primary.source}] ${primary.license ?? "no license"}`
    );
    console.log(
      `  Would update attractions.image_url = ${primary.image_url.slice(0, 80)}...`
    );
    console.log(`  Would insert ${images.length} row(s) into attraction_images.`);

    if (apply) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        for (let i = 0; i < images.length; i++) {
          const img = images[i];
          await client.query(
            `
            INSERT INTO attraction_images
              (attraction_id, image_url, thumbnail_url, source, source_page,
               title, author, license, attribution, width, height,
               sort_order, is_primary)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
            ON CONFLICT (attraction_id, image_url) DO UPDATE SET
              thumbnail_url = EXCLUDED.thumbnail_url,
              source        = EXCLUDED.source,
              source_page   = EXCLUDED.source_page,
              title         = EXCLUDED.title,
              author        = EXCLUDED.author,
              license       = EXCLUDED.license,
              attribution   = EXCLUDED.attribution,
              width         = EXCLUDED.width,
              height        = EXCLUDED.height,
              sort_order    = EXCLUDED.sort_order,
              is_primary    = EXCLUDED.is_primary,
              updated_at    = CURRENT_TIMESTAMP
            `,
            [
              attraction.id,
              img.image_url,
              img.thumbnail_url,
              img.source,
              img.source_page,
              img.title,
              img.author,
              img.license,
              img.attribution,
              img.width,
              img.height,
              i,
              i === 0,
            ]
          );
        }

        await client.query(
          `UPDATE attractions SET image_url = $1 WHERE id = $2`,
          [primary.image_url, attraction.id]
        );

        await client.query("COMMIT");
        console.log(`  Applied: inserted/updated ${images.length} image(s).`);
      } catch (err) {
        await client.query("ROLLBACK");
        console.error(`  ROLLBACK for attraction ${attraction.id}:`, err);
      } finally {
        client.release();
      }
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("Summary:");
  console.log(`  Attractions processed : ${attractions.length}`);
  console.log(`  With images found     : ${attractionsWithImages}`);
  console.log(`  Without images        : ${attractionsWithoutImages}`);
  console.log(`  Total images found    : ${totalImagesFound}`);
  console.log(apply ? "  Database updated." : "  Dry-run — no changes made.");
  console.log("=".repeat(60));

  await pool.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
