"use client";

import dynamic from "next/dynamic";
import type { ItineraryItem } from "@/types/itinerary";

export type ItineraryMapProps = {
  items: ItineraryItem[];
};

const ItineraryMapClient = dynamic<ItineraryMapProps>(
  () =>
    import("@/components/ItineraryMapClient").then(
      (module) => module.ItineraryMapClient
    ),
  {
    ssr: false,
    loading: () => (
      <div className="itinerary-map-card" aria-label="Loading itinerary map">
        <div className="itinerary-map-top">
          <div>
            <p className="attraction-category">Route map</p>
            <h3>Itinerary stops</h3>
          </div>
        </div>
        <div className="itinerary-map itinerary-map-loading" />
      </div>
    ),
  }
);

export function ItineraryMap({ items }: ItineraryMapProps) {
  if (items.length === 0) {
    return null;
  }

  return <ItineraryMapClient items={items} />;
}
