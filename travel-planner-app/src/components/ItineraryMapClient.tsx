"use client";

import L, { type LatLngExpression } from "leaflet";
import { useEffect, useMemo } from "react";
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import type { ItineraryMapProps } from "@/components/ItineraryMap";
import type { ItineraryItem } from "@/types/itinerary";

type ItineraryMapStop = {
  id: number;
  order: number;
  name: string;
  category: string | null;
  visitDuration: number | null;
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
        position: [latitude, longitude],
      },
    ];
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

function NumberedMarker({ stop }: { stop: ItineraryMapStop }) {
  const icon = useMemo(() => createNumberedIcon(stop.order), [stop.order]);

  return (
    <Marker icon={icon} position={stop.position}>
      <Popup>
        <div className="itinerary-map-popup">
          <strong>
            Stop {stop.order}: {stop.name}
          </strong>
          <span>Order: {stop.order}</span>
          {stop.category ? (
            <span>Category: {toTitleCase(stop.category)}</span>
          ) : null}
          {stop.visitDuration ? (
            <span>Visit: {stop.visitDuration} min</span>
          ) : null}
        </div>
      </Popup>
    </Marker>
  );
}

export function ItineraryMapClient({ items }: ItineraryMapProps) {
  const stops = useMemo(() => buildStops(items), [items]);
  const routePositions = useMemo(
    () => stops.map((stop) => stop.position),
    [stops]
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
        <TileLayer
          attribution={TILE_LAYER_ATTRIBUTION}
          url={TILE_LAYER_URL}
        />
        <FitMapBounds positions={routePositions} />
        {routePositions.length > 1 ? (
          <Polyline
            pathOptions={{
              color: "#0f67b1",
              opacity: 0.78,
              weight: 4,
            }}
            positions={routePositions}
          />
        ) : null}
        {stops.map((stop) => (
          <NumberedMarker key={stop.id} stop={stop} />
        ))}
      </MapContainer>
    </div>
  );
}
