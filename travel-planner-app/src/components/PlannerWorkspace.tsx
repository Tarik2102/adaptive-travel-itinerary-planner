"use client";

import { useState } from "react";
import { AttractionList } from "@/components/AttractionList";
import { ItineraryResult } from "@/components/ItineraryResult";
import { PreferenceForm } from "@/components/PreferenceForm";
import type { ItineraryPlan } from "@/types/itinerary";

export function PlannerWorkspace() {
  const [itineraryPlan, setItineraryPlan] = useState<ItineraryPlan | null>(null);

  return (
    <section className="page-container planner-layout">
      <aside className="planner-form-column">
        <PreferenceForm onItineraryGenerated={setItineraryPlan} />
      </aside>

      <div className="planner-attractions-column">
        <ItineraryResult
          adaptation={itineraryPlan?.adaptation ?? null}
          itinerary={itineraryPlan?.itinerary ?? null}
        />
        <AttractionList />
      </div>
    </section>
  );
}
