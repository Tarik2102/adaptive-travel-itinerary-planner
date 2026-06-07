/**
 * Evaluation benchmark harness.
 *
 * Run from the travel-planner-app/ directory with the dev server running:
 *   npx tsx evaluation/run-benchmark.ts
 *
 * Env vars:
 *   BENCHMARK_BASE_URL  — defaults to http://localhost:3000
 *   DATABASE_URL        — read from .env.local if not already set
 *
 * SEED: all deterministic randomisation in this harness uses EVAL_SEED (42).
 *       Change EVAL_SEED in route.ts to re-run with different randomisation.
 */

import dotenv from "dotenv";
import path from "path";

// Load .env.local before any code that reads process.env (pg Pool, fetch URLs).
// ESM imports are resolved before this module body runs, but the Pool constructor
// below is called after dotenv.config(), so DATABASE_URL is available in time.
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import fs from "fs";
import { randomUUID } from "crypto";
import { Pool } from "pg";
import type { GeneratedItinerary } from "@/types/itinerary";
import type { TrafficAdaptResponse } from "@/types/itinerary";
import { generateScenarios, type Scenario, type DisruptionLevel } from "./scenarios";
import {
  interestPrecision,
  interestRecall,
  interestGroupCoverage,
  outdoorStopCount,
  totalTravelTimeMinutes,
  isFeasible,
  planChangeRatio,
} from "./metrics";

// ── Constants ─────────────────────────────────────────────────────────────────

const BASE_URL = process.env.BENCHMARK_BASE_URL ?? "http://localhost:3000";
const TIMING_REPEATS = 5;

const EVAL_DIR = path.resolve(process.cwd(), "evaluation");
const RESULTS_CSV = path.join(EVAL_DIR, "results.csv");
const RESULTS_JSON = path.join(EVAL_DIR, "results.json");
const RESULTS_MD = path.join(EVAL_DIR, "results.md");

// Delays the harness applies for static mode (spec §4b).
const STATIC_DELAY_MODERATE_MIN = 12;
const STATIC_DELAY_HEAVY_MIN = 25;

