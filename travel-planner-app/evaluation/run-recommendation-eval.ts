/**
 * Recommendation-relevance evaluation (RP#2).
 *
 * Compares content / popularity / random recommenders under cold-start:
 * personas have stated preferences but NO interaction history.
 *
 * Run from travel-planner-app/ with dev server + ML service + DB running:
 *   npx tsx evaluation/run-recommendation-eval.ts
 *
 * Env vars:
 *   BENCHMARK_BASE_URL — defaults to http://localhost:3000
 *   DATABASE_URL       — read from .env.local if not already set
 *
 * Outputs:
 *   evaluation/recommendation-results.csv
 *   evaluation/recommendation-results.json
 *   evaluation/recommendation-results.md
 */

import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import fs from "fs";
import { Pool } from "pg";
import type { Attraction } from "@/types/attraction";
import { PERSONAS } from "./scenarios";
import { buildGroundTruth, RELEVANCE_MIN_RATING } from "./ground-truth";
import { precisionAtK, recallAtK, ndcgAtK, K_VALUES } from "./ir-metrics";

// ── Constants ─────────────────────────────────────────────────────────────────

const BASE_URL = process.env.BENCHMARK_BASE_URL ?? "http://localhost:3000";
const RECOMMENDERS = ["content", "popularity", "random"] as const;
type Recommender = (typeof RECOMMENDERS)[number];

const EVAL_DIR = path.resolve(process.cwd(), "evaluation");
const RESULTS_CSV = path.join(EVAL_DIR, "recommendation-results.csv");
const RESULTS_JSON = path.join(EVAL_DIR, "recommendation-results.json");
const RESULTS_MD = path.join(EVAL_DIR, "recommendation-results.md");

// Number of candidates the endpoint returns; must be >= max(K_VALUES).
const TOP_N = 50;

// ── DB: load all active attractions for ground-truth computation ───────────────

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

type AttractionRow = {
  id: number;
  name: string;
  category: string;
  primary_category: string | null;
  secondary_categories: string[] | string | null;
  tags: string[] | string | null;
  rating: string | number | null;
  data_quality_score: string | number | null;
  popularity_score: string | number | null;
};

function normalizeTextArray(value: string[] | string | null): string[] {
  if (Array.isArray(value)) return value.map((s) => s.trim()).filter(Boolean);
  if (typeof value !== "string" || !value.trim()) return [];
  return value
    .replace(/^{|}$/g, "")
    .split(",")
    .map((s) => s.replace(/^"|"$/g, "").trim())
    .filter(Boolean);
}

