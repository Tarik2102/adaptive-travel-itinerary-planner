export type Coordinates = {
  latitude: number;
  longitude: number;
};

export type Coordinate = {
  lat: number;
  lng: number;
};

export type RouteGeometry = {
  coordinates: Coordinate[];
};

export const WALKING_LEG_DISTANCE_THRESHOLD_KM = 0.4;

export type RoutingTransport = "walking" | "driving";
export type RoutingProvider = "openrouteservice" | "osrm" | "fallback";
export type RoutingFallbackReason =
  | "missing_ors_key"
  | "ors_401"
  | "ors_403"
  | "ors_429_rate_limited"
  | "ors_400_invalid_coordinates"
  | "ors_network_error"
  | "ors_invalid_response"
  | "ors_http_error"
  | "insufficient_coordinates"
  | "request_aborted"
  | "unknown";

export type RouteLeg = {
  fromIndex: number;
  toIndex: number;
  transport: RoutingTransport;
  distanceKm: number;
  durationMinutes: number;
  geometryStartOffset: number;
};

export type RoutingMetadata = {
  provider: RoutingProvider;
  fallbackReason?: RoutingFallbackReason;
  transport: RoutingTransport;
  geometryPointCount: number;
  legs?: RouteLeg[];
  hasMixedModes?: boolean;
};

export type RoutingResponse = {
  distanceMeters: number;
  distanceKm: number;
  durationSeconds: number;
  travelTimeMinutes: number;
  transport: RoutingTransport;
  provider: RoutingProvider;
  fallbackReason?: RoutingFallbackReason;
  routeGeometry?: RouteGeometry;
  legDurationsSeconds?: number[];
};

type RouteOptions = {
  transport?: RoutingTransport;
  includeGeometry?: boolean;
};

type OsrmRouteOptions = RouteOptions & {
  profile?: string;
};

class RouteProviderError extends Error {
  constructor(
    message: string,
    readonly provider: RoutingProvider,
    readonly fallbackReason: RoutingFallbackReason,
    readonly statusCode?: number,
    readonly responseBody?: string
  ) {
    super(message);
    this.name = "RouteProviderError";
  }
}

const warnedProviderFallbacks = new Set<string>();
const maximumPedestrianSpeedKmH = 8;

