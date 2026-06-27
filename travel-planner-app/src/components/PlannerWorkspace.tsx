"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

const AUTO_UPDATE_DEBOUNCE_MS = 1200;
const NAVBAR_HEIGHT = 96;

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
    hasFewerStopsThanRequested: false,
    generatedPreferences: { ...preferences, interests: [...preferences.interests] },
  };
}

export function PlannerWorkspace() {
  const [itineraryPlan, setItineraryPlan] = useState<ItineraryPlan | null>(null);
  const [currentPreferences, setCurrentPreferences] = useState<PlannerPreferences | null>(null);
  const [lastGeneratedPreferences, setLastGeneratedPreferences] =
    useState<PlannerPreferences | null>(null);
  const [activeDayIndex, setActiveDayIndex] = useState(0);
  const [expandedDayIndex, setExpandedDayIndex] = useState<number | null>(null);
  const [numberOfDays, setNumberOfDays] = useState(1);
  const [isUpdatingDay, setIsUpdatingDay] = useState(false);
  const [isExtendingDays, setIsExtendingDays] = useState(false);
  const [updateDayProgress, setUpdateDayProgress] = useState<string | null>(null);
  const [updateDayError, setUpdateDayError] = useState<string | null>(null);
  const [loadPreferences, setLoadPreferences] = useState<{ prefs: PlannerPreferences } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<string | null>(null);

  const updateAbortRef = useRef<AbortController | null>(null);
  const dayDrafts = useRef<Map<number, PlannerPreferences>>(new Map());
  const currentPreferencesRef = useRef<PlannerPreferences | null>(null);
  const autoUpdateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  // Keep scroll functions fresh without adding them to useCallback deps
  const scrollToResultsRef = useRef<() => void>(() => {});
  const scrollToDayCardRef = useRef<(dayNumber: number) => void>(() => {});

  function scrollToResults() {
    const el = resultsRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // Already visible near the top of the viewport — skip
    if (rect.top >= NAVBAR_HEIGHT && rect.top <= window.innerHeight * 0.4) return;
    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const top = rect.top + window.scrollY - NAVBAR_HEIGHT;
    window.scrollTo({ top: Math.max(0, top), behavior: prefersReducedMotion ? "auto" : "smooth" });
  }
  scrollToResultsRef.current = scrollToResults;

  function scrollToDayCard(dayNumber: number) {
    const el = document.querySelector<HTMLElement>(`[data-day-number="${dayNumber}"]`);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // Card is already visible in the upper half of the viewport — skip
    if (rect.top >= NAVBAR_HEIGHT && rect.top <= window.innerHeight * 0.5) return;
    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const top = rect.top + window.scrollY - NAVBAR_HEIGHT - 8;
    window.scrollTo({ top: Math.max(0, top), behavior: prefersReducedMotion ? "auto" : "smooth" });
  }
  scrollToDayCardRef.current = scrollToDayCard;

  const isMultiDayPlan = (itineraryPlan?.days?.length ?? 0) > 1;
  const visibleActiveDayIndex =
    isMultiDayPlan && itineraryPlan?.days
      ? Math.min(activeDayIndex, itineraryPlan.days.length - 1)
      : 0;
  const activeDayNumber =
    isMultiDayPlan && itineraryPlan?.days
      ? (itineraryPlan.days[visibleActiveDayIndex]?.dayNumber ?? null)
      : null;
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

  const handlePreferencesChanged = useCallback((preferences: PlannerPreferences) => {
    setCurrentPreferences(preferences);
    currentPreferencesRef.current = preferences;
  }, []);

  const handleGeneratingChange = useCallback(
    (generating: boolean, progress: string | null) => {
      setIsGenerating(generating);
      setGenerationProgress(progress);
      if (generating) scrollToResultsRef.current();
    },
    []
  );

  const handleItineraryGenerated = useCallback((plan: ItineraryPlan | null) => {
    setItineraryPlan(plan);
    if (plan === null) {
      setLastGeneratedPreferences(null);
      setActiveDayIndex(0);
      setExpandedDayIndex(null);
      setLoadPreferences(null);
      dayDrafts.current.clear();
      updateAbortRef.current?.abort();
      setIsUpdatingDay(false);
      setIsExtendingDays(false);
      setUpdateDayProgress(null);
      setUpdateDayError(null);
      if (autoUpdateTimerRef.current) {
        clearTimeout(autoUpdateTimerRef.current);
        autoUpdateTimerRef.current = null;
      }
    }
  }, []);

  const handleGenerationComplete = useCallback((preferences: PlannerPreferences) => {
    setLastGeneratedPreferences(preferences);
    setActiveDayIndex(0);
    setExpandedDayIndex(0);
    dayDrafts.current.clear();
    // Scroll to results after React commits the new plan
    setTimeout(() => scrollToResultsRef.current(), 50);
  }, []);

  const handleDayCardClick = useCallback(
    (clickedIndex: number) => {
      if (clickedIndex === expandedDayIndex) {
        // Collapse the open card; keep it as the active day
        setExpandedDayIndex(null);
        return;
      }

      // Switching to a different day: save draft for outgoing, load prefs for incoming
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

      setActiveDayIndex(clickedIndex);
      setExpandedDayIndex(clickedIndex);

      if (itineraryPlan?.days) {
        const incomingDay = itineraryPlan.days[clickedIndex];
        if (incomingDay) {
          const draft = dayDrafts.current.get(incomingDay.dayNumber);
          setLoadPreferences({ prefs: draft ?? incomingDay.generatedPreferences });
        }
      }
    },
    [expandedDayIndex, activeDayIndex, itineraryPlan]
  );

  const handleUpdateDay = useCallback(
    async (dayNumber: number) => {
      const prefsToUse = currentPreferencesRef.current;
      if (!prefsToUse || !itineraryPlan?.days) return;

      updateAbortRef.current?.abort();
      const abortController = new AbortController();
      updateAbortRef.current = abortController;

      const dayIndex = itineraryPlan.days.findIndex((d) => d.dayNumber === dayNumber);
      const otherDayIds = itineraryPlan.days
        .filter((d) => d.dayNumber !== dayNumber)
        .flatMap((d) => d.selectedAttractionIds);

      setIsUpdatingDay(true);
      setUpdateDayProgress(`Updating Day ${dayNumber}...`);
      setUpdateDayError(null);
      scrollToDayCardRef.current(dayNumber);

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

        dayDrafts.current.delete(dayNumber);
        if (dayIndex >= 0) setExpandedDayIndex(dayIndex);
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

  // Auto-update active day after debounce when preferences change in multi-day mode
  useEffect(() => {
    if (!isMultiDayPlan || !itineraryPlan?.days || !currentPreferences) return;

    const activeDay = itineraryPlan.days[visibleActiveDayIndex];
    if (!activeDay) return;

    const hasChange =
      JSON.stringify(currentPreferences) !==
      JSON.stringify(activeDay.generatedPreferences);

    if (!hasChange) {
      if (autoUpdateTimerRef.current) {
        clearTimeout(autoUpdateTimerRef.current);
        autoUpdateTimerRef.current = null;
      }
      return;
    }

    if (autoUpdateTimerRef.current) clearTimeout(autoUpdateTimerRef.current);

    autoUpdateTimerRef.current = setTimeout(() => {
      autoUpdateTimerRef.current = null;
      void handleUpdateDay(activeDay.dayNumber);
    }, AUTO_UPDATE_DEBOUNCE_MS);

    return () => {
      if (autoUpdateTimerRef.current) {
        clearTimeout(autoUpdateTimerRef.current);
        autoUpdateTimerRef.current = null;
      }
    };
  }, [currentPreferences, isMultiDayPlan, itineraryPlan, visibleActiveDayIndex, handleUpdateDay]);

  const generateAdditionalDays = useCallback(
    async (startDay: number, endDay: number) => {
      const prefsToUse = currentPreferencesRef.current;
      if (!prefsToUse || !itineraryPlan?.days) return;

      updateAbortRef.current?.abort();
      const abortController = new AbortController();
      updateAbortRef.current = abortController;

      const excludedIds = new Set(
        itineraryPlan.days.flatMap((d) => d.selectedAttractionIds)
      );

      setIsUpdatingDay(true);
      setIsExtendingDays(true);
      setUpdateDayError(null);

      const newDays: ItineraryDayPlan[] = [];

      try {
        for (let dayNumber = startDay; dayNumber <= endDay; dayNumber++) {
          if (abortController.signal.aborted) return;

          setUpdateDayProgress(`Generating Day ${dayNumber}...`);

          const response = await fetch("/api/itinerary", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              preferences: prefsToUse,
              excludeAttractionIds: Array.from(excludedIds),
            }),
            signal: abortController.signal,
          });

          const result = (await response.json()) as ItineraryApiResponse;

          if (abortController.signal.aborted) return;

          if (!response.ok || !result.success) {
            throw new Error(result.success ? "Failed to generate day" : result.error);
          }

          const dayPlan = buildDayPlan(
            dayNumber,
            result as ItinerarySuccessResponse,
            prefsToUse
          );
          newDays.push(dayPlan);
          dayPlan.selectedAttractionIds.forEach((id) => excludedIds.add(id));
        }

        if (!abortController.signal.aborted && newDays.length > 0) {
          setItineraryPlan((prev) => {
            if (!prev?.days) return prev;
            return { ...prev, days: [...prev.days, ...newDays] };
          });
        }
      } catch (error) {
        if (abortController.signal.aborted) return;
        setUpdateDayError(
          error instanceof Error ? error.message : "Failed to generate day"
        );
      } finally {
        if (!abortController.signal.aborted) {
          setIsUpdatingDay(false);
          setIsExtendingDays(false);
          setUpdateDayProgress(null);
          updateAbortRef.current = null;
        }
      }
    },
    [itineraryPlan]
  );

  const handleTripDurationChange = useCallback(
    async (newCount: number) => {
      setNumberOfDays(newCount);

      if (!itineraryPlan?.days || itineraryPlan.days.length === 0) return;

      const currentDayCount = itineraryPlan.days.length;

      if (newCount < currentDayCount) {
        const newDays = itineraryPlan.days.slice(0, newCount);
        setItineraryPlan((prev) => {
          if (!prev?.days) return prev;
          return {
            ...prev,
            days: newDays,
            itinerary: newDays[0]?.itinerary ?? prev.itinerary,
            adaptation: newDays[0]?.adaptation ?? prev.adaptation,
          };
        });
        setActiveDayIndex((prev) => Math.min(prev, newCount - 1));
        setExpandedDayIndex((prev) => (prev !== null && prev >= newCount ? newCount - 1 : prev));
        dayDrafts.current.clear();
      } else if (newCount > currentDayCount) {
        await generateAdditionalDays(currentDayCount + 1, newCount);
      }
    },
    [itineraryPlan, generateAdditionalDays]
  );

  const handleTrafficUpdate = useCallback(
    (itinerary: GeneratedItinerary, adaptation: ItineraryAdaptation) => {
      setItineraryPlan((prev) => (prev ? { ...prev, itinerary, adaptation } : null));
    },
    []
  );

  const isDriving = currentPreferences?.transportMode === "driving";

  return (
    <section className="page-container planner-layout">
      <aside className="planner-form-column">
        <PreferenceForm
          activeDayNumber={activeDayNumber}
          hasPendingChanges={hasPendingChanges}
          isMultiDayPlan={isMultiDayPlan}
          loadPreferences={loadPreferences}
          numberOfDays={numberOfDays}
          onNumberOfDaysChange={handleTripDurationChange}
          onItineraryGenerated={handleItineraryGenerated}
          onGenerationComplete={handleGenerationComplete}
          onPreferencesChanged={handlePreferencesChanged}
          onGeneratingChange={handleGeneratingChange}
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

      <div className="planner-attractions-column" ref={resultsRef}>
        <ItineraryResult
          adaptation={itineraryPlan?.adaptation ?? null}
          days={itineraryPlan?.days}
          itinerary={itineraryPlan?.itinerary ?? null}
          activeDayIndex={activeDayIndex}
          expandedDayIndex={expandedDayIndex}
          onDayCardClick={handleDayCardClick}
          isUpdatingDay={isUpdatingDay}
          isExtendingDays={isExtendingDays}
          updateDayProgress={updateDayProgress}
          updateDayError={updateDayError}
          isGenerating={isGenerating}
          generationProgress={generationProgress}
        />

        {/* Hide Sarajevo Highlights once a plan is generated */}
        {!itineraryPlan ? <AttractionList /> : null}
      </div>
    </section>
  );
}
