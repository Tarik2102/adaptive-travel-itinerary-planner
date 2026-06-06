const TOMTOM_BASE = "https://api.tomtom.com/routing/1/calculateRoute";

export interface LiveLegTraffic {
  liveSeconds: number;
  baselineSeconds: number;
  trafficDelaySeconds: number;
  delayFactor: number;
  source: "tomtom";
}

// 60s in-memory cache keyed by coords rounded to 2 dp (≈1.1 km precision)
const _trafficCache = new Map<
  string,
  { value: LiveLegTraffic; expiresAt: number }
>();

function _cacheKey(
  start: { lat: number; lng: number },
  end: { lat: number; lng: number }
): string {
  return `${start.lat.toFixed(2)},${start.lng.toFixed(2)}:${end.lat.toFixed(2)},${end.lng.toFixed(2)}`;
}

// start/end are { lat, lng } — matching your frontend convention
export async function getLiveLegTraffic(
  start: { lat: number; lng: number },
  end: { lat: number; lng: number }
): Promise<LiveLegTraffic | null> {
  const apiKey = process.env.TOMTOM_API_KEY;
  if (!apiKey) return null;

  const ck = _cacheKey(start, end);
  const cached = _trafficCache.get(ck);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  // NOTE: TomTom path order is lat,lon (NOT lon,lat like ORS)
  const path = `${start.lat},${start.lng}:${end.lat},${end.lng}`;
  const url =
    `${TOMTOM_BASE}/${path}/json` +
    `?traffic=true&computeTravelTimeFor=all&routeType=fastest&travelMode=car&key=${apiKey}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      routes?: Array<{
        summary?: {
          travelTimeInSeconds: number;
          noTrafficTravelTimeInSeconds?: number;
          trafficDelayInSeconds?: number;
        };
      }>;
    };
    const s = data?.routes?.[0]?.summary;
    if (!s) return null;
    const live = s.travelTimeInSeconds;
    const base = Math.max(s.noTrafficTravelTimeInSeconds ?? live, 1);
    const result: LiveLegTraffic = {
      liveSeconds: live,
      baselineSeconds: base,
      trafficDelaySeconds: s.trafficDelayInSeconds ?? Math.max(live - base, 0),
      delayFactor: live / base,
      source: "tomtom",
    };
    _trafficCache.set(ck, { value: result, expiresAt: Date.now() + 60_000 });
    return result;
  } catch {
    return null;
  }
}

// Configurable trigger thresholds (document these in the thesis)
export const TRAFFIC_DELAY_FACTOR_THRESHOLD = 1.3;   // ≥30% slower than baseline
export const TRAFFIC_DELAY_SECONDS_THRESHOLD = 300;  // ≥5 min absolute delay