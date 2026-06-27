"use client";

import L, { type LatLngExpression } from "leaflet";
import { useEffect, useMemo, useRef } from "react";
import {
  LayersControl,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import type { ItineraryMapProps } from "@/components/ItineraryMap";
import type {
  ItineraryItem,
  RouteLeg,
  RouteGeometry,
  RoutingTransport,
} from "@/types/itinerary";
import type { TransportMode } from "@/types/preference";

type ItineraryMapStop = {
  id: number;
  order: number;
  name: string;
  category: string | null;
  visitDuration: number | null;
  timeWindow: string | null;
  imageUrl: string | null;
  position: [number, number];
};

const DEFAULT_ZOOM = 15;
const MAX_FIT_ZOOM = 16;
const TILE_LAYER_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_LAYER_ATTRIBUTION = "&copy; OpenStreetMap contributors";

function toTitleCase(value: string) {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function toFiniteCoordinate(value: string | number): number | null {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function isValidLatitude(value: number) {
  return value >= -90 && value <= 90;
}

function isValidLongitude(value: number) {
  return value >= -180 && value <= 180;
}

function getVisitDuration(item: ItineraryItem) {
  const duration = Number(item.attraction.estimated_visit_duration);
  return Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null;
}

function getTimeWindow(item: ItineraryItem): string | null {
  const start = item.plannedStartTime;
  const end = item.plannedEndTime;
  if (!start || !end || !start.includes(":") || !end.includes(":")) return null;
  return `${start} - ${end}`;
}

function buildStops(items: ItineraryItem[]): ItineraryMapStop[] {
  return items.flatMap((item, index) => {
    const latitude = toFiniteCoordinate(item.attraction.latitude);
    const longitude = toFiniteCoordinate(item.attraction.longitude);

    if (
      latitude === null ||
      longitude === null ||
      !isValidLatitude(latitude) ||
      !isValidLongitude(longitude) ||
      (latitude === 0 && longitude === 0)
    ) {
      return [];
    }

    const category = item.attraction.category.trim();

    return [
      {
        id: item.attraction.id,
        order: index + 1,
        name: item.attraction.name,
        category: category.length > 0 ? category : null,
        visitDuration: getVisitDuration(item),
        timeWindow: getTimeWindow(item),
        imageUrl: item.attraction.thumbnail_url ?? item.attraction.image_url ?? null,
        position: [latitude, longitude],
      },
    ];
  });
}

function buildRouteGeometryPositions(
  routeGeometry: RouteGeometry | undefined
): [number, number][] {
  if (!routeGeometry) {
    return [];
  }

  return routeGeometry.coordinates.flatMap((coordinate): [number, number][] => {
    const latitude = toFiniteCoordinate(coordinate.lat);
    const longitude = toFiniteCoordinate(coordinate.lng);

    if (
      latitude === null ||
      longitude === null ||
      !isValidLatitude(latitude) ||
      !isValidLongitude(longitude)
    ) {
      return [];
    }

    return [[latitude, longitude]];
  });
}

function createNumberedIcon(order: number) {
  return L.divIcon({
    className: "itinerary-numbered-marker",
    html: `<span>${order}</span>`,
    iconAnchor: [16, 32],
    iconSize: [32, 32],
    popupAnchor: [0, -30],
  });
}

function FitMapBounds({ positions }: { positions: LatLngExpression[] }) {
  const map = useMap();
  const positionsKey = useMemo(() => JSON.stringify(positions), [positions]);

  useEffect(() => {
    if (positions.length === 0) {
      return;
    }

    if (positions.length === 1) {
      map.setView(positions[0], DEFAULT_ZOOM, { animate: false });
      return;
    }

    const bounds = L.latLngBounds(positions);
    map.fitBounds(bounds, {
      animate: false,
      maxZoom: MAX_FIT_ZOOM,
      padding: [32, 32],
    });
  }, [map, positions, positionsKey]);

  return null;
}

function NumberedMarker({
  stop,
  isActive,
  onClick,
}: {
  stop: ItineraryMapStop;
  isActive: boolean;
  onClick: () => void;
}) {
  const icon = useMemo(() => createNumberedIcon(stop.order), [stop.order]);
  const markerRef = useRef<L.Marker | null>(null);
  const map = useMap();
  const hasMounted = useRef(false);

  useEffect(() => {
    const isFirstMount = !hasMounted.current;
    hasMounted.current = true;
    if (!isActive) return;
    markerRef.current?.openPopup();
    // Skip pan on initial mount — FitMapBounds handles the initial viewport.
    if (!isFirstMount) {
      map.panTo(stop.position, { animate: true, duration: 0.4 });
    }
  }, [isActive, map, stop.position]);

  return (
    <Marker
      ref={markerRef}
      icon={icon}
      position={stop.position}
      eventHandlers={{ click: onClick }}
    >
      <Popup>
        <div className="itinerary-map-popup">
          {stop.imageUrl ? (
            <img
              src={stop.imageUrl}
              alt={stop.name}
              className="itinerary-map-popup-image"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          ) : null}
          <strong>{stop.name}</strong>
          {stop.category ? (
            <span>{toTitleCase(stop.category)}</span>
          ) : null}
          {stop.timeWindow ? (
            <span>Visit: {stop.timeWindow}</span>
          ) : stop.visitDuration ? (
            <span>Visit: {stop.visitDuration} min</span>
          ) : null}
        </div>
      </Popup>
    </Marker>
  );
}

function getLegPathOptions(transport: RoutingTransport | TransportMode | undefined) {
  return {
    color: transport === "walking" ? "#0b7a75" : "#0f67b1",
    dashArray: transport === "walking" ? "2 10" : undefined,
    lineCap: "round" as const,
    opacity: 0.78,
    weight: 4,
  };
}

type LegPolyline = {
  key: string;
  transport: RoutingTransport;
  positions: [number, number][];
};

function buildLegPolylines(
  routeGeometry: RouteGeometry | undefined,
  legs: RouteLeg[] | undefined,
  fallbackTransport: TransportMode | undefined,
  shouldUseRouteGeometry: boolean,
  stopPositions: [number, number][]
): LegPolyline[] {
  const coords = routeGeometry?.coordinates ?? [];

  if (legs && legs.length > 0 && shouldUseRouteGeometry && coords.length >= 2) {
    return legs.map((leg, i) => {
      const start = leg.geometryStartOffset;
      const end =
        i + 1 < legs.length ? legs[i + 1].geometryStartOffset + 1 : coords.length;
      const slice = coords.slice(start, end);
      const positions: [number, number][] = slice.flatMap((c) => {
        const lat = toFiniteCoordinate(c.lat);
        const lng = toFiniteCoordinate(c.lng);
        if (
          lat === null ||
          lng === null ||
          !isValidLatitude(lat) ||
          !isValidLongitude(lng)
        ) {
          return [];
        }
        return [[lat, lng]] as [number, number][];
      });
      return {
        key: `leg-${leg.fromIndex}-${leg.toIndex}-${leg.transport}`,
        transport: leg.transport,
        positions,
      };
    });
  }

  // Fallback: single polyline
  const positions: [number, number][] =
    shouldUseRouteGeometry && coords.length >= 2
      ? buildRouteGeometryPositions(routeGeometry)
      : stopPositions;

  return [
    {
      key: "single",
      transport: fallbackTransport ?? "driving",
      positions,
    },
  ];
}

export function ItineraryMapClient({
  items,
  routing,
  routeGeometry,
  transportMode,
  activeStopIndex = 0,
  onStopClick,
}: ItineraryMapProps) {
  const stops = useMemo(() => buildStops(items), [items]);
  const stopPositions = useMemo(
    () => stops.map((stop) => stop.position),
    [stops]
  );
  const geometryPositions = useMemo(
    () => buildRouteGeometryPositions(routeGeometry),
    [routeGeometry]
  );
  const shouldUseRouteGeometry = routing
    ? routing.provider !== "fallback"
    : geometryPositions.length >= 2;
  const legPolylines = useMemo(
    () =>
      buildLegPolylines(
        routeGeometry,
        routing?.legs,
        transportMode,
        shouldUseRouteGeometry,
        stopPositions
      ),
    [routeGeometry, routing, transportMode, shouldUseRouteGeometry, stopPositions]
  );
  const boundsPositions = useMemo(
    () => [
      ...legPolylines.flatMap((l) => l.positions),
      ...stopPositions,
    ],
    [legPolylines, stopPositions]
  );
  const routeKey = useMemo(
    () =>
      [
        routing?.provider ?? "unknown",
        routing?.geometryPointCount ?? legPolylines.length,
        transportMode ?? "unknown",
      ].join(":"),
    [legPolylines.length, routing, transportMode]
  );

  if (stops.length === 0) {
    return null;
  }

  return (
    <div className="itinerary-map-card" aria-label="Generated itinerary map">
      <div className="itinerary-map-top">
        <div>
          <p className="attraction-category">Route map</p>
          <h3>Itinerary stops</h3>
        </div>
        <span className="rating-pill">{stops.length} stops</span>
      </div>

      <MapContainer
        center={stops[0].position}
        className="itinerary-map"
        scrollWheelZoom={false}
        zoom={DEFAULT_ZOOM}
      >
        <LayersControl position="topright">
          <LayersControl.BaseLayer checked name="OpenStreetMap">
            <TileLayer
              attribution={TILE_LAYER_ATTRIBUTION}
              url={TILE_LAYER_URL}
            />
          </LayersControl.BaseLayer>

          {process.env.NEXT_PUBLIC_TOMTOM_API_KEY ? (
            <LayersControl.Overlay name="Live traffic">
              <TileLayer
                attribution="Traffic &copy; TomTom"
                opacity={0.7}
                url={`https://api.tomtom.com/traffic/map/4/tile/flow/relative0/{z}/{x}/{y}.png?key=${process.env.NEXT_PUBLIC_TOMTOM_API_KEY}`}
              />
            </LayersControl.Overlay>
          ) : null}
        </LayersControl>
        <FitMapBounds positions={boundsPositions} />
        {legPolylines.map((leg) =>
          leg.positions.length > 1 ? (
            <Polyline
              key={`${routeKey}:${leg.key}`}
              pathOptions={getLegPathOptions(leg.transport)}
              positions={leg.positions}
            />
          ) : null
        )}
        {stops.map((stop, index) => (
          <NumberedMarker
            key={stop.id}
            stop={stop}
            isActive={index === activeStopIndex}
            onClick={() => onStopClick?.(index)}
          />
        ))}
      </MapContainer>
    </div>
  );
}
