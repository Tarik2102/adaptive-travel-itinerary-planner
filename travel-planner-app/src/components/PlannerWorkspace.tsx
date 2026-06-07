"use client";

import { useCallback, useRef, useState } from "react";
import { AttractionList } from "@/components/AttractionList";
import { ItineraryResult } from "@/components/ItineraryResult";
import { PreferenceForm } from "@/components/PreferenceForm";
import { TrafficSimulationPanel } from "@/components/TrafficSimulationPanel";
import type {
  GeneratedItinerary,
  ItineraryAdaptation,
  ItineraryApiResponse,
  ItineraryDayPlan,
  ItineraryPlan,
  ItinerarySuccessResponse,
} from "@/types/itinerary";
import type { PlannerPreferences } from "@/types/preference";

function buildDayPlan(
  dayNumber: number,
  result: ItinerarySuccessResponse,
  preferences: PlannerPreferences
): ItineraryDayPlan {
  return {
    dayNumber,
    itinerary: result.itinerary,
    adaptation: result.adaptation,
    selectedAttractionIds: result.selectedAttractionIds,
    hasFewerStopsThanRequested: result.itinerary.items.length < preferences.maxAttractions,
    generatedPreferences: { ...preferences, interests: [...preferences.interests] },
  };
}

export function PlannerWorkspace() {
  const [itineraryPlan, setItineraryPlan] = useState<ItineraryPlan | null>(null);
  const [currentPreferences, setCurrentPreferences] = useState<PlannerPreferences | null>(null);
  const [lastGeneratedPreferences, setLastGeneratedPreferences] =
    useState<PlannerPreferences | null>(null);
  const [activeDayIndex, setActiveDayIndex] = useState(0);
  const [isUpdatingDay, setIsUpdatingDay] = useState(false);
  const [updateDayProgress, setUpdateDayProgress] = useState<string | null>(null);
  const [updateDayError, setUpdateDayError] = useState<string | null>(null);
  const [loadPreferences, setLoadPreferences] = useState<{ prefs: PlannerPreferences } | null>(null);
  const updateAbortRef = useRef<AbortController | null>(null);
  const dayDrafts = useRef<Map<number, PlannerPreferences>>(new Map());
  const currentPreferencesRef = useRef<PlannerPreferences | null>(null);

  const handlePreferencesChanged = useCallback((preferences: PlannerPreferences) => {
    setCurrentPreferences(preferences);
    currentPreferencesRef.current = preferences;
  }, []);

  const handleItineraryGenerated = useCallback((plan: ItineraryPlan | null) => {
    setItineraryPlan(plan);
    if (plan === null) {
      setLastGeneratedPreferences(null);
      setActiveDayIndex(0);
      setLoadPreferences(null);
      dayDrafts.current.clear();
      updateAbortRef.current?.abort();
      setIsUpdatingDay(false);
      setUpdateDayProgress(null);
      setUpdateDayError(null);
    }
  }, []);

  const handleGenerationComplete = useCallback((preferences: PlannerPreferences) => {
    setLastGeneratedPreferences(preferences);
    setActiveDayIndex(0);
    dayDrafts.current.clear();
  }, []);

  const handleActiveDayChange = useCallback(
    (newIndex: number) => {
      // Save current form state as draft for the outgoing day
      const latestPrefs = currentPreferencesRef.current;
      if (latestPrefs && itineraryPlan?.days) {
        const outgoingDay = itineraryPlan.days[activeDayIndex];
        if (outgoingDay) {
          dayDrafts.current.set(outgoingDay.dayNumber, {
            ...latestPrefs,
            interests: [...latestPrefs.interests],
          });
        }
      }

      setActiveDayIndex(newIndex);

      // Load draft or committed preferences for the incoming day
      if (itineraryPlan?.days) {
        const incomingDay = itineraryPlan.days[newIndex];
        if (incomingDay) {
          const draft = dayDrafts.current.get(incomingDay.dayNumber);
          setLoadPreferences({ prefs: draft ?? incomingDay.generatedPreferences });
        }
      }
    },
    [activeDayIndex, itineraryPlan]
  );

  const handleUpdateDay = useCallback(
    async (dayNumber: number) => {
      const prefsToUse = currentPreferencesRef.current;
      if (!prefsToUse || !itineraryPlan?.days) return;

      updateAbortRef.current?.abort();
      const abortController = new AbortController();
      updateAbortRef.current = abortController;

      const otherDayIds = itineraryPlan.days
        .filter((d) => d.dayNumber !== dayNumber)
        .flatMap((d) => d.selectedAttractionIds);

      setIsUpdatingDay(true);
      setUpdateDayProgress(`Updating Day ${dayNumber}...`);
      setUpdateDayError(null);

      try {
        const response = await fetch("/api/itinerary", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            preferences: prefsToUse,
            excludeAttractionIds: otherDayIds,
          }),
          signal: abortController.signal,
        });

        const result = (await response.json()) as ItineraryApiResponse;

        if (abortController.signal.aborted) return;

        if (!response.ok || !result.success) {
          throw new Error(result.success ? "Failed to update day" : result.error);
        }

        const dayPlan = buildDayPlan(
          dayNumber,
          result as ItinerarySuccessResponse,
          prefsToUse
        );

        setItineraryPlan((prev) => {
          if (!prev?.days) return prev;
          return {
            ...prev,
            days: prev.days.map((d) => (d.dayNumber === dayNumber ? dayPlan : d)),
          };
        });

        // Committed — clear any unsaved draft for this day
        dayDrafts.current.delete(dayNumber);
      } catch (error) {
        if (abortController.signal.aborted) return;
        setUpdateDayError(
          error instanceof Error ? error.message : "Failed to update day"
        );
      } finally {
        if (!abortController.signal.aborted) {
          setIsUpdatingDay(false);
          setUpdateDayProgress(null);
          updateAbortRef.current = null;
        }
      }
    },
    [itineraryPlan]
  );

  const handleTrafficUpdate = useCallback(
    (itinerary: GeneratedItinerary, adaptation: ItineraryAdaptation) => {
      setItineraryPlan((prev) => (prev ? { ...prev, itinerary, adaptation } : null));
    },
    []
  );

  const isDriving = currentPreferences?.transportMode === "driving";
  const isMultiDayPlan = (itineraryPlan?.days?.length ?? 0) > 1;
  const visibleActiveDayIndex =
    isMultiDayPlan && itineraryPlan?.days
      ? Math.min(activeDayIndex, itineraryPlan.days.length - 1)
      : 0;
  const activeDayGeneratedPrefs =
    isMultiDayPlan && itineraryPlan?.days
      ? (itineraryPlan.days[visibleActiveDayIndex]?.generatedPreferences ?? null)
      : null;
  const hasPendingChanges =
    itineraryPlan !== null &&
    currentPreferences !== null &&
    (isMultiDayPlan
      ? activeDayGeneratedPrefs !== null &&
        JSON.stringify(currentPreferences) !== JSON.stringify(activeDayGeneratedPrefs)
      : lastGeneratedPreferences !== null &&
        JSON.stringify(currentPreferences) !== JSON.stringify(lastGeneratedPreferences));

  return (
    <section className="page-container planner-layout">
      <aside className="planner-form-column">
        <PreferenceForm
          hasPendingChanges={hasPendingChanges}
          isMultiDayPlan={isMultiDayPlan}
          loadPreferences={loadPreferences}
          onItineraryGenerated={handleItineraryGenerated}
          onGenerationComplete={handleGenerationComplete}
          onPreferencesChanged={handlePreferencesChanged}
        />

        {itineraryPlan && currentPreferences ? (
          isDriving ? (
            isMultiDayPlan ? (
              <div className="traffic-panel traffic-panel-disabled">
                <p className="traffic-panel-disabled-note">
                  Traffic simulation is available for single-day driving routes.
                </p>
              </div>
            ) : (
              <TrafficSimulationPanel
                itinerary={itineraryPlan.itinerary}
                preferences={currentPreferences}
                onItineraryUpdated={handleTrafficUpdate}
              />
            )
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
          days={itineraryPlan?.days}
          itinerary={itineraryPlan?.itinerary ?? null}
          activeDayIndex={activeDayIndex}
          onActiveDayChange={handleActiveDayChange}
          onUpdateDay={handleUpdateDay}
          isUpdatingDay={isUpdatingDay}
          updateDayProgress={updateDayProgress}
          updateDayError={updateDayError}
          hasPendingChanges={hasPendingChanges}
        />
        <AttractionList />
      </div>
    </section>
  );
}
