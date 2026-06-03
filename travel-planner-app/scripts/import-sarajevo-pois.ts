import "dotenv/config";
import dotenv from "dotenv";
import path from "path";
import { Pool } from "pg";

dotenv.config({
  path: path.resolve(process.cwd(), ".env.local"),
});

type OsmTags = Record<string, string>;

type OsmElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: {
    lat: number;
    lon: number;
  };
  tags?: OsmTags;
};

type NormalizedPoi = {
  name: string;
  description: string;
  latitude: number;
  longitude: number;
  address: string | null;
  primaryCategory: string;
  secondaryCategories: string[];
  tags: string[];
  source: string;
  sourceId: string;
  osmType: string;
  osmId: string;
  wikidataId: string | null;
  website: string | null;
  rating: number | null;
  popularityScore: number;
  estimatedVisitDuration: number;
  priceLevel: string;
  isIndoor: boolean;
  isOutdoor: boolean;
  weatherSensitive: boolean;
  openingHours: string | null;
};

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is missing. Check travel-planner-app/.env.local");
}

const pool = new Pool({
  connectionString: DATABASE_URL,
});

// Sarajevo bounding box.
// Format used by Overpass: south, west, north, east.
const SARAJEVO_BBOX = {
  south: 43.79,
  west: 18.25,
  north: 43.93,
  east: 18.53,
};

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

// Keep this controlled at first.
// After testing, you can increase it.
const MAX_POIS_TO_IMPORT = 250;

function buildOverpassQuery() {
  const { south, west, north, east } = SARAJEVO_BBOX;
  const bbox = `${south},${west},${north},${east}`;

  return `
    [out:json][timeout:60];
    (
      node["tourism"~"attraction|museum|gallery|viewpoint|artwork"](${bbox});
      way["tourism"~"attraction|museum|gallery|viewpoint|artwork"](${bbox});
      relation["tourism"~"attraction|museum|gallery|viewpoint|artwork"](${bbox});

      node["historic"](${bbox});
      way["historic"](${bbox});
      relation["historic"](${bbox});

      node["amenity"~"place_of_worship|restaurant|cafe|fast_food|theatre|cinema|arts_centre|marketplace"](${bbox});
      way["amenity"~"place_of_worship|restaurant|cafe|fast_food|theatre|cinema|arts_centre|marketplace"](${bbox});
      relation["amenity"~"place_of_worship|restaurant|cafe|fast_food|theatre|cinema|arts_centre|marketplace"](${bbox});

      node["leisure"~"park|garden|sports_centre|stadium|pitch"](${bbox});
      way["leisure"~"park|garden|sports_centre|stadium|pitch"](${bbox});
      relation["leisure"~"park|garden|sports_centre|stadium|pitch"](${bbox});

      node["shop"~"mall|department_store|souvenir"](${bbox});
      way["shop"~"mall|department_store|souvenir"](${bbox});
      relation["shop"~"mall|department_store|souvenir"](${bbox});
    );
    out center tags;
  `;
}

function getCoordinates(element: OsmElement) {
  if (typeof element.lat === "number" && typeof element.lon === "number") {
    return {
      latitude: element.lat,
      longitude: element.lon,
    };
  }

  if (element.center) {
    return {
      latitude: element.center.lat,
      longitude: element.center.lon,
    };
  }

  return null;
}