export function calculateHaversineDistanceKm(
  from: Coordinates,
  to: Coordinates
): number {
  const R = 6371;

  const dLat = ((to.latitude - from.latitude) * Math.PI) / 180;
  const dLon = ((to.longitude - from.longitude) * Math.PI) / 180;

  const lat1 = (from.latitude * Math.PI) / 180;
  const lat2 = (to.latitude * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) *
      Math.sin(dLon / 2) *
      Math.cos(lat1) *
      Math.cos(lat2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

export function estimateWalkingTimeMinutes(distanceKm: number): number {
  const averageWalkingSpeedKmH = 4.5;
  return Math.round((distanceKm / averageWalkingSpeedKmH) * 60);
}

export function estimateDrivingTimeMinutes(distanceKm: number): number {
  const urbanDrivingSpeedKmH = 25;
  return Math.max(1, Math.round((distanceKm / urbanDrivingSpeedKmH) * 60));
}

export async function getRouteTime(
  from: Coordinates,
  to: Coordinates,
  transport: RoutingTransport = "driving"
): Promise<number> {
  const route = await getRoute([from, to], {
    includeGeometry: false,
    transport,
  });

  return route.travelTimeMinutes;
}

export async function getRoute(
  coordinates: Coordinates[],
  options: RouteOptions = {}
): Promise<RoutingResponse> {
  const validCoordinates = coordinates.filter(isValidCoordinates);
  const transport = options.transport ?? "driving";
  const includeGeometry = options.includeGeometry ?? true;

  if (validCoordinates.length < 2) {
    return buildInsufficientCoordinatesResponse(validCoordinates, transport);
  }

  let fallbackReason: RoutingFallbackReason | undefined;

  try {
    return await getOpenRouteServiceRoute(validCoordinates, {
      includeGeometry,
      transport,
    });
  } catch (error) {
    const routeError = toRouteProviderError(error, "openrouteservice");
    fallbackReason = routeError.fallbackReason;

    logOpenRouteServiceError(routeError, transport);
    warnProviderFallback("openrouteservice", transport, routeError);
  }

  try {
    const route = await getOsrmRoute(validCoordinates, {
      includeGeometry,
      transport,
    });

    if (
      route?.routeGeometry &&
      isOriginalStopGeometry(route.routeGeometry, validCoordinates)
    ) {
      return buildFallbackRoutingResponse(
        validCoordinates,
        transport,
        fallbackReason ?? "ors_invalid_response"
      );
    }

    return route
      ? { ...route, ...(fallbackReason ? { fallbackReason } : {}) }
      : buildFallbackRoutingResponse(
          validCoordinates,
          transport,
          fallbackReason ?? "unknown"
        );
  } catch (error) {
    warnProviderFallback("osrm", transport, error);
  }

  return buildFallbackRoutingResponse(
    validCoordinates,
    transport,
    fallbackReason ?? "unknown"
  );
}

async function getOpenRouteServiceRoute(
  coordinates: Coordinates[],
  options: Required<RouteOptions>
): Promise<RoutingResponse> {
  const apiKey = process.env.OPENROUTESERVICE_API_KEY?.trim();

  if (!apiKey) {
    throw new RouteProviderError(
      "OPENROUTESERVICE_API_KEY is not configured",
      "openrouteservice",
      "missing_ors_key"
    );
  }

  const profile = getOpenRouteServiceProfile(options.transport);
  const url = `https://api.openrouteservice.org/v2/directions/${profile}/geojson`;
  let response: Response;

  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/geo+json",
        Authorization: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        coordinates: coordinates.map((coordinate) => [
          coordinate.longitude,
          coordinate.latitude,
        ]),
      }),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown network error";

    throw new RouteProviderError(
      `OpenRouteService network request failed: ${message}`,
      "openrouteservice",
      isAbortError(error) ? "request_aborted" : "ors_network_error"
    );
  }

  const responseBody = await response.text();

  if (!response.ok) {
    throw new RouteProviderError(
      `OpenRouteService route request failed with HTTP ${response.status}`,
      "openrouteservice",
      getOpenRouteServiceHttpFallbackReason(response.status),
      response.status,
      responseBody
    );
  }

  const payload = parseOpenRouteServiceResponseBody(
    responseBody,
    response.status
  );
  const route = parseOpenRouteServiceRoute(
    payload,
    options.includeGeometry,
    options.transport
  );

  if (!route) {
    throw new RouteProviderError(
      "OpenRouteService response did not include a route",
      "openrouteservice",
      "ors_invalid_response",
      response.status,
      responseBody
    );
  }

  if (
    options.includeGeometry &&
    route.routeGeometry &&
    isOriginalStopGeometry(route.routeGeometry, coordinates)
  ) {
    throw new RouteProviderError(
      "OpenRouteService returned only original stop coordinates",
      "openrouteservice",
      "ors_invalid_response",
      response.status,
      responseBody
    );
  }

  return route;
}

export async function getOsrmRouteTime(
  from: Coordinates,
  to: Coordinates,
  transport: RoutingTransport = "driving"
): Promise<number> {
  return getRouteTime(from, to, transport);
}