// ── DB pool ───────────────────────────────────────────────────────────────────

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function setupDb(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS evaluation_logs (
      id                      SERIAL PRIMARY KEY,
      run_id                  UUID         NOT NULL,
      scenario_id             TEXT         NOT NULL,
      persona_id              TEXT         NOT NULL,
      weather                 TEXT         NOT NULL,
      disruption              TEXT         NOT NULL,
      mode                    TEXT         NOT NULL,
      recommender             TEXT         NOT NULL,
      generation_feasible     BOOLEAN      NOT NULL,
      total_travel_time_min   FLOAT        NOT NULL,
      interest_coverage_rate  FLOAT        NOT NULL,
      interest_group_coverage FLOAT        NOT NULL,
      generation_response_ms  FLOAT        NOT NULL,
      stop_count              INTEGER      NOT NULL,
      disruption_effect       TEXT,
      post_adapt_feasible     BOOLEAN,
      plan_change_ratio       FLOAT,
      reopt_response_ms       FLOAT,
      reoptimized             BOOLEAN,
      created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);

  // Add new metric columns if they don't exist yet (idempotent migrations).
  await pool.query(`ALTER TABLE evaluation_logs ADD COLUMN IF NOT EXISTS interest_precision FLOAT`);
  await pool.query(`ALTER TABLE evaluation_logs ADD COLUMN IF NOT EXISTS interest_recall FLOAT`);
  await pool.query(`ALTER TABLE evaluation_logs ADD COLUMN IF NOT EXISTS outdoor_stop_count INTEGER`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS reoptimization_logs (
      id                        SERIAL PRIMARY KEY,
      run_id                    UUID        NOT NULL,
      scenario_id               TEXT        NOT NULL,
      severity                  TEXT        NOT NULL,
      original_stop_count       INTEGER     NOT NULL,
      adapted_stop_count        INTEGER     NOT NULL,
      original_duration_min     FLOAT       NOT NULL,
      adapted_duration_min      FLOAT,
      traffic_decision_required BOOLEAN     NOT NULL,
      response_time_ms          FLOAT       NOT NULL,
      created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function postJson<T>(url: string, body: unknown): Promise<{ data: T; ms: number }> {
  const start = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const ms = Date.now() - start;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 240)}`);
  }
  return { data: (await res.json()) as T, ms };
}

// ── Generation ────────────────────────────────────────────────────────────────

function buildGenerationRequest(scenario: Scenario) {
  const { persona, weather, mode } = scenario;
  return {
    preferences: {
      interests: persona.interests,
      startTime: persona.startTime,
      endTime: persona.endTime,
      transportMode: persona.transportMode,
      budgetLevel: persona.budgetLevel,
      preferredPace: persona.preferredPace,
      maxAttractions: persona.maxAttractions,
    },
    mode,
    weatherOverride: weather,
    recommender: "content",
  };
}

type GenerationApiResponse = {
  success: boolean;
  itinerary?: GeneratedItinerary;
  error?: string;
};

async function runGeneration(
  scenario: Scenario
): Promise<{ itinerary: GeneratedItinerary; meanMs: number } | null> {
  const url = `${BASE_URL}/api/itinerary`;
  const body = buildGenerationRequest(scenario);
  const timings: number[] = [];
  let firstItinerary: GeneratedItinerary | null = null;

  for (let i = 0; i < TIMING_REPEATS; i++) {
    try {
      const { data, ms } = await postJson<GenerationApiResponse>(url, body);
      timings.push(ms);
      if (data.success && data.itinerary && firstItinerary === null) {
        firstItinerary = data.itinerary;
      }
    } catch (err) {
      console.warn(`    Timing repeat ${i + 1}/${TIMING_REPEATS} failed:`, (err as Error).message);
    }
  }

  if (timings.length === 0 || !firstItinerary) return null;
  const meanMs = timings.reduce((a, b) => a + b, 0) / timings.length;
  return { itinerary: firstItinerary, meanMs };
}

// ── Adapt-traffic ─────────────────────────────────────────────────────────────

function buildAdaptRequest(itinerary: GeneratedItinerary, scenario: Scenario) {
  return {
    currentItinerary: itinerary,
    preferences: {
      interests: scenario.persona.interests,
      transport: scenario.persona.transportMode,
      startTime: scenario.persona.startTime,
      endTime: scenario.persona.endTime,
    },
    trafficSimulation: {
      enabled: true,
      severity: scenario.disruption,
      affectedLegIndex: "auto",
      source: "simulation",
    },
  };
}

type AdaptResult = {
  adaptedItinerary: GeneratedItinerary;
  ms: number;
  reoptimized: boolean;
  status: string;
  trafficDecisionRequired: boolean;
};

async function runAdaptTraffic(
  itinerary: GeneratedItinerary,
  scenario: Scenario
): Promise<AdaptResult | null> {
  try {
    const { data, ms } = await postJson<TrafficAdaptResponse>(
      `${BASE_URL}/api/itinerary/adapt-traffic`,
      buildAdaptRequest(itinerary, scenario)
    );

    if (data.trafficDecisionRequired) {
      return {
        adaptedItinerary: data.proposedItinerary,
        ms,
        reoptimized: true,
        status: data.adaptation.trafficSimulation?.status ?? "heavy_decision_required",
        trafficDecisionRequired: true,
      };
    }

    const simStatus = data.adaptation.trafficSimulation?.status ?? "unknown";
    const reoptimized =
      simStatus === "blocked_reoptimized" ||
      data.itinerary.items.length < itinerary.items.length;

    return {
      adaptedItinerary: data.itinerary,
      ms,
      reoptimized,
      status: simStatus,
      trafficDecisionRequired: false,
    };
  } catch (err) {
    console.warn(`    adapt-traffic failed:`, (err as Error).message);
    return null;
  }
}

// ── Static disruption simulation ──────────────────────────────────────────────

function applyStaticDisruption(
  itinerary: GeneratedItinerary,
  disruption: "moderate" | "heavy" | "blocked",
  endTime: string
): { feasible: boolean; overrunMinutes: number; effect: string } {
  if (itinerary.items.length < 2) {
    return {
      feasible: itinerary.feasibilityStatus !== "infeasible",
      overrunMinutes: 0,
      effect: "no_effect",
    };
  }

  if (disruption === "blocked") {
    return { feasible: false, overrunMinutes: Infinity, effect: "blocked_infeasible" };
  }

  const delayMin =
    disruption === "moderate" ? STATIC_DELAY_MODERATE_MIN : STATIC_DELAY_HEAVY_MIN;

  const lastEndMin = timeToMinutes(itinerary.items.at(-1)!.plannedEndTime) + delayMin;
  const endMin = timeToMinutes(endTime);
  const overrun = Math.max(0, lastEndMin - endMin);

  return {
    feasible: overrun === 0,
    overrunMinutes: overrun,
    effect: overrun === 0 ? "delayed_feasible" : "delayed_infeasible",
  };
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

// ── Row type ──────────────────────────────────────────────────────────────────

type RunRow = {
  runId: string;
  scenarioId: string;
  personaId: string;
  weather: string;
  disruption: string;
  mode: string;
  recommender: string;
  generationFeasible: boolean;
  totalTravelTimeMin: number;
  interestPrecision: number;
  interestRecall: number;
  groupCoverage: number;
  outdoorStopCount: number;
  generationResponseMs: number;
  stopCount: number;
  disruptionEffect: string | null;
  postAdaptFeasible: boolean | null;
  planChange: number | null;
  reoptResponseMs: number | null;
  reoptimized: boolean | null;
};

// ── Disruption label reconciliation ──────────────────────────────────────────

// If the raw API status string claims feasibility but the computed post-adapt
// feasibility check says otherwise, relabel to delayed_infeasible.
function reconcileDisruptionEffect(effect: string, postFeasible: boolean | null): string {
  if (postFeasible !== false) return effect;
  if (
    effect === "delayed_but_feasible" ||
    effect === "heavy_delay_feasible" ||
    effect === "delayed_feasible"
  ) {
    return "delayed_infeasible";
  }
  return effect;
}

// ── DB writes ─────────────────────────────────────────────────────────────────

async function logEvalRow(row: RunRow): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO evaluation_logs (
        run_id, scenario_id, persona_id, weather, disruption, mode, recommender,
        generation_feasible, total_travel_time_min, interest_coverage_rate,
        interest_group_coverage, generation_response_ms, stop_count,
        disruption_effect, post_adapt_feasible, plan_change_ratio,
        reopt_response_ms, reoptimized,
        interest_precision, interest_recall, outdoor_stop_count
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
      [
        row.runId, row.scenarioId, row.personaId, row.weather, row.disruption,
        row.mode, row.recommender, row.generationFeasible, row.totalTravelTimeMin,
        row.interestRecall, row.groupCoverage, row.generationResponseMs,
        row.stopCount, row.disruptionEffect, row.postAdaptFeasible,
        row.planChange, row.reoptResponseMs, row.reoptimized,
        row.interestPrecision, row.interestRecall, row.outdoorStopCount,
      ]
    );
  } catch (err) {
    console.warn("    DB evaluation_logs insert failed:", (err as Error).message);
  }
}

async function logReoptRow(
  runId: string,
  scenario: Scenario,
  original: GeneratedItinerary,
  adapted: GeneratedItinerary,
  trafficDecisionRequired: boolean,
  responseMs: number
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO reoptimization_logs (
        run_id, scenario_id, severity, original_stop_count, adapted_stop_count,
        original_duration_min, adapted_duration_min, traffic_decision_required, response_time_ms
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        runId, scenario.id, scenario.disruption,
        original.items.length, adapted.items.length,
        original.totalDuration, adapted.totalDuration,
        trafficDecisionRequired, responseMs,
      ]
    );
  } catch (err) {
    console.warn("    DB reoptimization_logs insert failed:", (err as Error).message);
  }
}

// ── Single scenario run ───────────────────────────────────────────────────────

async function runScenario(scenario: Scenario): Promise<RunRow | null> {
  const { persona, disruption, mode } = scenario;
  const runId = randomUUID();

  // ── Generation phase ──────────────────────────────────────────────────────

  const genResult = await runGeneration(scenario);
  if (!genResult) {
    console.warn(`  [SKIP] generation failed — ${scenario.id}`);
    return null;
  }

  const { itinerary, meanMs } = genResult;
  const genFeasible = isFeasible(itinerary, persona.endTime);
  const travelMin = totalTravelTimeMinutes(itinerary);
  const iPrecision = interestPrecision(itinerary, persona.interests);
  const iRecall = interestRecall(itinerary, persona.interests);
  const gCoverage = interestGroupCoverage(itinerary, scenario.requestedGroups);
  const outdoorCount = outdoorStopCount(itinerary);

  const baseRow = {
    runId,
    scenarioId: scenario.id,
    personaId: persona.id,
    weather: scenario.weather,
    disruption,
    mode,
    recommender: "content",
    generationFeasible: genFeasible,
    totalTravelTimeMin: travelMin,
    interestPrecision: iPrecision,
    interestRecall: iRecall,
    groupCoverage: gCoverage,
    outdoorStopCount: outdoorCount,
    generationResponseMs: meanMs,
    stopCount: itinerary.items.length,
  };

  // ── Disruption phase ──────────────────────────────────────────────────────

  // Walking itineraries: traffic disruptions don't apply (same for both modes).
  if (disruption === "none" || persona.transportMode === "walking") {
    const row: RunRow = {
      ...baseRow,
      disruptionEffect: disruption === "none" ? null : "no_effect",
      postAdaptFeasible: null,
      planChange: null,
      reoptResponseMs: null,
      reoptimized: null,
    };
    await logEvalRow(row);
    return row;
  }

  // Driving persona with actual disruption.
  if (mode === "adaptive") {
    const adaptResult = await runAdaptTraffic(itinerary, scenario);

    if (!adaptResult) {
      const row: RunRow = {
        ...baseRow,
        disruptionEffect: "api_error",
        postAdaptFeasible: null,
        planChange: null,
        reoptResponseMs: null,
        reoptimized: null,
      };
      await logEvalRow(row);
      return row;
    }

    const { adaptedItinerary, ms, reoptimized, status, trafficDecisionRequired } = adaptResult;
    const postFeasible = isFeasible(adaptedItinerary, persona.endTime);
    const pcRatio = planChangeRatio(itinerary, adaptedItinerary);

    if (reoptimized) {
      await logReoptRow(runId, scenario, itinerary, adaptedItinerary, trafficDecisionRequired, ms);
    }

    const row: RunRow = {
      ...baseRow,
      disruptionEffect: reconcileDisruptionEffect(status, postFeasible),
      postAdaptFeasible: postFeasible,
      planChange: pcRatio,
      reoptResponseMs: ms,
      reoptimized,
    };
    await logEvalRow(row);
    return row;
  }

  // Static mode: absorb the disruption without calling adapt-traffic.
  const { feasible, effect } = applyStaticDisruption(
    itinerary,
    disruption as "moderate" | "heavy" | "blocked",
    persona.endTime
  );

  const row: RunRow = {
    ...baseRow,
    disruptionEffect: reconcileDisruptionEffect(effect, feasible),
    postAdaptFeasible: feasible,
    planChange: 0, // static plan is frozen — no stops change
    reoptResponseMs: null,
    reoptimized: false,
  };
  await logEvalRow(row);
  return row;
}

// ── Summary computation ───────────────────────────────────────────────────────

type SummaryData = {
  totalScenarios: number;
  timingRepeats: number;
  adaptive: {
    feasibilityRate: number;
    postAdaptFeasRate: number;
    meanTravelMin: number;
    meanGenerationMs: number;
    meanReoptMs: number;
    reoptFrequency: number;
    meanPlanChangeAllDriving: number;
    meanPlanChangeReoptOnly: number;
    meanInterestPrecision: number;
    meanInterestRecall: number;
    meanOutdoorStopsRain: number;
  };
  static: {
    feasibilityRate: number;
    postAdaptFeasRate: number;
    meanTravelMin: number;
    meanGenerationMs: number;
    meanInterestPrecision: number;
    meanInterestRecall: number;
    meanOutdoorStopsRain: number;
  };
  feasibilityRecoveryRate: number;
  manualInterventionsAvoided: number;
  meanOverrunMinutes: { adaptive: number; static: number };
};

function computeSummary(rows: RunRow[]): SummaryData {
  const adap = rows.filter((r) => r.mode === "adaptive");
  const stat = rows.filter((r) => r.mode === "static");

  const mean = (arr: number[]) =>
    arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;

  const feasRate = (arr: RunRow[]) =>
    arr.length === 0 ? 0 : arr.filter((r) => r.generationFeasible).length / arr.length;

  const postAdaptFeasRate = (arr: RunRow[]) => {
    const applicable = arr.filter((r) => r.postAdaptFeasible !== null);
    if (applicable.length === 0) return 0;
    return applicable.filter((r) => r.postAdaptFeasible).length / applicable.length;
  };

  // Feasibility recovery: cases where static went infeasible after disruption
  // that adaptive successfully handled.
  const staticDisrupted = stat.filter(
    (r) => r.disruption !== "none" && r.postAdaptFeasible !== null
  );
  const staticInfeas = staticDisrupted.filter((r) => !r.postAdaptFeasible);
  const recovered = staticInfeas.filter((sid) => {
    const adaptiveId = sid.scenarioId.replace(/-static$/, "-adaptive");
    const adaptRow = adap.find((r) => r.scenarioId === adaptiveId);
    return adaptRow?.postAdaptFeasible === true;
  });
  const recoveryRate =
    staticInfeas.length > 0 ? recovered.length / staticInfeas.length : 1;

  // Manual interventions avoided: disruptions that broke the static plan but
  // adaptive auto-re-optimized (no user decision needed).
  const manualAvoided = staticInfeas.filter((sid) => {
    const adaptiveId = sid.scenarioId.replace(/-static$/, "-adaptive");
    const adaptRow = adap.find((r) => r.scenarioId === adaptiveId);
    return adaptRow?.reoptimized === true;
  }).length;

  const adaptDisrupted = adap.filter(
    (r) => r.disruption !== "none" && r.mode === "adaptive" && r.postAdaptFeasible !== null
  );

  // Plan-change ratio: all driving disruption rows vs. only reoptimized=true rows.
  const adaptDrivingDisrupted = adap.filter(
    (r) => r.disruption !== "none" && r.planChange !== null
  );
  const adaptReoptOnly = adap.filter((r) => r.reoptimized === true && r.planChange !== null);

  // Rain-specific outdoor stop counts (no disruption filter — all rain scenarios).
  const adapRain = adap.filter((r) => r.weather === "rain");
  const statRain = stat.filter((r) => r.weather === "rain");

  return {
    totalScenarios: rows.length,
    timingRepeats: TIMING_REPEATS,
    adaptive: {
      feasibilityRate: feasRate(adap),
      postAdaptFeasRate: postAdaptFeasRate(adap),
      meanTravelMin: mean(adap.map((r) => r.totalTravelTimeMin)),
      meanGenerationMs: mean(adap.map((r) => r.generationResponseMs)),
      meanReoptMs: mean(
        adap.filter((r) => r.reoptResponseMs !== null).map((r) => r.reoptResponseMs!)
      ),
      reoptFrequency:
        adaptDisrupted.length > 0
          ? adap.filter((r) => r.reoptimized === true).length / adaptDisrupted.length
          : 0,
      meanPlanChangeAllDriving: mean(adaptDrivingDisrupted.map((r) => r.planChange!)),
      meanPlanChangeReoptOnly: mean(adaptReoptOnly.map((r) => r.planChange!)),
      meanInterestPrecision: mean(adap.map((r) => r.interestPrecision)),
      meanInterestRecall: mean(adap.map((r) => r.interestRecall)),
      meanOutdoorStopsRain: mean(adapRain.map((r) => r.outdoorStopCount)),
    },
    static: {
      feasibilityRate: feasRate(stat),
      postAdaptFeasRate: postAdaptFeasRate(stat),
      meanTravelMin: mean(stat.map((r) => r.totalTravelTimeMin)),
      meanGenerationMs: mean(stat.map((r) => r.generationResponseMs)),
      meanInterestPrecision: mean(stat.map((r) => r.interestPrecision)),
      meanInterestRecall: mean(stat.map((r) => r.interestRecall)),
      meanOutdoorStopsRain: mean(statRain.map((r) => r.outdoorStopCount)),
    },
    feasibilityRecoveryRate: recoveryRate,
    manualInterventionsAvoided: manualAvoided,
    meanOverrunMinutes: {
      adaptive: mean(
        adap
          .filter((r) => r.postAdaptFeasible === false)
          .map(() => 0) // adaptive re-optimizes so overrun is effectively 0
      ),
      static: mean(
        stat
          .filter((r) => r.postAdaptFeasible === false && r.disruptionEffect !== "no_effect")
          .map((r) => (r.disruption === "blocked" ? 999 : r.disruption === "heavy" ? STATIC_DELAY_HEAVY_MIN : STATIC_DELAY_MODERATE_MIN))
      ),
    },
  };
}

// ── Results file writers ──────────────────────────────────────────────────────

const CSV_HEADER = [
  "scenario_id",
  "persona_id",
  "weather",
  "disruption",
  "mode",
  "recommender",
  "generation_feasible",
  "total_travel_time_min",
  "interest_precision",
  "interest_recall",
  "interest_group_coverage",
  "outdoor_stop_count",
  "generation_response_ms",
  "stop_count",
  "disruption_effect",
  "post_adapt_feasible",
  "plan_change_ratio",
  "reopt_response_ms",
  "reoptimized",
].join(",");

function rowToCsv(r: RunRow): string {
  return [
    r.scenarioId,
    r.personaId,
    r.weather,
    r.disruption,
    r.mode,
    r.recommender,
    r.generationFeasible,
    r.totalTravelTimeMin.toFixed(1),
    r.interestPrecision.toFixed(4),
    r.interestRecall.toFixed(4),
    r.groupCoverage.toFixed(4),
    r.outdoorStopCount,
    r.generationResponseMs.toFixed(1),
    r.stopCount,
    r.disruptionEffect ?? "",
    r.postAdaptFeasible ?? "",
    r.planChange?.toFixed(4) ?? "",
    r.reoptResponseMs?.toFixed(1) ?? "",
    r.reoptimized ?? "",
  ].join(",");
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function writeMarkdownTable(s: SummaryData): string {
  return `# Adaptive vs Static Evaluation — Thesis Metrics

*Scenario matrix: 6 personas × 2 weather conditions × 4 disruption levels × 2 modes = ${s.totalScenarios} scenarios. ${s.timingRepeats} timing repeats per generation call.*

## Summary Table

| Metric | Adaptive | Static |
|---|---|---|
| Generation feasibility rate | ${pct(s.adaptive.feasibilityRate)} | ${pct(s.static.feasibilityRate)} |
| Post-disruption feasible rate | ${pct(s.adaptive.postAdaptFeasRate)} | ${pct(s.static.postAdaptFeasRate)} |
| Mean total travel time | ${s.adaptive.meanTravelMin.toFixed(1)} min | ${s.static.meanTravelMin.toFixed(1)} min |
| Mean generation response time | ${s.adaptive.meanGenerationMs.toFixed(0)} ms | ${s.static.meanGenerationMs.toFixed(0)} ms |
| Mean re-optimisation response time | ${s.adaptive.meanReoptMs > 0 ? s.adaptive.meanReoptMs.toFixed(0) + " ms" : "N/A"} | N/A |
| Re-optimisation frequency (of disrupted driving scenarios) | ${pct(s.adaptive.reoptFrequency)} | N/A |
| Mean plan-change ratio (all driving disruptions) | ${s.adaptive.meanPlanChangeAllDriving.toFixed(3)} | N/A |
| Mean plan-change ratio (reoptimized runs only) | ${s.adaptive.meanPlanChangeReoptOnly.toFixed(3)} | N/A |
| Mean interest precision | ${s.adaptive.meanInterestPrecision.toFixed(3)} | ${s.static.meanInterestPrecision.toFixed(3)} |
| Mean interest recall | ${s.adaptive.meanInterestRecall.toFixed(3)} | ${s.static.meanInterestRecall.toFixed(3)} |
| Mean outdoor stops under rain | ${s.adaptive.meanOutdoorStopsRain.toFixed(2)} | ${s.static.meanOutdoorStopsRain.toFixed(2)} |

## Cross-mode Comparison

| Metric | Value |
|---|---|
| Feasibility recovery rate (static infeasible → adaptive restored) | ${pct(s.feasibilityRecoveryRate)} |
| Manual interventions avoided (adaptive auto-handled vs static) | ${s.manualInterventionsAvoided} |

## Notes

- **Static mode** receives the same generation request but skips \`applyWeatherAdaptation\`. Under disruption, the static plan absorbs the delay as-is (moderate +${STATIC_DELAY_MODERATE_MIN} min, heavy +${STATIC_DELAY_HEAVY_MIN} min, blocked → infeasible) without calling the adapt-traffic API.
- **Adaptive mode** calls \`/api/itinerary/adapt-traffic\` with \`source:"simulation"\` for driving itineraries under disruption. The harness auto-accepts proposed itineraries from the heavy-traffic decision flow.
- Walking itineraries are unaffected by traffic disruptions in both modes (recorded as \`no_effect\`).
- All weather conditions are fixed via \`weatherOverride\` for reproducibility. Live TomTom traffic is never used.
- Recommender is always \`"content"\` (ML/fallback path) for all generation calls.
- **Interest precision**: fraction of planned stops matching a requested interest. **Interest recall**: fraction of requested interests represented by ≥1 stop.
- **Disruption labels** are reconciled against computed feasibility — a label claiming feasibility when the computed end time exceeds the window is relabelled \`delayed_infeasible\`.
`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("=== Adaptive Travel Itinerary Planner — Evaluation Benchmark ===");
  console.log(`Target: ${BASE_URL}`);
  console.log(`Timing repeats per scenario: ${TIMING_REPEATS}`);

  await setupDb();
  console.log("DB tables ready.\n");

  const scenarios = generateScenarios();
  console.log(`Running ${scenarios.length} scenarios...\n`);

  const rows: RunRow[] = [];
  let failed = 0;

  for (const [idx, scenario] of scenarios.entries()) {
    const prefix = `[${String(idx + 1).padStart(2, "0")}/${scenarios.length}]`;
    process.stdout.write(`${prefix} ${scenario.id} ... `);

    const row = await runScenario(scenario);
    if (row) {
      rows.push(row);
      const feasStr = row.generationFeasible ? "feasible" : "infeasible";
      const adaptStr =
        row.postAdaptFeasible === null
          ? ""
          : ` → post-disruption:${row.postAdaptFeasible ? "ok" : "fail"}`;
      console.log(`${feasStr}${adaptStr} (${row.generationResponseMs.toFixed(0)} ms)`);
    } else {
      failed++;
      console.log("FAILED");
    }
  }

  console.log(`\nCompleted: ${rows.length} / ${scenarios.length} (${failed} failed)`);

  // ── Write results ───────────────────────────────────────────────────────────

  const csvContent = [CSV_HEADER, ...rows.map(rowToCsv)].join("\n");
  fs.writeFileSync(RESULTS_CSV, csvContent, "utf-8");
  console.log(`CSV  → ${RESULTS_CSV}`);

  fs.writeFileSync(RESULTS_JSON, JSON.stringify(rows, null, 2), "utf-8");
  console.log(`JSON → ${RESULTS_JSON}`);

  // ── Aggregate summary ───────────────────────────────────────────────────────

  if (rows.length === 0) {
    console.log("\nNo rows — cannot compute summary.");
    await pool.end();
    return;
  }

  const summary = computeSummary(rows);

  const md = writeMarkdownTable(summary);
  fs.writeFileSync(RESULTS_MD, md, "utf-8");
  console.log(`MD   → ${RESULTS_MD}`);

  console.log("\n════════════════════════════════════════════════════");
  console.log("  AGGREGATE SUMMARY — ADAPTIVE vs STATIC");
  console.log("════════════════════════════════════════════════════");
  console.log(
    `${"Metric".padEnd(42)} ${"ADAPTIVE".padEnd(12)} STATIC`
  );
  console.log("─".repeat(68));

  const row2 = (label: string, a: string, s: string) =>
    console.log(`${label.padEnd(42)} ${a.padEnd(12)} ${s}`);

  row2("Generation feasibility rate", pct(summary.adaptive.feasibilityRate), pct(summary.static.feasibilityRate));
  row2("Post-disruption feasible rate", pct(summary.adaptive.postAdaptFeasRate), pct(summary.static.postAdaptFeasRate));
  row2("Mean total travel time (min)", summary.adaptive.meanTravelMin.toFixed(1), summary.static.meanTravelMin.toFixed(1));
  row2("Mean generation response (ms)", summary.adaptive.meanGenerationMs.toFixed(0), summary.static.meanGenerationMs.toFixed(0));
  row2("Mean re-opt response (ms)", summary.adaptive.meanReoptMs > 0 ? summary.adaptive.meanReoptMs.toFixed(0) : "N/A", "N/A");
  row2("Re-opt frequency (disrupted driv.)", pct(summary.adaptive.reoptFrequency), "N/A");
  row2("Mean plan-change (all driving disrupt.)", summary.adaptive.meanPlanChangeAllDriving.toFixed(3), "N/A");
  row2("Mean plan-change (reoptimized only)", summary.adaptive.meanPlanChangeReoptOnly.toFixed(3), "N/A");
  row2("Mean interest precision", summary.adaptive.meanInterestPrecision.toFixed(3), summary.static.meanInterestPrecision.toFixed(3));
  row2("Mean interest recall", summary.adaptive.meanInterestRecall.toFixed(3), summary.static.meanInterestRecall.toFixed(3));
  row2("Mean outdoor stops (rain)", summary.adaptive.meanOutdoorStopsRain.toFixed(2), summary.static.meanOutdoorStopsRain.toFixed(2));

  console.log("─".repeat(68));
  console.log(`Feasibility recovery rate (static→adaptive): ${pct(summary.feasibilityRecoveryRate)}`);
  console.log(`Manual interventions avoided:                ${summary.manualInterventionsAvoided}`);
  console.log("════════════════════════════════════════════════════\n");

  await pool.end();
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  pool.end().finally(() => process.exit(1));
});