function buildAddress(tags: OsmTags): string | null {
  const street = tags["addr:street"];
  const houseNumber = tags["addr:housenumber"];
  const city = tags["addr:city"];

  const parts = [
    street,
    houseNumber,
    city,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" ") : null;
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function classifyPoi(tags: OsmTags): {
  primaryCategory: string;
  secondaryCategories: string[];
  normalizedTags: string[];
  estimatedVisitDuration: number;
  priceLevel: string;
  isIndoor: boolean;
  isOutdoor: boolean;
  weatherSensitive: boolean;
} {
  const tourism = tags.tourism;
  const amenity = tags.amenity;
  const historic = tags.historic;
  const leisure = tags.leisure;
  const shop = tags.shop;
  const religion = tags.religion;
  const cuisine = tags.cuisine;

  let primaryCategory = "Culture";
  const secondaryCategories: string[] = [];
  const normalizedTags: string[] = [];

  let estimatedVisitDuration = 60;
  let priceLevel = "unknown";
  let isIndoor = false;
  let isOutdoor = false;
  let weatherSensitive = false;

  if (tourism === "museum") {
    primaryCategory = "Museum";
    secondaryCategories.push("Culture", "History", "Family");
    normalizedTags.push("museum", "indoor", "education");
    estimatedVisitDuration = 90;
    priceLevel = "low";
    isIndoor = true;
  } else if (tourism === "gallery") {
    primaryCategory = "Culture";
    secondaryCategories.push("Museum", "Art", "Architecture");
    normalizedTags.push("gallery", "art", "indoor");
    estimatedVisitDuration = 60;
    priceLevel = "low";
    isIndoor = true;
  } else if (tourism === "viewpoint") {
    primaryCategory = "Viewpoint";
    secondaryCategories.push("Nature", "Photography");
    normalizedTags.push("viewpoint", "panorama", "outdoor");
    estimatedVisitDuration = 40;
    priceLevel = "free";
    isOutdoor = true;
    weatherSensitive = true;
  } else if (tourism === "artwork") {
    primaryCategory = "Culture";
    secondaryCategories.push("Architecture", "History");
    normalizedTags.push("artwork", "public art", "walking");
    estimatedVisitDuration = 25;
    priceLevel = "free";
    isOutdoor = true;
    weatherSensitive = true;
  } else if (tourism === "attraction") {
    primaryCategory = "Culture";
    secondaryCategories.push("History", "Architecture", "Family");
    normalizedTags.push("tourist attraction", "sightseeing");
    estimatedVisitDuration = 60;
    isOutdoor = true;
    weatherSensitive = true;
  }

  if (historic) {
    primaryCategory = "History";
    secondaryCategories.push("Culture", "Architecture");
    normalizedTags.push("historic", historic);

    if (historic.includes("memorial") || historic.includes("battlefield")) {
      secondaryCategories.push("War History");
      normalizedTags.push("war history");
    }

    estimatedVisitDuration = Math.max(estimatedVisitDuration, 45);
    priceLevel = priceLevel === "unknown" ? "free" : priceLevel;
    isOutdoor = isOutdoor || true;
    weatherSensitive = weatherSensitive || true;
  }

  if (amenity === "place_of_worship") {
    primaryCategory = "Religion";
    secondaryCategories.push("Architecture", "Culture", "History");
    normalizedTags.push("religion", "place of worship", religion || "");
    estimatedVisitDuration = 45;
    priceLevel = "free";
    isIndoor = true;
    isOutdoor = true;
    weatherSensitive = false;
  }

  if (amenity === "restaurant" || amenity === "cafe" || amenity === "fast_food") {
    primaryCategory = amenity === "cafe" ? "Cafe" : "Food";
    secondaryCategories.push("Culture", "Local Experience");
    normalizedTags.push("food", amenity, cuisine || "");

    if (cuisine?.includes("bosnian") || cuisine?.includes("balkan")) {
      secondaryCategories.push("Traditional Bosnian Food");
      normalizedTags.push("traditional bosnian food");
    }

    estimatedVisitDuration = amenity === "cafe" ? 45 : 75;
    priceLevel = "medium";
    isIndoor = true;
    weatherSensitive = false;
  }

  if (amenity === "theatre" || amenity === "cinema" || amenity === "arts_centre") {
    primaryCategory = "Entertainment";
    secondaryCategories.push("Culture", "Family");
    normalizedTags.push("entertainment", amenity, "indoor");
    estimatedVisitDuration = 120;
    priceLevel = "medium";
    isIndoor = true;
    weatherSensitive = false;
  }

  if (amenity === "marketplace") {
    primaryCategory = "Shopping";
    secondaryCategories.push("Culture", "Food", "Local Experience");
    normalizedTags.push("marketplace", "shopping", "local culture");
    estimatedVisitDuration = 60;
    priceLevel = "medium";
    isOutdoor = true;
    weatherSensitive = true;
  }

  if (leisure === "park" || leisure === "garden") {
    primaryCategory = "Nature";
    secondaryCategories.push("Park", "Family", "Relaxation");
    normalizedTags.push("park", "green space", "walking", "outdoor");
    estimatedVisitDuration = 75;
    priceLevel = "free";
    isOutdoor = true;
    weatherSensitive = true;
  }

  if (leisure === "sports_centre" || leisure === "stadium" || leisure === "pitch") {
    primaryCategory = "Sport";
    secondaryCategories.push("Entertainment", "Family");
    normalizedTags.push("sport", leisure);
    estimatedVisitDuration = 75;
    priceLevel = "medium";
    isOutdoor = leisure !== "sports_centre";
    isIndoor = leisure === "sports_centre";
    weatherSensitive = isOutdoor;
  }

  if (shop === "mall" || shop === "department_store" || shop === "souvenir") {
    primaryCategory = "Shopping";
    secondaryCategories.push("Culture", "Food", "Entertainment");
    normalizedTags.push("shopping", shop);
    estimatedVisitDuration = shop === "mall" ? 120 : 45;
    priceLevel = "medium";
    isIndoor = shop !== "souvenir";
    isOutdoor = shop === "souvenir";
    weatherSensitive = shop === "souvenir";
  }

  const name = tags.name || "";
  const lowerName = name.toLowerCase();

  if (
    lowerName.includes("džamija") ||
    lowerName.includes("dzamija") ||
    lowerName.includes("mosque") ||
    lowerName.includes("crkva") ||
    lowerName.includes("church") ||
    lowerName.includes("synagogue") ||
    lowerName.includes("sinagoga")
  ) {
    primaryCategory = "Religion";
    secondaryCategories.push("Architecture", "Culture", "History");
    normalizedTags.push("religious site");
    isIndoor = true;
    weatherSensitive = false;
  }

  if (
    lowerName.includes("muzej") ||
    lowerName.includes("museum")
  ) {
    primaryCategory = "Museum";
    secondaryCategories.push("History", "Culture");
    normalizedTags.push("museum");
    isIndoor = true;
    weatherSensitive = false;
  }

  if (
    lowerName.includes("spomen") ||
    lowerName.includes("memorial") ||
    lowerName.includes("war") ||
    lowerName.includes("rat")
  ) {
    secondaryCategories.push("War History");
    normalizedTags.push("war history", "memorial");
  }

  return {
    primaryCategory,
    secondaryCategories: unique(secondaryCategories),
    normalizedTags: unique(normalizedTags),
    estimatedVisitDuration,
    priceLevel,
    isIndoor,
    isOutdoor,
    weatherSensitive,
  };
}

function buildDescription(name: string, primaryCategory: string, secondaryCategories: string[], tags: OsmTags) {
  const osmTypeDescription = [
    tags.tourism ? `tourism=${tags.tourism}` : null,
    tags.amenity ? `amenity=${tags.amenity}` : null,
    tags.historic ? `historic=${tags.historic}` : null,
    tags.leisure ? `leisure=${tags.leisure}` : null,
    tags.shop ? `shop=${tags.shop}` : null,
  ].filter(Boolean).join(", ");

  const categoryText = [primaryCategory, ...secondaryCategories].slice(0, 4).join(", ");

  return `${name} is a Sarajevo point of interest categorized as ${categoryText}. Imported from OpenStreetMap${osmTypeDescription ? ` using tags: ${osmTypeDescription}` : ""}.`;
}

function normalizeElement(element: OsmElement): NormalizedPoi | null {
  const tags = element.tags || {};
  const name = tags.name || tags["name:bs"] || tags["name:en"];

  if (!name) {
    return null;
  }

  const coordinates = getCoordinates(element);

  if (!coordinates) {
    return null;
  }

  const classification = classifyPoi(tags);

  const sourceId = `${element.type}/${element.id}`;

  return {
    name,
    description: buildDescription(
      name,
      classification.primaryCategory,
      classification.secondaryCategories,
      tags
    ),
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    address: buildAddress(tags),
    primaryCategory: classification.primaryCategory,
    secondaryCategories: classification.secondaryCategories,
    tags: classification.normalizedTags,
    source: "openstreetmap",
    sourceId,
    osmType: element.type,
    osmId: String(element.id),
    wikidataId: tags.wikidata || null,
    website: tags.website || tags["contact:website"] || null,
    rating: null,
    popularityScore: calculatePopularityScore(tags),
    estimatedVisitDuration: classification.estimatedVisitDuration,
    priceLevel: classification.priceLevel,
    isIndoor: classification.isIndoor,
    isOutdoor: classification.isOutdoor,
    weatherSensitive: classification.weatherSensitive,
    openingHours: tags.opening_hours || null,
  };
}

function calculatePopularityScore(tags: OsmTags): number {
  let score = 1;

  if (tags.wikidata) score += 2;
  if (tags.wikipedia) score += 2;
  if (tags.website || tags["contact:website"]) score += 1;
  if (tags.tourism === "attraction") score += 2;
  if (tags.tourism === "museum") score += 2;
  if (tags.historic) score += 1.5;
  if (tags.name && tags.name.length < 35) score += 0.5;

  return Math.min(score, 10);
}

async function fetchPoisFromOverpass(): Promise<OsmElement[]> {
  {
    const query = buildOverpassQuery().trim();

    let lastError = "";

    for (const endpoint of OVERPASS_ENDPOINTS) {
      console.log(`Trying Overpass endpoint: ${endpoint}`);

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "text/plain; charset=UTF-8",
            "Accept": "application/json, text/plain, */*",
            "User-Agent": "adaptive-travel-itinerary-planner/1.0 MSc-project",
            "Referer": "http://localhost:3000",
          },
          body: query,
        });

        if (!response.ok) {
          const text = await response.text();
          lastError = `Overpass request failed at ${endpoint}: ${response.status} ${response.statusText}\n${text}`;
          console.warn(lastError);
          continue;
        }

        const data = await response.json();
        return data.elements || [];
      } catch (error) {
        lastError = `Overpass endpoint failed: ${endpoint}\n${String(error)}`;
        console.warn(lastError);
      }
    }

    throw new Error(lastError || "All Overpass endpoints failed.");
  }

  const query = buildOverpassQuery();

  const response = await fetch(OVERPASS_ENDPOINTS[0], {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: new URLSearchParams({
      data: query,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Overpass request failed: ${response.status} ${response.statusText}\n${text}`);
  }

  const data = await response.json();

  return data.elements || [];
}

async function upsertPoi(poi: NormalizedPoi) {
  await pool.query(
    `
      INSERT INTO attractions (
        name,
        description,
        category,
        latitude,
        longitude,
        address,
        primary_category,
        secondary_categories,
        tags,
        source,
        source_id,
        osm_type,
        osm_id,
        wikidata_id,
        website,
        rating,
        popularity_score,
        estimated_visit_duration,
        price_level,
        is_indoor,
        is_outdoor,
        weather_sensitive,
        opening_hours,
        updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15,
        $16, $17, $18, $19, $20,
        $21, $22, $23, CURRENT_TIMESTAMP
      )
      ON CONFLICT (source, source_id)
      DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude,
        address = EXCLUDED.address,
        primary_category = EXCLUDED.primary_category,
        secondary_categories = EXCLUDED.secondary_categories,
        tags = EXCLUDED.tags,
        osm_type = EXCLUDED.osm_type,
        osm_id = EXCLUDED.osm_id,
        wikidata_id = EXCLUDED.wikidata_id,
        website = EXCLUDED.website,
        popularity_score = EXCLUDED.popularity_score,
        estimated_visit_duration = EXCLUDED.estimated_visit_duration,
        price_level = EXCLUDED.price_level,
        is_indoor = EXCLUDED.is_indoor,
        is_outdoor = EXCLUDED.is_outdoor,
        weather_sensitive = EXCLUDED.weather_sensitive,
        opening_hours = EXCLUDED.opening_hours,
        updated_at = CURRENT_TIMESTAMP;
    `,
    [
      poi.name,
      poi.description,
      poi.primaryCategory, // old required category column
      poi.latitude,
      poi.longitude,
      poi.address,
      poi.primaryCategory,
      poi.secondaryCategories,
      poi.tags,
      poi.source,
      poi.sourceId,
      poi.osmType,
      poi.osmId,
      poi.wikidataId,
      poi.website,
      poi.rating,
      poi.popularityScore,
      poi.estimatedVisitDuration,
      poi.priceLevel,
      poi.isIndoor,
      poi.isOutdoor,
      poi.weatherSensitive,
      poi.openingHours,
    ]
  );
}

async function main() {
  console.log("Fetching Sarajevo POIs from OpenStreetMap / Overpass...");

  const elements = await fetchPoisFromOverpass();

  console.log(`Raw OSM elements received: ${elements.length}`);

  const normalized = elements
    .map(normalizeElement)
    .filter((poi): poi is NormalizedPoi => poi !== null)
    .slice(0, MAX_POIS_TO_IMPORT);

  console.log(`Valid POIs after normalization: ${normalized.length}`);

  const categoryCounts = normalized.reduce<Record<string, number>>((acc, poi) => {
    acc[poi.primaryCategory] = (acc[poi.primaryCategory] || 0) + 1;
    return acc;
  }, {});

  console.log("Category preview:");
  console.table(categoryCounts);

  console.log("Sample POIs:");
  console.table(
    normalized.slice(0, 15).map((poi) => ({
      name: poi.name,
      category: poi.primaryCategory,
      lat: poi.latitude,
      lng: poi.longitude,
      duration: poi.estimatedVisitDuration,
      sourceId: poi.sourceId,
    }))
  );

  for (const poi of normalized) {
    await upsertPoi(poi);
  }

  console.log(`Imported/updated ${normalized.length} POIs successfully.`);
}

main()
  .catch((error) => {
    console.error("Import failed:");
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