export async function getOsrmRoute(
  coordinates: Coordinates[],
  options: OsrmRouteOptions = {}
): Promise<RoutingResponse | null> {
  const validCoordinates = coordinates.filter(isValidCoordinates);

  if (validCoordinates.length < 2) {
    return null;
  }

  const baseUrl = process.env.OSRM_BASE_URL || "https://router.project-osrm.org";
  const transport = options.transport ?? profileToTransport(options.profile);
  const profile = options.profile ?? getOsrmProfileForTransport(transport);
  const includeGeometry = options.includeGeometry ?? true;
  const coordinateString = validCoordinates
    .map((coordinate) => `${coordinate.longitude},${coordinate.latitude}`)
    .join(";");
  const params = new URLSearchParams({
    overview: includeGeometry ? "full" : "false",
    ...(includeGeometry ? { geometries: "geojson" } : {}),
  });
  const url = `${baseUrl.replace(/\/$/, "")}/route/v1/${profile}/${coordinateString}?${params.toString()}`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`OSRM route request failed with HTTP ${response.status}`);
  }

  const payload = (await response.json()) as unknown;
  const route = parseOsrmRoute(payload, includeGeometry, transport);

  if (!route) {
    throw new Error("OSRM route response did not include a route");
  }

  if (transport === "walking" && !isPedestrianPlausible(route)) {
    throw new Error(
      "OSRM walking profile returned implausible pedestrian timing"
    );
  }

  return route;
}

function parseOpenRouteServiceRoute(
  payload: unknown,
  includeGeometry: boolean,
  transport: RoutingTransport
): RoutingResponse | null {
  if (!isRecord(payload) || !Array.isArray(payload.features)) {
    return null;
  }

  const feature = payload.features[0];

  if (!isRecord(feature)) {
    return null;
  }

  const properties = isRecord(feature.properties) ? feature.properties : {};
  const summary = isRecord(properties.summary) ? properties.summary : null;
  const segments = getOpenRouteServiceSegments(properties.segments);
  const distanceMeters = Number(summary?.distance ?? segments.distance);
  const durationSeconds = Number(summary?.duration ?? segments.duration);

  if (!Number.isFinite(distanceMeters) || !Number.isFinite(durationSeconds)) {
    return null;
  }

  const routingResponse: RoutingResponse = {
    distanceMeters,
    distanceKm: distanceMeters / 1000,
    durationSeconds,
    provider: "openrouteservice",
    transport,
    travelTimeMinutes: Math.round(durationSeconds / 60),
  };

  if (segments.legDurationsSeconds.length > 0) {
    routingResponse.legDurationsSeconds = segments.legDurationsSeconds;
  }

  if (includeGeometry) {
    const routeGeometry = parseGeoJsonGeometry(
      isRecord(feature.geometry) ? feature.geometry : null
    );

    if (routeGeometry.coordinates.length >= 2) {
      routingResponse.routeGeometry = routeGeometry;
    }
  }

  return routingResponse;
}

function parseOsrmRoute(
  payload: unknown,
  includeGeometry: boolean,
  transport: RoutingTransport
): RoutingResponse | null {
  if (!isRecord(payload)) {
    return null;
  }

  if (typeof payload.code === "string" && payload.code !== "Ok") {
    throw new Error(`OSRM route request returned ${payload.code}`);
  }

  if (!Array.isArray(payload.routes) || payload.routes.length === 0) {
    return null;
  }

  const route = payload.routes[0];

  if (!isRecord(route)) {
    return null;
  }

  const distanceMeters = Number(route.distance);
  const durationSeconds = Number(route.duration);

  if (!Number.isFinite(distanceMeters) || !Number.isFinite(durationSeconds)) {
    return null;
  }

  const routingResponse: RoutingResponse = {
    distanceMeters,
    distanceKm: distanceMeters / 1000,
    durationSeconds,
    provider: "osrm",
    transport,
    travelTimeMinutes: Math.round(durationSeconds / 60),
  };

  if (includeGeometry) {
    const routeGeometry = parseGeoJsonGeometry(route.geometry);

    if (routeGeometry.coordinates.length >= 2) {
      routingResponse.routeGeometry = routeGeometry;
    }
  }

  return routingResponse;
}

