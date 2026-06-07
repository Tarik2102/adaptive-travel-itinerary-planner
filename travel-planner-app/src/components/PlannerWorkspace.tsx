"use client";

import { useCallback, useState } from "react";
import { AttractionList } from "@/components/AttractionList";
import { ItineraryResult } from "@/components/ItineraryResult";
import { PreferenceForm } from "@/components/PreferenceForm";
import { TrafficSimulationPanel } from "@/components/TrafficSimulationPanel";
import type {
  GeneratedItinerary,
  ItineraryAdaptation,
  ItineraryPlan,
} from "@/types/itinerary";
import type { PlannerPreferences } from "@/types/preference";

export function PlannerWorkspace() {
  const [itineraryPlan, setItineraryPlan] = useState<ItineraryPlan | null>(
    null
  );
  const [currentPreferences, setCurrentPreferences] =
    useState<PlannerPreferences | null>(null);

  const handlePreferencesChanged = useCallback(
    (preferences: PlannerPreferences) => {
      setCurrentPreferences(preferences);
    },
    []
  );

  const handleTrafficUpdate = useCallback(
    (itinerary: GeneratedItinerary, adaptation: ItineraryAdaptation) => {
      setItineraryPlan({ itinerary, adaptation });
    },
    []
  );

  const isDriving = currentPreferences?.transportMode === "driving";

  return (
    <section className="page-container planner-layout">
      <aside className="planner-form-column">
        <PreferenceForm
          onItineraryGenerated={setItineraryPlan}
          onPreferencesChanged={handlePreferencesChanged}
        />

        {itineraryPlan && currentPreferences ? (
          isDriving ? (
            <TrafficSimulationPanel
              itinerary={itineraryPlan.itinerary}
              preferences={currentPreferences}
              onItineraryUpdated={handleTrafficUpdate}
            />
          ) : (
            <div className="traffic-panel traffic-panel-disabled">
              <p className="traffic-panel-disabled-note">
                Traffic simulation is available only for driving routes.
              </p>
            </div>
          )
        ) : null}
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
