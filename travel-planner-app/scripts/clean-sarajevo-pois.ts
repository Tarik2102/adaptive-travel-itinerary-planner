import "dotenv/config";
import dotenv from "dotenv";
import path from "path";
import { Pool } from "pg";

dotenv.config({
  path: path.resolve(process.cwd(), ".env.local"),
});

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is missing. Check travel-planner-app/.env.local");
}

const pool = new Pool({
  connectionString: DATABASE_URL,
});

type AttractionRow = {
  id: number;
  name: string;
  source: string | null;
  source_id: string | null;
  primary_category: string | null;
  category: string | null;
  secondary_categories: string[] | null;
  tags: string[] | null;
  wikidata_id: string | null;
  website: string | null;
  address: string | null;
  opening_hours: string | null;
  popularity_score: string | number | null;
  latitude: string | number | null;
  longitude: string | number | null;
};

type CleanedAttraction = {
  id: number;
  normalizedName: string;
  isActive: boolean;
  isFeatured: boolean;
  dataQualityScore: number;
  cleaningNotes: string[];
  category: string;
};

const CATEGORY_LIMITS: Record<string, number> = {
  Food: 45,
  Cafe: 30,
  History: 80,
  Museum: 50,
  Culture: 60,
  Religion: 50,
  Nature: 50,
  Viewpoint: 35,
  Sport: 30,
  Entertainment: 30,
  Shopping: 25,
  Architecture: 50,
  "War History": 40,
};

const STRONG_CATEGORIES = new Set([
  "History",
  "Museum",
  "Culture",
  "Religion",
  "Nature",
  "Viewpoint",
  "Architecture",
  "War History",
]);

const GENERIC_NAMES = new Set([
  "art",
  "boss",
  "club",
  "bar",
  "caffe",
  "cafe",
  "restaurant",
  "fast food",
  "market",
  "shop",
  "center",
  "centre",
  "park",
]);

function normalizeName(name: string) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getCategory(row: AttractionRow) {
  return row.primary_category || row.category || "Culture";
}