export function buildFallbackRoutingResponse(
  coordinates: Coordinates[],
  transport: RoutingTransport,
  fallbackReason: RoutingFallbackReason = "unknown"
): RoutingResponse {
  const validCoordinates = coordinates.filter(isValidCoordinates);

  if (validCoordinates.length < 2) {
    return buildInsufficientCoordinatesResponse(validCoordinates, transport);
  }

  const distanceKm = validCoordinates
    .slice(1)
    .reduce(
      (totalDistance, coordinate, index) =>
        totalDistance +
        calculateHaversineDistanceKm(validCoordinates[index], coordinate),
      0
    );
  const travelTimeMinutes = estimateFallbackTravelTimeMinutes(
    distanceKm,
    transport
  );
  const legDurationsSeconds = validCoordinates.slice(1).map((coordinate, index) => {
    const legDistanceKm = calculateHaversineDistanceKm(
      validCoordinates[index],
      coordinate
    );
    return estimateFallbackTravelTimeMinutes(legDistanceKm, transport) * 60;
  });

  return {
    distanceMeters: distanceKm * 1000,
    distanceKm,
    durationSeconds: travelTimeMinutes * 60,
    fallbackReason,
    legDurationsSeconds,
    provider: "fallback",
    routeGeometry: {
      coordinates: validCoordinates.map((coordinate) => ({
        lat: coordinate.latitude,
        lng: coordinate.longitude,
      })),
    },
    transport,
    travelTimeMinutes,
  };
}

export function buildRoutingMetadata(route: RoutingResponse): RoutingMetadata {
  return {
    ...(route.fallbackReason ? { fallbackReason: route.fallbackReason } : {}),
    geometryPointCount: route.routeGeometry?.coordinates.length ?? 0,
    provider: route.provider,
    transport: route.transport,
  };
}

export function getLegTransportMode(
  from: Coordinates,
  to: Coordinates,
  preferredTransport: RoutingTransport
): RoutingTransport {
  if (preferredTransport === "walking") return "walking";
  const distKm = calculateHaversineDistanceKm(from, to);
  return distKm <= WALKING_LEG_DISTANCE_THRESHOLD_KM ? "walking" : preferredTransport;
}

function buildInsufficientCoordinatesResponse(
  coordinates: Coordinates[],
  transport: RoutingTransport
): RoutingResponse {
  return {
    distanceKm: 0,
    distanceMeters: 0,
    durationSeconds: 0,
    fallbackReason: "insufficient_coordinates",
    provider: "fallback",
    routeGeometry: {
      coordinates: coordinates.map((coordinate) => ({
        lat: coordinate.latitude,
        lng: coordinate.longitude,
      })),
    },
    transport,
    travelTimeMinutes: 0,
  };
}

function parseOpenRouteServiceResponseBody(
  responseBody: string,
  statusCode: number
): unknown {
  try {
    return JSON.parse(responseBody) as unknown;
  } catch {
    throw new RouteProviderError(
      "OpenRouteService response was not valid JSON",
      "openrouteservice",
      "ors_invalid_response",
      statusCode,
      responseBody
    );
  }
}

function parseGeoJsonGeometry(value: unknown): RouteGeometry {
  if (!isRecord(value) || !Array.isArray(value.coordinates)) {
    return { coordinates: [] };
  }

  return {
    coordinates: value.coordinates.flatMap((coordinate): Coordinate[] => {
      if (!Array.isArray(coordinate) || coordinate.length < 2) {
        return [];
      }

      const lng = Number(coordinate[0]);
      const lat = Number(coordinate[1]);

      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return [];
      }

      return [{ lat, lng }];
    }),
  };
}

function getOpenRouteServiceSegments(value: unknown): {
  distance: number;
  duration: number;
  legDurationsSeconds: number[];
} {
  if (!Array.isArray(value) || value.length === 0) {
    return {
      distance: 0,
      duration: 0,
      legDurationsSeconds: [],
    };
  }

  return value.reduce(
    (summary, segment) => {
      if (!isRecord(segment)) {
        return summary;
      }

      const distance = Number(segment.distance);
      const duration = Number(segment.duration);
      const validDuration = Number.isFinite(duration) ? duration : 0;

      return {
        distance:
          summary.distance + (Number.isFinite(distance) ? distance : 0),
        duration: summary.duration + validDuration,
        legDurationsSeconds: [...summary.legDurationsSeconds, validDuration],
      };
    },
    { distance: 0, duration: 0, legDurationsSeconds: [] as number[] }
  );
}