async function loadAttractions(): Promise<Attraction[]> {
  const rows = await pool.query<AttractionRow>(
    `SELECT id, name, category, primary_category, secondary_categories, tags,
            rating, data_quality_score, popularity_score
     FROM attractions
     WHERE COALESCE(is_active, true) = true
     ORDER BY id ASC`
  );
  return rows.rows.map(
    (r): Attraction => ({
      id: r.id,
      name: r.name,
      description: null,
      category: r.category,
      primary_category: r.primary_category,
      secondary_categories: normalizeTextArray(r.secondary_categories),
      tags: normalizeTextArray(r.tags),
      latitude: 0,
      longitude: 0,
      estimated_visit_duration: 60,
      rating: r.rating === null ? null : Number(r.rating),
      price_level: null,
      indoor_outdoor: null,
      opening_time: null,
      closing_time: null,
      data_quality_score:
        r.data_quality_score === null ? undefined : Number(r.data_quality_score),
      popularity_score:
        r.popularity_score === null ? undefined : Number(r.popularity_score),
    })
  );
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

type EvalRecommendResponse = {
  success: boolean;
  recommender: string;
  rankedCandidates: Array<{ id: number; [key: string]: unknown }>;
  error?: string;
};

async function fetchRankedCandidates(
  personaId: string,
  interests: string[],
  budgetLevel: string,
  transportMode: string,
  preferredPace: string,
  startTime: string,
  endTime: string,
  maxAttractions: number,
  recommender: Recommender
): Promise<number[]> {
  const res = await fetch(`${BASE_URL}/api/eval/recommend`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      preferences: {
        interests,
        budgetLevel,
        transportMode,
        preferredPace,
        startTime,
        endTime,
        maxAttractions,
      },
      recommender,
      topN: TOP_N,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} for ${personaId}/${recommender}: ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as EvalRecommendResponse;
  if (!data.success) {
    throw new Error(`API error for ${personaId}/${recommender}: ${data.error ?? "unknown"}`);
  }

  return data.rankedCandidates.map((c) => c.id);
}

// ── Row type ──────────────────────────────────────────────────────────────────

type EvalRow = {
  personaId: string;
  personaName: string;
  recommender: Recommender;
  relevantCount: number;
  p5: number;
  p10: number;
  r5: number | null; // null when relevantSet is empty (excluded from recall mean)
  r10: number | null;
  ndcg5: number;
  ndcg10: number;
};

// ── Aggregation ────────────────────────────────────────────────────────────────

type AggRow = {
  recommender: Recommender;
  meanP5: number;
  meanP10: number;
  meanR5: number;
  meanR10: number;
  meanNdcg5: number;
  meanNdcg10: number;
  recallExcluded: number;
};

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function aggregate(rows: EvalRow[], recommender: Recommender): AggRow {
  const subset = rows.filter((r) => r.recommender === recommender);
  const recallRows = subset.filter((r) => r.r5 !== null);
  const excluded = subset.length - recallRows.length;

  return {
    recommender,
    meanP5: mean(subset.map((r) => r.p5)),
    meanP10: mean(subset.map((r) => r.p10)),
    meanR5: mean(recallRows.map((r) => r.r5 as number)),
    meanR10: mean(recallRows.map((r) => r.r10 as number)),
    meanNdcg5: mean(subset.map((r) => r.ndcg5)),
    meanNdcg10: mean(subset.map((r) => r.ndcg10)),
    recallExcluded: excluded,
  };
}

// ── File writers ───────────────────────────────────────────────────────────────

const CSV_HEADER = [
  "persona_id",
  "persona_name",
  "recommender",
  "relevant_count",
  "p_at_5",
  "p_at_10",
  "r_at_5",
  "r_at_10",
  "ndcg_at_5",
  "ndcg_at_10",
].join(",");

function rowToCsv(r: EvalRow): string {
  return [
    r.personaId,
    `"${r.personaName}"`,
    r.recommender,
    r.relevantCount,
    r.p5.toFixed(4),
    r.p10.toFixed(4),
    r.r5 !== null ? r.r5.toFixed(4) : "N/A",
    r.r10 !== null ? r.r10.toFixed(4) : "N/A",
    r.ndcg5.toFixed(4),
    r.ndcg10.toFixed(4),
  ].join(",");
}

function fmt(v: number): string {
  return v.toFixed(3);
}

function writeMarkdown(aggRows: AggRow[], totalAttractions: number, emptyPersonas: string[]): string {
  const recallNote =
    emptyPersonas.length > 0
      ? `Recall means exclude ${emptyPersonas.length} persona(s) with empty relevant sets (${emptyPersonas.join(", ")}).`
      : "No personas had an empty relevant set.";

  const tableRows = aggRows
    .map(
      (a) =>
        `| ${a.recommender.padEnd(10)} | ${fmt(a.meanP5)} | ${fmt(a.meanP10)} | ${fmt(a.meanR5)} | ${fmt(a.meanR10)} | ${fmt(a.meanNdcg5)} | ${fmt(a.meanNdcg10)} |`
    )
    .join("\n");

  return `# Recommendation-Relevance Evaluation (RP#2) — Cold-Start

*Framing: 6 personas × 3 recommenders (content / popularity / random). Cold-start: personas have stated preferences but NO interaction history. Candidate pool: all active attractions in DB (${totalAttractions} total). Metric values are means across ${PERSONAS.length} personas.*

## Results

| Recommender | P@5   | P@10  | R@5   | R@10  | nDCG@5 | nDCG@10 |
|-------------|-------|-------|-------|-------|--------|---------|
${tableRows}

## Notes

- **Relevance threshold**: \`RELEVANCE_MIN_RATING = ${RELEVANCE_MIN_RATING}\`. An attraction is relevant for a persona when its \`primary_category\` / \`category\` / \`secondary_categories\` / \`tags\` match ≥1 requested interest AND (\`rating ≥ ${RELEVANCE_MIN_RATING}\`) OR (rating absent/zero → \`data_quality_score ≥ median\`).
- **K values**: ${K_VALUES.join(", ")}.
- **Random recommender** uses \`EVAL_SEED = 42\` (mulberry32 PRNG) for full reproducibility.
- ${recallNote}
`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("=== Recommendation-Relevance Evaluation (RP#2) ===");
  console.log(`Target: ${BASE_URL}`);
  console.log(`Personas: ${PERSONAS.length}  |  Recommenders: ${RECOMMENDERS.join(", ")}  |  K = ${K_VALUES.join(", ")}\n`);

  // 1. Load attractions from DB for ground-truth.
  console.log("Loading attractions from DB...");
  const allAttractions = await loadAttractions();
  console.log(`  Loaded ${allAttractions.length} active attractions.\n`);

  // 2. Build ground truth for all 6 personas.
  const { groundTruth, relevantCounts, emptyPersonas } = buildGroundTruth(PERSONAS, allAttractions);

  console.log("Ground-truth relevant counts per persona:");
  for (const persona of PERSONAS) {
    const count = relevantCounts.get(persona.id) ?? 0;
    console.log(`  ${persona.id} (${persona.name}): ${count} relevant attractions`);
  }
  if (emptyPersonas.length > 0) {
    console.log(`\n  WARNING: Personas with empty relevant sets (excluded from recall means): ${emptyPersonas.join(", ")}`);
  }
  console.log();

  // 3. For each persona × recommender, call the eval endpoint and compute metrics.
  const rows: EvalRow[] = [];
  let failed = 0;

  const total = PERSONAS.length * RECOMMENDERS.length;
  let done = 0;

  for (const persona of PERSONAS) {
    const relevantSet = groundTruth.get(persona.id) ?? new Set<number>();

    for (const recommender of RECOMMENDERS) {
      done++;
      const prefix = `[${String(done).padStart(2, "0")}/${total}]`;
      process.stdout.write(`${prefix} ${persona.id} / ${recommender} ... `);

      try {
        const rankedIds = await fetchRankedCandidates(
          persona.id,
          persona.interests,
          persona.budgetLevel,
          persona.transportMode,
          persona.preferredPace,
          persona.startTime,
          persona.endTime,
          persona.maxAttractions,
          recommender
        );

        const p5 = precisionAtK(rankedIds, relevantSet, 5);
        const p10 = precisionAtK(rankedIds, relevantSet, 10);
        const r5 = relevantSet.size === 0 ? null : recallAtK(rankedIds, relevantSet, 5);
        const r10 = relevantSet.size === 0 ? null : recallAtK(rankedIds, relevantSet, 10);
        const ndcg5 = ndcgAtK(rankedIds, relevantSet, 5);
        const ndcg10 = ndcgAtK(rankedIds, relevantSet, 10);

        rows.push({
          personaId: persona.id,
          personaName: persona.name,
          recommender,
          relevantCount: relevantSet.size,
          p5,
          p10,
          r5,
          r10,
          ndcg5,
          ndcg10,
        });

        console.log(
          `P@5=${p5.toFixed(2)} P@10=${p10.toFixed(2)} nDCG@5=${ndcg5.toFixed(2)} nDCG@10=${ndcg10.toFixed(2)}`
        );
      } catch (err) {
        failed++;
        console.log(`FAILED — ${(err as Error).message}`);
      }
    }
  }

  console.log(`\nCompleted: ${rows.length} / ${total} (${failed} failed)\n`);

  if (rows.length === 0) {
    console.log("No rows — cannot write results.");
    await pool.end();
    return;
  }

  // 4. Write per-(persona,recommender) results.
  const csvContent = [CSV_HEADER, ...rows.map(rowToCsv)].join("\n");
  fs.writeFileSync(RESULTS_CSV, csvContent, "utf-8");
  console.log(`CSV  → ${RESULTS_CSV}`);

  fs.writeFileSync(RESULTS_JSON, JSON.stringify(rows, null, 2), "utf-8");
  console.log(`JSON → ${RESULTS_JSON}`);

  // 5. Aggregate and write markdown.
  const aggRows = RECOMMENDERS.map((r) => aggregate(rows, r));
  const md = writeMarkdown(aggRows, allAttractions.length, emptyPersonas);
  fs.writeFileSync(RESULTS_MD, md, "utf-8");
  console.log(`MD   → ${RESULTS_MD}\n`);

  // 6. Print summary table to stdout.
  console.log("════════════════════════════════════════════════════════════");
  console.log("  AGGREGATE SUMMARY — RECOMMENDATION RELEVANCE (RP#2)");
  console.log("════════════════════════════════════════════════════════════");
  console.log(
    `${"Recommender".padEnd(12)} ${"P@5".padStart(6)} ${"P@10".padStart(6)} ${"R@5".padStart(6)} ${"R@10".padStart(6)} ${"nDCG@5".padStart(8)} ${"nDCG@10".padStart(8)}`
  );
  console.log("─".repeat(64));
  for (const a of aggRows) {
    const excl = a.recallExcluded > 0 ? ` (recall excl. ${a.recallExcluded})` : "";
    console.log(
      `${a.recommender.padEnd(12)} ${fmt(a.meanP5).padStart(6)} ${fmt(a.meanP10).padStart(6)} ${fmt(a.meanR5).padStart(6)} ${fmt(a.meanR10).padStart(6)} ${fmt(a.meanNdcg5).padStart(8)} ${fmt(a.meanNdcg10).padStart(8)}${excl}`
    );
  }
  console.log("─".repeat(64));
  console.log(`RELEVANCE_MIN_RATING = ${RELEVANCE_MIN_RATING}  |  K = ${K_VALUES.join(", ")}  |  cold-start (no interaction history)`);
  console.log("════════════════════════════════════════════════════════════\n");

  await pool.end();
}

main().catch((err) => {
  console.error("Evaluation failed:", err);
  pool.end().finally(() => process.exit(1));
});
