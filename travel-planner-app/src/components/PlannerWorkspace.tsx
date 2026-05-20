"use client";

import { useState } from "react";
import { AttractionList } from "@/components/AttractionList";
import { ItineraryResult } from "@/components/ItineraryResult";
import { PreferenceForm } from "@/components/PreferenceForm";
import type { GeneratedItinerary } from "@/types/itinerary";

export function PlannerWorkspace() {
  const [itinerary, setItinerary] = useState<GeneratedItinerary | null>(null);

  return (
    <section className="page-container planner-layout">
      <aside className="planner-form-column">
        <PreferenceForm onItineraryGenerated={setItinerary} />
      </aside>

      <div className="planner-attractions-column">
        <ItineraryResult itinerary={itinerary} />
        <AttractionList />
      </div>
    </section>
  );
}