function toNumber(value: string | number | null) {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function calculateQualityScore(row: AttractionRow, normalizedName: string) {
  const category = getCategory(row);
  const notes: string[] = [];

  let score = 0;

  score += toNumber(row.popularity_score);

  if (row.source === "manual_seed") {
    score += 5;
    notes.push("manual seed attraction");
  }

  if (row.wikidata_id) {
    score += 2;
    notes.push("has Wikidata ID");
  }

  if (row.website) {
    score += 1;
    notes.push("has website");
  }

  if (row.address) {
    score += 0.5;
    notes.push("has address");
  }

  if (row.opening_hours) {
    score += 0.5;
    notes.push("has opening hours");
  }

  if (row.secondary_categories && row.secondary_categories.length >= 2) {
    score += 0.5;
    notes.push("has multiple categories");
  }

  if (row.tags && row.tags.length >= 2) {
    score += 0.5;
    notes.push("has useful tags");
  }

  if (STRONG_CATEGORIES.has(category)) {
    score += 2;
    notes.push("strong tourism category");
  }

  if (category === "Food" || category === "Cafe") {
    score += 0.2;
    notes.push("food/cafe category capped later");
  }

  if (normalizedName.length < 4) {
    score -= 3;
    notes.push("name too short");
  }

  if (GENERIC_NAMES.has(normalizedName)) {
    score -= 3;
    notes.push("generic name");
  }

  if (!row.latitude || !row.longitude) {
    score -= 5;
    notes.push("missing coordinates");
  }

  return {
    score: Math.max(0, Math.min(10, Number(score.toFixed(2)))),
    notes,
  };
}

async function loadAttractions() {
  const result = await pool.query<AttractionRow>(`
    SELECT
      id,
      name,
      source,
      source_id,
      primary_category,
      category,
      secondary_categories,
      tags,
      wikidata_id,
      website,
      address,
      opening_hours,
      popularity_score,
      latitude,
      longitude
    FROM attractions
    ORDER BY id;
  `);

  return result.rows;
}

function cleanRows(rows: AttractionRow[]) {
  const cleaned: CleanedAttraction[] = rows.map((row) => {
    const normalizedName = normalizeName(row.name);
    const category = getCategory(row);
    const quality = calculateQualityScore(row, normalizedName);

    let isActive = quality.score >= 2.5;
    let isFeatured = false;
    const cleaningNotes = [...quality.notes];

    if (row.source === "manual_seed") {
      isActive = true;
      isFeatured = true;
      cleaningNotes.push("always kept because it is part of initial curated dataset");
    }

    if (GENERIC_NAMES.has(normalizedName) && row.source !== "manual_seed") {
      isActive = false;
      cleaningNotes.push("deactivated because name is too generic");
    }

    return {
      id: row.id,
      normalizedName,
      isActive,
      isFeatured,
      dataQualityScore: quality.score,
      cleaningNotes,
      category,
    };
  });

  // Deduplicate by normalized name.
  const byName = new Map<string, CleanedAttraction[]>();

  for (const item of cleaned) {
    if (!byName.has(item.normalizedName)) {
      byName.set(item.normalizedName, []);
    }

    byName.get(item.normalizedName)!.push(item);
  }

  for (const [, duplicates] of byName) {
    if (duplicates.length <= 1) continue;

    duplicates.sort((a, b) => {
      if (a.isFeatured !== b.isFeatured) return a.isFeatured ? -1 : 1;
      return b.dataQualityScore - a.dataQualityScore;
    });

    const keep = duplicates[0];

    for (const duplicate of duplicates.slice(1)) {
      if (duplicate.isFeatured) continue;

      duplicate.isActive = false;
      duplicate.cleaningNotes.push(`deactivated as duplicate of attraction id ${keep.id}`);
    }
  }

  // Category balancing, especially for Food and Cafe.
  const byCategory = new Map<string, CleanedAttraction[]>();

  for (const item of cleaned.filter((item) => item.isActive)) {
    if (!byCategory.has(item.category)) {
      byCategory.set(item.category, []);
    }

    byCategory.get(item.category)!.push(item);
  }

  for (const [category, items] of byCategory) {
    const limit = CATEGORY_LIMITS[category];

    if (!limit || items.length <= limit) continue;

    items.sort((a, b) => {
      if (a.isFeatured !== b.isFeatured) return a.isFeatured ? -1 : 1;
      return b.dataQualityScore - a.dataQualityScore;
    });

    const keepIds = new Set(items.slice(0, limit).map((item) => item.id));

    for (const item of items) {
      if (!keepIds.has(item.id) && !item.isFeatured) {
        item.isActive = false;
        item.cleaningNotes.push(`deactivated by category limit for ${category}`);
      }
    }
  }

  return cleaned;
}

async function saveCleanedRows(cleaned: CleanedAttraction[]) {
  for (const item of cleaned) {
    await pool.query(
      `
        UPDATE attractions
        SET
          normalized_name = $1,
          is_active = $2,
          is_featured = $3,
          data_quality_score = $4,
          cleaning_notes = $5,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $6;
      `,
      [
        item.normalizedName,
        item.isActive,
        item.isFeatured,
        item.dataQualityScore,
        item.cleaningNotes.join("; "),
        item.id,
      ]
    );
  }
}

function printSummary(cleaned: CleanedAttraction[]) {
  const active = cleaned.filter((item) => item.isActive);
  const inactive = cleaned.filter((item) => !item.isActive);

  console.log("\nCleaning summary:");
  console.table({
    total: cleaned.length,
    active: active.length,
    inactive: inactive.length,
  });

  const activeByCategory = active.reduce<Record<string, number>>((acc, item) => {
    acc[item.category] = (acc[item.category] || 0) + 1;
    return acc;
  }, {});

  const inactiveByCategory = inactive.reduce<Record<string, number>>((acc, item) => {
    acc[item.category] = (acc[item.category] || 0) + 1;
    return acc;
  }, {});

  console.log("\nActive attractions by category:");
  console.table(activeByCategory);

  console.log("\nInactive attractions by category:");
  console.table(inactiveByCategory);

  console.log("\nLowest quality active attractions:");
  console.table(
    active
      .sort((a, b) => a.dataQualityScore - b.dataQualityScore)
      .slice(0, 15)
      .map((item) => ({
        id: item.id,
        name: item.normalizedName,
        category: item.category,
        score: item.dataQualityScore,
        active: item.isActive,
      }))
  );
}

async function main() {
  console.log("Cleaning Sarajevo attractions...");

  const rows = await loadAttractions();
  const cleaned = cleanRows(rows);

  await saveCleanedRows(cleaned);
  printSummary(cleaned);

  console.log("\nAttraction cleaning completed.");
}

main()
  .catch((error) => {
    console.error("Cleaning failed:");
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });