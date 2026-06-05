import "dotenv/config";
import dotenv from "dotenv";
import path from "path";
import { Pool } from "pg";

dotenv.config({
  path: path.resolve(process.cwd(), ".env.local"),
});

type MatchSource = "local_database" | "live_osm_lookup";

type ManualAttractionRow = {
  id: number;
  name: string;
  latitude: string | number | null;
  longitude: string | number | null;
  source: string | null;
};

type LocalOsmRow = ManualAttractionRow & {
  source_id: string | null;
  category: string | null;
  primary_category: string | null;
  secondary_categories: string[] | string | null;
  tags: string[] | string | null;
  wikidata_id: string | null;
  popularity_score: string | number | null;
};

type CoordinateCandidate = {
  localId?: number;
  name: string;
  latitude: number;
  longitude: number;
  matchSource: MatchSource;
  sourceId?: string | null;
  osmType?: string | null;
  osmId?: string | number | null;
  category?: string | null;
  primaryCategory?: string | null;
  secondaryCategories?: string[];
  tags?: string[];
  wikidataId?: string | null;
  popularityScore?: number | null;
  importance?: number | null;
  displayName?: string | null;
};

type AttractionKind = "area" | "large_site" | "small_landmark";

type ManualAttractionConfig = {
  label: string;
  aliases: string[];
  expectedCategories: string[];
  kind: AttractionKind;
  maxMoveMeters: number;
  osmClassTypeTerms: string[];
  requiredNameTerms: string[];
};

type CandidateScore = {
  candidate: CoordinateCandidate;
  distanceMeters: number;
  hasExactAliasMatch: boolean;
  hasStrongNameMatch: boolean;
  isInsideSarajevo: boolean;
  score: number;
  signals: string[];
};

type SyncResult = {
  bestMatch: CandidateScore | null;
  config: ManualAttractionConfig | null;
  manual: ManualAttractionRow;
  reason: string;
  status: "needs_review" | "will_update";
};

type NominatimResult = {
  class?: string;
  display_name?: string;
  extratags?: Record<string, string>;
  importance?: number;
  lat: string;
  lon: string;
  name?: string;
  namedetails?: Record<string, string>;
  osm_id?: number;
  osm_type?: string;
  place_id: number;
  type?: string;
};

const DATABASE_URL = process.env.DATABASE_URL;
const APPLY_CHANGES = process.argv.includes("--apply");
const MIN_CONFIDENCE_SCORE = 5;
const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search";
const NOMINATIM_DELAY_MS = 1100;
const USER_AGENT =
  "adaptive-travel-itinerary-planner-coordinate-sync/1.0";

const SARAJEVO_BOUNDS = {
  east: 18.53,
  north: 43.93,
  south: 43.79,
  west: 18.25,
};

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is missing. Check travel-planner-app/.env.local");
}

const pool = new Pool({
  connectionString: DATABASE_URL,
});

const MANUAL_ATTRACTIONS: ManualAttractionConfig[] = [
  {
    label: "Baščaršija",
    aliases: ["bascarsija", "baščaršija", "old bazaar"],
    expectedCategories: ["Culture", "History", "Shopping", "Local Experience"],
    kind: "area",
    maxMoveMeters: 1500,
    osmClassTypeTerms: ["attraction", "historic", "marketplace", "tourism"],
    requiredNameTerms: ["bascarsija", "bazaar"],
  },
  {
    label: "Latin Bridge",
    aliases: ["latin bridge", "latinska cuprija", "latinska ćuprija"],
    expectedCategories: ["History", "Architecture", "Culture"],
    kind: "small_landmark",
    maxMoveMeters: 500,
    osmClassTypeTerms: ["attraction", "bridge", "historic", "tourism"],
    requiredNameTerms: ["latin", "latinska"],
  },
  {
    label: "Gazi Husrev-beg Mosque",
    aliases: [
      "gazi husrev",
      "gazi husrev beg mosque",
      "begova dzamija",
      "begova džamija",
    ],
    expectedCategories: ["Religion", "Architecture", "Culture"],
    kind: "small_landmark",
    maxMoveMeters: 500,
    osmClassTypeTerms: ["mosque", "place of worship", "tourism"],
    requiredNameTerms: ["mosque", "dzamija"],
  },
  {
    label: "Sarajevo City Hall / Vijećnica",
    aliases: ["vijecnica", "vijećnica", "city hall", "sarajevo city hall"],
    expectedCategories: ["Architecture", "Culture", "History"],
    kind: "small_landmark",
    maxMoveMeters: 500,
    osmClassTypeTerms: ["attraction", "historic", "tourism"],
    requiredNameTerms: ["vijecnica", "city hall"],
  },
  {
    label: "Yellow Fortress / Žuta Tabija",
    aliases: ["yellow fortress", "yellow bastion", "zuta tabija", "žuta tabija"],
    expectedCategories: ["History", "Viewpoint", "Architecture"],
    kind: "small_landmark",
    maxMoveMeters: 500,
    osmClassTypeTerms: ["attraction", "castle", "fort", "historic", "viewpoint"],
    requiredNameTerms: ["yellow", "zuta", "tabija"],
  },
  {
    label: "National Museum of Bosnia and Herzegovina",
    aliases: [
      "national museum",
      "national museum of bosnia and herzegovina",
      "zemaljski muzej",
    ],
    expectedCategories: ["Museum", "Culture", "History"],
    kind: "small_landmark",
    maxMoveMeters: 500,
    osmClassTypeTerms: ["museum", "tourism"],
    requiredNameTerms: ["museum", "muzej"],
  },
  {
    label: "Tunnel of Hope / Sarajevo War Tunnel",
    aliases: [
      "tunnel of hope",
      "sarajevo tunnel",
      "sarajevo war tunnel",
      "war tunnel",
      "tunel spasa",
    ],
    expectedCategories: ["War History", "Museum", "History"],
    kind: "large_site",
    maxMoveMeters: 500,
    osmClassTypeTerms: ["attraction", "museum", "tourism"],
    requiredNameTerms: ["tunnel", "tunel"],
  },
  {
    label: "Sebilj Fountain",
    aliases: ["sebilj", "sebilj fountain"],
    expectedCategories: ["Architecture", "Culture", "History"],
    kind: "small_landmark",
    maxMoveMeters: 500,
    osmClassTypeTerms: ["attraction", "fountain", "tourism"],
    requiredNameTerms: ["sebilj"],
  },
  {
    label: "Vrelo Bosne",
    aliases: ["vrelo bosne"],
    expectedCategories: ["Nature", "Park", "Family"],
    kind: "area",
    maxMoveMeters: 2000,
    osmClassTypeTerms: ["attraction", "park", "spring", "tourism"],
    requiredNameTerms: ["vrelo"],
  },
  {
    label: "Avaz Twist Tower",
    aliases: ["avaz", "twist tower", "avaz twist tower"],
    expectedCategories: ["Architecture", "Viewpoint", "Modern Sarajevo"],
    kind: "small_landmark",
    maxMoveMeters: 500,
    osmClassTypeTerms: ["attraction", "building", "tower", "viewpoint"],
    requiredNameTerms: ["avaz", "twist"],
  },
];

async function main() {
  const manualAttractions = await loadManualAttractions();
  const localOsmCandidates = (await loadOpenStreetMapAttractions()).map(
    toLocalCoordinateCandidate
  );
  const results: SyncResult[] = [];
  let liveLookupCount = 0;

  console.log(
    APPLY_CHANGES
      ? "Applying manual attraction coordinate sync."
      : "Dry run: previewing manual attraction coordinate sync."
  );
  console.log(
    `Loaded ${manualAttractions.length} manual rows and ${localOsmCandidates.length} local OSM rows.`
  );

  for (const manual of manualAttractions) {
    const config = findManualAttractionConfig(manual);

    if (!config) {
      results.push({
        bestMatch: null,
        config,
        manual,
        reason: "manual attraction is not in the supported sync list",
        status: "needs_review",
      });
      continue;
    }

    const localBestMatch = findBestScoredCandidate(
      manual,
      localOsmCandidates,
      config
    );
    let bestMatch = localBestMatch;

    if (!isUpdateableMatch(localBestMatch, config)) {
      liveLookupCount += 1;
      const liveCandidates = await lookupLiveOsmCandidates(config);
      const liveBestMatch = findBestScoredCandidate(
        manual,
        liveCandidates,
        config
      );

      bestMatch = chooseBestMatch(localBestMatch, liveBestMatch, config);
    }

    const reviewReason = getReviewReason(bestMatch, config);

    results.push({
      bestMatch,
      config,
      manual,
      reason: reviewReason ?? "high-confidence match",
      status: reviewReason ? "needs_review" : "will_update",
    });
  }

  printSyncResults(results);
  console.log(`\nLive OSM lookup used for ${liveLookupCount} manual rows.`);

  if (APPLY_CHANGES) {
    await applyCoordinateUpdates(results);
  } else {
    console.log("\nDry run only. Re-run with --apply to update coordinates.");
  }
}

async function loadManualAttractions(): Promise<ManualAttractionRow[]> {
  const result = await pool.query<ManualAttractionRow>(`
    SELECT id, name, latitude, longitude, source
    FROM attractions
    WHERE source = 'manual_seed'
    ORDER BY name;
  `);

  return result.rows;
}

async function loadOpenStreetMapAttractions(): Promise<LocalOsmRow[]> {
  const result = await pool.query<LocalOsmRow>(`
    SELECT
      id,
      name,
      latitude,
      longitude,
      source,
      source_id,
      category,
      primary_category,
      secondary_categories,
      tags,
      wikidata_id,
      popularity_score
    FROM attractions
    WHERE source = 'openstreetmap'
      AND latitude IS NOT NULL
      AND longitude IS NOT NULL
    ORDER BY name;
  `);

  return result.rows;
}

function findManualAttractionConfig(
  manual: ManualAttractionRow
): ManualAttractionConfig | null {
  const normalizedName = normalizeSearchText(manual.name);

  return (
    MANUAL_ATTRACTIONS.find((config) =>
      config.aliases.some((alias) =>
        namesMatch(normalizedName, normalizeSearchText(alias))
      )
    ) ?? null
  );
}

function toLocalCoordinateCandidate(row: LocalOsmRow): CoordinateCandidate {
  return {
    localId: row.id,
    name: row.name,
    latitude: toNumber(row.latitude),
    longitude: toNumber(row.longitude),
    matchSource: "local_database",
    sourceId: row.source_id,
    category: row.category,
    primaryCategory: row.primary_category,
    secondaryCategories: normalizeTextArray(row.secondary_categories),
    tags: normalizeTextArray(row.tags),
    wikidataId: row.wikidata_id,
    popularityScore: toNumber(row.popularity_score),
  };
}