function isValidCoordinates(coordinates: Coordinates): boolean {
  return (
    Number.isFinite(coordinates.latitude) &&
    Number.isFinite(coordinates.longitude) &&
    coordinates.latitude >= -90 &&
    coordinates.latitude <= 90 &&
    coordinates.longitude >= -180 &&
    coordinates.longitude <= 180
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getOpenRouteServiceProfile(transport: RoutingTransport): string {
  return transport === "walking" ? "foot-walking" : "driving-car";
}

function getOsrmProfileForTransport(transport: RoutingTransport): string {
  if (transport === "walking") {
    return process.env.OSRM_WALKING_PROFILE || "foot";
  }

  return process.env.OSRM_DRIVING_PROFILE || "driving";
}

function profileToTransport(profile: string | undefined): RoutingTransport {
  return profile === "walking" || profile === "foot" ? "walking" : "driving";
}

function estimateFallbackTravelTimeMinutes(
  distanceKm: number,
  transport: RoutingTransport
): number {
  return transport === "walking"
    ? estimateWalkingTimeMinutes(distanceKm)
    : estimateDrivingTimeMinutes(distanceKm);
}

function isPedestrianPlausible(route: RoutingResponse): boolean {
  if (route.durationSeconds <= 0 || route.distanceKm <= 0) {
    return true;
  }

  const speedKmH = route.distanceKm / (route.durationSeconds / 3600);
  return speedKmH <= maximumPedestrianSpeedKmH;
}

function warnProviderFallback(
  provider: RoutingProvider,
  transport: RoutingTransport,
  error: unknown
): void {
  const warningKey = `${provider}:${transport}`;

  if (warnedProviderFallbacks.has(warningKey)) {
    return;
  }

  warnedProviderFallbacks.add(warningKey);

  const message =
    error instanceof Error ? error.message : "Unknown route provider error";
  console.warn(
    `${provider} ${transport} routing unavailable; using next routing fallback. ${message}`
  );
}

function getOpenRouteServiceHttpFallbackReason(
  statusCode: number
): RoutingFallbackReason {
  if (statusCode === 400) {
    return "ors_400_invalid_coordinates";
  }

  if (statusCode === 401) {
    return "ors_401";
  }

  if (statusCode === 403) {
    return "ors_403";
  }

  if (statusCode === 429) {
    return "ors_429_rate_limited";
  }

  return "ors_http_error";
}

function toRouteProviderError(
  error: unknown,
  provider: RoutingProvider
): RouteProviderError {
  if (error instanceof RouteProviderError) {
    return error;
  }

  const message =
    error instanceof Error ? error.message : "Unknown route provider error";

  return new RouteProviderError(
    message,
    provider,
    provider === "openrouteservice"
      ? isAbortError(error)
        ? "request_aborted"
        : "ors_network_error"
      : "ors_http_error"
  );
}

function logOpenRouteServiceError(
  error: RouteProviderError,
  transport: RoutingTransport
): void {
  console.warn("OpenRouteService routing failed:", {
    fallbackReason: error.fallbackReason,
    responseBody: error.responseBody,
    statusCode: error.statusCode,
    transport,
  });
}

function isOriginalStopGeometry(
  routeGeometry: RouteGeometry,
  coordinates: Coordinates[]
): boolean {
  if (routeGeometry.coordinates.length !== coordinates.length) {
    return false;
  }

  return routeGeometry.coordinates.every((coordinate, index) =>
    areSameCoordinate(coordinate, coordinates[index])
  );
}

function areSameCoordinate(
  routeCoordinate: Coordinate,
  inputCoordinate: Coordinates
): boolean {
  return (
    Math.abs(routeCoordinate.lat - inputCoordinate.latitude) < 0.000001 &&
    Math.abs(routeCoordinate.lng - inputCoordinate.longitude) < 0.000001
  );
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException && error.name === "AbortError"
  );
}