async function lookupLiveOsmCandidates(
  config: ManualAttractionConfig
): Promise<CoordinateCandidate[]> {
  const candidates: CoordinateCandidate[] = [];
  const seenCandidateKeys = new Set<string>();

  for (const query of buildLiveOsmQueries(config)) {
    try {
      const results = await fetchNominatimResults(query);

      for (const result of results) {
        const candidate = toLiveCoordinateCandidate(result);
        const candidateKey =
          candidate.sourceId ??
          `${candidate.name}:${candidate.latitude}:${candidate.longitude}`;

        if (seenCandidateKeys.has(candidateKey)) {
          continue;
        }

        seenCandidateKeys.add(candidateKey);
        candidates.push(candidate);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      console.warn(`Live OSM lookup failed for "${query}": ${message}`);
    }

    await delay(NOMINATIM_DELAY_MS);
  }

  return candidates;
}

function buildLiveOsmQueries(config: ManualAttractionConfig): string[] {
  const queries = [
    ...config.aliases.map((alias) => `${alias} Sarajevo`),
    `${config.label} Sarajevo`,
  ];
  const uniqueQueries = new Map<string, string>();

  for (const query of queries) {
    const normalizedQuery = normalizeSearchText(query);

    if (!uniqueQueries.has(normalizedQuery)) {
      uniqueQueries.set(normalizedQuery, query);
    }
  }

  return [...uniqueQueries.values()].slice(0, 5);
}

async function fetchNominatimResults(query: string): Promise<NominatimResult[]> {
  const url = new URL(NOMINATIM_ENDPOINT);

  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "5");
  url.searchParams.set("addressdetails", "0");
  url.searchParams.set("extratags", "1");
  url.searchParams.set("namedetails", "1");
  url.searchParams.set("accept-language", "en,bs");
  url.searchParams.set("bounded", "1");
  url.searchParams.set(
    "viewbox",
    [
      SARAJEVO_BOUNDS.west,
      SARAJEVO_BOUNDS.north,
      SARAJEVO_BOUNDS.east,
      SARAJEVO_BOUNDS.south,
    ].join(",")
  );

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`Nominatim returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as unknown;

  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.flatMap((item) => (isNominatimResult(item) ? [item] : []));
}

function isNominatimResult(value: unknown): value is NominatimResult {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.place_id === "number" &&
    typeof value.lat === "string" &&
    typeof value.lon === "string"
  );
}

function toLiveCoordinateCandidate(result: NominatimResult): CoordinateCandidate {
  const osmType = result.osm_type ?? null;
  const osmId = result.osm_id ?? null;
  const sourceId = osmType && osmId ? `${osmType}/${osmId}` : `place/${result.place_id}`;
  const candidateName =
    result.name ??
    result.namedetails?.name ??
    result.namedetails?.["name:en"] ??
    result.display_name?.split(",")[0]?.trim() ??
    sourceId;
  const classTypeTags = [result.class, result.type].flatMap((value) =>
    value ? [value] : []
  );

  return {
    name: candidateName,
    latitude: toNumber(result.lat),
    longitude: toNumber(result.lon),
    matchSource: "live_osm_lookup",
    sourceId,
    osmType,
    osmId,
    category: result.class ?? null,
    primaryCategory: result.type ?? null,
    secondaryCategories: [],
    tags: classTypeTags,
    wikidataId: result.extratags?.wikidata ?? null,
    popularityScore:
      typeof result.importance === "number" ? result.importance * 10 : null,
    importance: result.importance ?? null,
    displayName: result.display_name ?? null,
  };
}

function findBestScoredCandidate(
  manual: ManualAttractionRow,
  candidates: CoordinateCandidate[],
  config: ManualAttractionConfig
): CandidateScore | null {
  return (
    candidates
      .map((candidate) => scoreCandidate(manual, candidate, config))
      .filter((candidateScore) => candidateScore.score > 0)
      .sort(compareCandidateScores)[0] ?? null
  );
}

function compareCandidateScores(
  left: CandidateScore,
  right: CandidateScore
): number {
  if (right.score !== left.score) {
    return right.score - left.score;
  }

  return left.distanceMeters - right.distanceMeters;
}

function chooseBestMatch(
  localBestMatch: CandidateScore | null,
  liveBestMatch: CandidateScore | null,
  config: ManualAttractionConfig
): CandidateScore | null {
  const localIsUpdateable = isUpdateableMatch(localBestMatch, config);
  const liveIsUpdateable = isUpdateableMatch(liveBestMatch, config);

  if (liveIsUpdateable && !localIsUpdateable) {
    return liveBestMatch;
  }

  if (localIsUpdateable && !liveIsUpdateable) {
    return localBestMatch;
  }

  if (!localBestMatch) {
    return liveBestMatch;
  }

  if (!liveBestMatch) {
    return localBestMatch;
  }

  return compareCandidateScores(liveBestMatch, localBestMatch) < 0
    ? liveBestMatch
    : localBestMatch;
}

function scoreCandidate(
  manual: ManualAttractionRow,
  candidate: CoordinateCandidate,
  config: ManualAttractionConfig
): CandidateScore {
  const signals: string[] = [];
  const normalizedCandidateNames = getCandidateSearchNames(candidate).map(
    normalizeSearchText
  );
  const normalizedAliases = config.aliases.map(normalizeSearchText);
  const hasRequiredNameTerm = config.requiredNameTerms
    .map(normalizeSearchText)
    .some((term) =>
      normalizedCandidateNames.some((name) => namesMatch(name, term))
    );
  const distanceMeters = calculateDistanceMeters(manual, candidate);
  const isInsideSarajevo = isInsideSarajevoBounds(candidate);
  let score = 0;
  let hasExactAliasMatch = false;
  let hasStrongNameMatch = false;

  if (!isInsideSarajevo) {
    return {
      candidate,
      distanceMeters,
      hasExactAliasMatch,
      hasStrongNameMatch,
      isInsideSarajevo,
      score: 0,
      signals: ["outside Sarajevo bounding box"],
    };
  }

  if (!hasRequiredNameTerm) {
    return {
      candidate,
      distanceMeters,
      hasExactAliasMatch,
      hasStrongNameMatch,
      isInsideSarajevo,
      score: 0,
      signals: ["missing required name term"],
    };
  }

  const exactAlias = normalizedAliases.find((alias) =>
    normalizedCandidateNames.some((name) => name === alias)
  );

  if (exactAlias) {
    score += 4;
    hasExactAliasMatch = true;
    hasStrongNameMatch = true;
    signals.push(`exact alias match: ${exactAlias}`);
  } else {
    const containedAlias = normalizedAliases.find((alias) =>
      normalizedCandidateNames.some((name) => namesMatch(name, alias))
    );

    if (containedAlias) {
      score += 3;
      hasStrongNameMatch = true;
      signals.push(`alias contained in name: ${containedAlias}`);
    } else {
      const tokenScore = getAliasTokenScore(
        normalizedCandidateNames,
        normalizedAliases
      );

      if (tokenScore > 0) {
        score += tokenScore;
        signals.push(`alias token overlap: +${tokenScore.toFixed(1)}`);
      }
    }
  }

  if (candidate.wikidataId) {
    score += 1;
    signals.push("has Wikidata ID");
  }

  const popularityScore = candidate.popularityScore ?? 0;

  if (popularityScore >= 7) {
    score += 1.5;
    signals.push(`high popularity/importance: ${roundScore(popularityScore)}`);
  } else if (popularityScore >= 5) {
    score += 1;
    signals.push(`good popularity/importance: ${roundScore(popularityScore)}`);
  } else if (popularityScore > 0) {
    score += 0.5;
    signals.push(`has popularity/importance: ${roundScore(popularityScore)}`);
  }

  const categoryScore =
    getCategoryMatchScore(candidate, config.expectedCategories) +
    getOsmClassTypeScore(candidate, config.osmClassTypeTerms);

  if (categoryScore > 0) {
    score += categoryScore;
    signals.push(`category/class match: +${categoryScore.toFixed(1)}`);
  }

  if (candidate.matchSource === "live_osm_lookup") {
    score += 1;
    signals.push("inside Sarajevo bounding box");
  }

  const distanceScore = getDistanceScore(distanceMeters);

  if (distanceScore !== 0) {
    score += distanceScore;
    signals.push(
      `distance ${Math.round(distanceMeters)}m: ${formatSignedScore(
        distanceScore
      )}`
    );
  }

  if (!hasStrongNameMatch) {
    score = Math.min(score, MIN_CONFIDENCE_SCORE - 0.5);
    signals.push("confidence capped: no strong alias/name match");
  }

  return {
    candidate,
    distanceMeters,
    hasExactAliasMatch,
    hasStrongNameMatch,
    isInsideSarajevo,
    score: roundScore(score),
    signals,
  };
}

function isUpdateableMatch(
  match: CandidateScore | null,
  config: ManualAttractionConfig
): boolean {
  return getReviewReason(match, config) === null;
}

function getReviewReason(
  match: CandidateScore | null,
  config: ManualAttractionConfig
): string | null {
  if (!match) {
    return "no local or live OSM candidate found";
  }

  if (!match.isInsideSarajevo) {
    return "candidate is outside Sarajevo bounding box";
  }

  if (match.score < MIN_CONFIDENCE_SCORE) {
    return `confidence ${match.score} is below ${MIN_CONFIDENCE_SCORE}`;
  }

  if (config.label.startsWith("Tunnel of Hope") && match.distanceMeters > 500) {
    return "review recommended: Tunnel of Hope match moved over 500m and may be an entrance rather than the main visitor/museum point";
  }

  if (match.distanceMeters > config.maxMoveMeters) {
    const exactAreaMatch =
      config.kind === "area" &&
      match.hasExactAliasMatch &&
      match.score >= 8.5 &&
      match.distanceMeters <= config.maxMoveMeters * 1.5;
    const exactSmallLandmarkMatch =
      config.kind === "small_landmark" &&
      match.hasExactAliasMatch &&
      match.score >= 9 &&
      match.distanceMeters <= 1000;

    if (!exactAreaMatch && !exactSmallLandmarkMatch) {
      return `movement ${Math.round(
        match.distanceMeters
      )}m exceeds ${config.maxMoveMeters}m safety limit`;
    }
  }

  return null;
}

async function applyCoordinateUpdates(results: SyncResult[]) {
  const updates = results.filter((result) => result.status === "will_update");

  if (updates.length === 0) {
    console.log("\nNo high-confidence coordinate updates to apply.");
    return;
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    for (const update of updates) {
      if (!update.bestMatch) {
        continue;
      }

      await client.query(
        `
          UPDATE attractions
          SET
            latitude = $1,
            longitude = $2,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $3
            AND source = 'manual_seed';
        `,
        [
          update.bestMatch.candidate.latitude,
          update.bestMatch.candidate.longitude,
          update.manual.id,
        ]
      );
    }

    await client.query("COMMIT");
    console.log(`\nApplied ${updates.length} coordinate updates.`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function printSyncResults(results: SyncResult[]) {
  console.log("\nCoordinate sync preview:");
  console.table(
    results.map((result) => ({
      manualName: result.manual.name,
      oldCoordinates: formatCoordinates(result.manual),
      matchedCandidate: result.bestMatch?.candidate.name ?? "",
      matchSource: result.bestMatch?.candidate.matchSource ?? "",
      osmRef: getOsmReference(result.bestMatch?.candidate ?? null),
      newCoordinates: result.bestMatch
        ? formatCoordinates(result.bestMatch.candidate)
        : "",
      confidence: result.bestMatch?.score ?? "",
      movedMeters: result.bestMatch
        ? Math.round(result.bestMatch.distanceMeters)
        : "",
      status: result.status,
      reason: result.reason,
      signals: result.bestMatch?.signals.join("; ") ?? "",
    }))
  );
}

function getCandidateSearchNames(candidate: CoordinateCandidate): string[] {
  return [candidate.name, candidate.displayName].flatMap((value) =>
    value ? [value] : []
  );
}

function getOsmReference(candidate: CoordinateCandidate | null): string {
  if (!candidate) {
    return "";
  }

  if (candidate.sourceId) {
    return candidate.sourceId;
  }

  if (candidate.osmType && candidate.osmId) {
    return `${candidate.osmType}/${candidate.osmId}`;
  }

  return "";
}

function namesMatch(normalizedName: string, normalizedAlias: string): boolean {
  if (!normalizedName || !normalizedAlias) {
    return false;
  }

  if (normalizedName === normalizedAlias) {
    return true;
  }

  if (normalizedAlias.length < 5) {
    return normalizedName.split(" ").includes(normalizedAlias);
  }

  if (normalizedName.length < 5) {
    return false;
  }

  return (
    normalizedName.includes(normalizedAlias) ||
    normalizedAlias.includes(normalizedName)
  );
}

function getAliasTokenScore(
  normalizedNames: string[],
  normalizedAliases: string[]
): number {
  let bestScore = 0;

  for (const normalizedName of normalizedNames) {
    const nameTokens = new Set(normalizedName.split(" ").filter(Boolean));

    for (const alias of normalizedAliases) {
      const aliasTokens = alias.split(" ").filter((token) => token.length >= 4);

      if (aliasTokens.length === 0) {
        continue;
      }

      const matchedTokens = aliasTokens.filter((token) => nameTokens.has(token));
      const ratio = matchedTokens.length / aliasTokens.length;

      if (ratio >= 0.75) {
        bestScore = Math.max(bestScore, 2);
      } else if (ratio >= 0.5) {
        bestScore = Math.max(bestScore, 1);
      }
    }
  }

  return bestScore;
}

function getCategoryMatchScore(
  candidate: CoordinateCandidate,
  expectedCategories: string[]
): number {
  const expectedCategoryLabels = new Set(expectedCategories.map(normalizeLabel));
  const primaryLabels = labelsFromValues([
    candidate.category,
    candidate.primaryCategory,
  ]);
  const secondaryLabels = labelsFromValues(candidate.secondaryCategories ?? []);

  if (hasSetOverlap(primaryLabels, expectedCategoryLabels)) {
    return 1.5;
  }

  if (hasSetOverlap(secondaryLabels, expectedCategoryLabels)) {
    return 1;
  }

  return 0;
}

function getOsmClassTypeScore(
  candidate: CoordinateCandidate,
  osmClassTypeTerms: string[]
): number {
  const expectedLabels = new Set(osmClassTypeTerms.map(normalizeLabel));
  const candidateLabels = labelsFromValues([
    candidate.category,
    candidate.primaryCategory,
    ...(candidate.tags ?? []),
  ]);

  if (hasSetOverlap(candidateLabels, expectedLabels)) {
    return candidate.matchSource === "live_osm_lookup" ? 1 : 0.5;
  }

  return 0;
}

function getDistanceScore(distanceMeters: number): number {
  if (!Number.isFinite(distanceMeters)) {
    return 0;
  }

  if (distanceMeters <= 100) {
    return 2;
  }

  if (distanceMeters <= 300) {
    return 1.5;
  }

  if (distanceMeters <= 1000) {
    return 0.75;
  }

  if (distanceMeters <= 5000) {
    return 0.25;
  }

  return -2;
}

function calculateDistanceMeters(
  left: Pick<ManualAttractionRow, "latitude" | "longitude">,
  right: Pick<CoordinateCandidate, "latitude" | "longitude">
): number {
  const leftLatitude = toNumber(left.latitude);
  const leftLongitude = toNumber(left.longitude);
  const rightLatitude = toNumber(right.latitude);
  const rightLongitude = toNumber(right.longitude);

  if (
    !Number.isFinite(leftLatitude) ||
    !Number.isFinite(leftLongitude) ||
    !Number.isFinite(rightLatitude) ||
    !Number.isFinite(rightLongitude)
  ) {
    return Number.POSITIVE_INFINITY;
  }

  const earthRadiusMeters = 6_371_000;
  const latitudeDelta = degreesToRadians(rightLatitude - leftLatitude);
  const longitudeDelta = degreesToRadians(rightLongitude - leftLongitude);
  const leftLatitudeRadians = degreesToRadians(leftLatitude);
  const rightLatitudeRadians = degreesToRadians(rightLatitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(leftLatitudeRadians) *
      Math.cos(rightLatitudeRadians) *
      Math.sin(longitudeDelta / 2) ** 2;

  return (
    earthRadiusMeters *
    2 *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  );
}

function isInsideSarajevoBounds(
  candidate: Pick<CoordinateCandidate, "latitude" | "longitude">
): boolean {
  return (
    candidate.latitude >= SARAJEVO_BOUNDS.south &&
    candidate.latitude <= SARAJEVO_BOUNDS.north &&
    candidate.longitude >= SARAJEVO_BOUNDS.west &&
    candidate.longitude <= SARAJEVO_BOUNDS.east
  );
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function formatCoordinates(
  row: Pick<ManualAttractionRow | CoordinateCandidate, "latitude" | "longitude">
) {
  return `${toNumber(row.latitude).toFixed(6)}, ${toNumber(row.longitude).toFixed(
    6
  )}`;
}

function normalizeTextArray(value: string[] | string | null | undefined): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    return [];
  }

  return value
    .replace(/^{|}$/g, "")
    .split(",")
    .map((item) => item.replace(/^"|"$/g, "").trim())
    .filter((item) => item.length > 0);
}

function labelsFromValues(values: Array<string | null | undefined>): Set<string> {
  return new Set(
    values
      .flatMap((value) => (value ? [normalizeLabel(value)] : []))
      .filter((value) => value.length > 0)
  );
}

function hasSetOverlap<T>(left: Set<T>, right: Set<T>): boolean {
  for (const value of left) {
    if (right.has(value)) {
      return true;
    }
  }

  return false;
}

function normalizeSearchText(value: string): string {
  return value
    .replace(/[đĐ]/g, "d")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLabel(value: string | null | undefined): string {
  return normalizeSearchText(value ?? "").replaceAll(" ", "_");
}

function toNumber(value: string | number | null | undefined): number {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatSignedScore(value: number): string {
  return value > 0 ? `+${value.toFixed(2)}` : value.toFixed(2);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main()
  .catch((error) => {
    console.error("Manual coordinate sync failed:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    return pool.end();
  });
