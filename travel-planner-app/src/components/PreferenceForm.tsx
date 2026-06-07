"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ItineraryApiResponse,
  ItineraryDayPlan,
  ItineraryPlan,
  ItinerarySuccessResponse,
} from "@/types/itinerary";
import { TimePicker } from "@/components/TimePicker";
import {
  interestGroups,
  travelInterestOptions,
  type BudgetLevel,
  type PlannerPreferences,
  type TransportMode,
  type TravelInterest,
} from "@/types/preference";

type PreferenceFormProps = {
  hasPendingChanges: boolean;
  isMultiDayPlan: boolean;
  loadPreferences: { prefs: PlannerPreferences } | null;
  numberOfDays: number;
  onNumberOfDaysChange: (n: number) => Promise<void> | void;
  onItineraryGenerated: (itineraryPlan: ItineraryPlan | null) => void;
  onGenerationComplete: (preferences: PlannerPreferences) => void;
  onPreferencesChanged?: (preferences: PlannerPreferences) => void;
  onGeneratingChange?: (isGenerating: boolean, progress: string | null) => void;
};

const INTERNAL_MAX_STOPS = 12;
const INTERNAL_PACE = "moderate" as const;

const interestValidationMessage =
  "Please select at least one interest to generate your itinerary.";
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const tripDurationOptions = [1, 2, 3, 4, 5] as const;

function isValidPreferenceInput(preferences: PlannerPreferences) {
  if (
    !timePattern.test(preferences.startTime) ||
    !timePattern.test(preferences.endTime)
  ) {
    return false;
  }

  return (
    timeToMinutes(preferences.endTime) > timeToMinutes(preferences.startTime)
  );
}

function timeToMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function getResultSelectedAttractionIds(
  result: ItinerarySuccessResponse
): string[] {
  return (
    result.selectedAttractionIds ??
    result.itinerary.items.map((item) => String(item.attraction.id))
  );
}

function buildItineraryDayPlan(
  dayNumber: number,
  result: ItinerarySuccessResponse,
  preferences: PlannerPreferences
): ItineraryDayPlan {
  return {
    dayNumber,
    itinerary: result.itinerary,
    adaptation: result.adaptation,
    selectedAttractionIds: getResultSelectedAttractionIds(result),
    hasFewerStopsThanRequested: false,
    generatedPreferences: { ...preferences, interests: [...preferences.interests] },
  };
}

export function PreferenceForm({
  hasPendingChanges,
  isMultiDayPlan,
  loadPreferences,
  numberOfDays,
  onNumberOfDaysChange,
  onItineraryGenerated,
  onGenerationComplete,
  onPreferencesChanged,
  onGeneratingChange,
}: PreferenceFormProps) {
  const [interests, setInterests] = useState<TravelInterest[]>([]);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [budgetLevel, setBudgetLevel] = useState<BudgetLevel>("medium");
  const [transportMode, setTransportMode] = useState<TransportMode>("walking");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showInterestValidation, setShowInterestValidation] = useState(false);
  const [openInterestGroups, setOpenInterestGroups] = useState<string[]>([
    interestGroups[0].label,
  ]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastRequestKeyRef = useRef<string | null>(null);
  const activeRequestIdRef = useRef(0);
  const requestSequenceRef = useRef(0);
  const allInterestsSelected = interests.length === travelInterestOptions.length;
  const selectedInterestSummary = interests.join(", ");
  const interestValidationError =
    showInterestValidation && interests.length === 0
      ? interestValidationMessage
      : null;
  const preferences = useMemo<PlannerPreferences>(
    () => ({
      interests,
      startTime,
      endTime,
      budgetLevel,
      transportMode,
      preferredPace: INTERNAL_PACE,
      maxAttractions: INTERNAL_MAX_STOPS,
    }),
    [budgetLevel, endTime, interests, startTime, transportMode]
  );

  function handlePreferencesChanged() {
    setError(null);
    lastRequestKeyRef.current = null;
  }

  function toggleInterest(interest: TravelInterest) {
    const nextInterests = interests.includes(interest)
      ? interests.filter((item) => item !== interest)
      : [...interests, interest];

    setInterests(nextInterests);
    handlePreferencesChanged();
  }

  function toggleInterestGroup(groupLabel: string) {
    setOpenInterestGroups((currentGroups) =>
      currentGroups.includes(groupLabel)
        ? currentGroups.filter((label) => label !== groupLabel)
        : [...currentGroups, groupLabel]
    );
  }

  function getSelectedGroupCount(groupInterests: readonly TravelInterest[]) {
    return groupInterests.filter((interest) => interests.includes(interest))
      .length;
  }

  function handleInterestBulkToggle() {
    const nextInterests = allInterestsSelected ? [] : [...travelInterestOptions];

    setInterests(nextInterests);
    handlePreferencesChanged();
    setShowInterestValidation(false);
  }

  const requestItinerary = useCallback(
    async (nextPreferences: PlannerPreferences, overrideNumberOfDays?: number) => {
      const requestedNumberOfDays = overrideNumberOfDays ?? numberOfDays;

      if (nextPreferences.interests.length === 0) {
        setShowInterestValidation(true);
        setError(null);
        setGenerationProgress(null);
        onItineraryGenerated(null);

        return;
      }

      if (!isValidPreferenceInput(nextPreferences)) {
        setError("Please enter a valid time window before generating.");
        setGenerationProgress(null);
        return;
      }

      const requestKey = JSON.stringify({
        preferences: nextPreferences,
        numberOfDays: requestedNumberOfDays,
      });

      if (lastRequestKeyRef.current === requestKey) return;

      abortControllerRef.current?.abort();
      const abortController = new AbortController();
      const requestId = requestSequenceRef.current + 1;

      requestSequenceRef.current = requestId;
      activeRequestIdRef.current = requestId;
      abortControllerRef.current = abortController;
      lastRequestKeyRef.current = requestKey;

      setIsSubmitting(true);
      setError(null);
      setGenerationProgress(
        requestedNumberOfDays > 1
          ? `Generating Day 1 of ${requestedNumberOfDays}...`
          : null
      );
      setShowInterestValidation(false);
      onItineraryGenerated(null);

      try {
        const days: ItineraryDayPlan[] = [];
        const excludedAttractionIds = new Set<string>();

        for (
          let dayNumber = 1;
          dayNumber <= requestedNumberOfDays;
          dayNumber += 1
        ) {
          if (requestedNumberOfDays > 1) {
            setGenerationProgress(
              `Generating Day ${dayNumber} of ${requestedNumberOfDays}...`
            );
          }

          const response = await fetch("/api/itinerary", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              preferences: nextPreferences,
              excludeAttractionIds: Array.from(excludedAttractionIds),
            }),
            signal: abortController.signal,
          });

          const result = (await response.json()) as ItineraryApiResponse;

          if (!response.ok || !result.success) {
            throw new Error(
              result.success ? "Failed to generate itinerary" : result.error
            );
          }

          if (
            abortController.signal.aborted ||
            activeRequestIdRef.current !== requestId
          ) {
            return;
          }

          const dayPlan = buildItineraryDayPlan(
            dayNumber,
            result as ItinerarySuccessResponse,
            nextPreferences
          );

          days.push(dayPlan);

          dayPlan.selectedAttractionIds.forEach((id) =>
            excludedAttractionIds.add(id)
          );
        }

        const firstDay = days[0];

        if (!firstDay) {
          throw new Error("Failed to generate itinerary");
        }

        onItineraryGenerated({
          itinerary: firstDay.itinerary,
          adaptation: firstDay.adaptation,
          selectedAttractionIds: firstDay.selectedAttractionIds,
          ...(requestedNumberOfDays > 1 ? { days } : {}),
        });
        onGenerationComplete(nextPreferences);
      } catch (requestError) {
        if (
          abortController.signal.aborted ||
          activeRequestIdRef.current !== requestId
        ) {
          return;
        }

        lastRequestKeyRef.current = null;
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Failed to generate itinerary"
        );
      } finally {
        if (
          abortControllerRef.current === abortController &&
          activeRequestIdRef.current === requestId
        ) {
          abortControllerRef.current = null;
          setIsSubmitting(false);
          setGenerationProgress(null);
        }
      }
    },
    [numberOfDays, onGenerationComplete, onItineraryGenerated]
  );

  useEffect(() => {
    if (!loadPreferences) return;
    const { prefs } = loadPreferences;
    setInterests(prefs.interests.slice() as TravelInterest[]);
    setStartTime(prefs.startTime);
    setEndTime(prefs.endTime);
    setBudgetLevel(prefs.budgetLevel);
    setTransportMode(prefs.transportMode);
    setShowInterestValidation(false);
    lastRequestKeyRef.current = null;
  }, [loadPreferences]);

  useEffect(() => {
    onPreferencesChanged?.(preferences);
  }, [preferences, onPreferencesChanged]);

  useEffect(() => {
    onGeneratingChange?.(isSubmitting, generationProgress);
  }, [isSubmitting, generationProgress, onGeneratingChange]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    lastRequestKeyRef.current = null;

    if (preferences.interests.length === 0) {
      setShowInterestValidation(true);
      setError(null);
      setGenerationProgress(null);
      onItineraryGenerated(null);
      return;
    }

    await requestItinerary(preferences);
  }

  function handleReset() {
    setInterests([]);
    setStartTime("09:00");
    setEndTime("17:00");
    setBudgetLevel("medium");
    setTransportMode("walking");
    setOpenInterestGroups([interestGroups[0].label]);
    setError(null);
    setGenerationProgress(null);
    setShowInterestValidation(false);
    lastRequestKeyRef.current = null;
    requestSequenceRef.current += 1;
    activeRequestIdRef.current = requestSequenceRef.current;
    abortControllerRef.current?.abort();
    void onNumberOfDaysChange(1);
    onItineraryGenerated(null);
  }

  const submitButtonLabel =
    generationProgress ?? (isSubmitting ? "Generating..." : "Generate itinerary");

  return (
    <form onSubmit={handleSubmit} className="preference-form" aria-busy={isSubmitting}>
      <div className="form-header">
        <p className="eyebrow">Trip preferences</p>
        <h2>Plan your visit</h2>
        <p>
          Tune the form around your available time, budget, and Sarajevo
          interests.
        </p>
      </div>

      <fieldset className="form-fieldset">
        <legend>Interests</legend>

        <div className="interest-toolbar">
          <button
            type="button"
            className="button button-secondary interest-bulk-button"
            onClick={handleInterestBulkToggle}
            disabled={isSubmitting}
          >
            {allInterestsSelected ? "Clear all" : "Select all"}
          </button>
        </div>

        <div className="interest-groups">
          {interestGroups.map((group) => {
            const isOpen = openInterestGroups.includes(group.label);
            const selectedCount = getSelectedGroupCount(group.interests);
            const groupPanelId = `interest-group-${group.label
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")}`;

            return (
              <section className="interest-group" key={group.label}>
                <button
                  type="button"
                  className="interest-group-toggle"
                  aria-expanded={isOpen}
                  aria-controls={groupPanelId}
                  onClick={() => toggleInterestGroup(group.label)}
                >
                  <span className="interest-group-title">{group.label}</span>
                  <span className="interest-group-meta">
                    <span className="interest-group-count">
                      {selectedCount} selected
                    </span>
                    <span className="interest-group-indicator" aria-hidden="true">
                      {isOpen ? "-" : "+"}
                    </span>
                  </span>
                </button>

                {isOpen ? (
                  <div className="interest-group-panel" id={groupPanelId}>
                    <div className="interest-chip-grid">
                      {group.interests.map((interest) => {
                        const isSelected = interests.includes(interest);

                        return (
                          <button
                            type="button"
                            className={`interest-chip${
                              isSelected ? " interest-chip-selected" : ""
                            }`}
                            aria-pressed={isSelected}
                            key={interest}
                            onClick={() => toggleInterest(interest)}
                          >
                            {interest}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>

        {interests.length > 0 ? (
          <p className="selected-interest-summary">
            Selected: {selectedInterestSummary}
          </p>
        ) : null}

        {interestValidationError ? (
          <p className="field-validation" role="alert">
            {interestValidationError}
          </p>
        ) : null}
      </fieldset>

      <div className="form-grid">
        <div className="field" role="group" aria-label="Start time">
          <span id="start-time-label">Start time</span>
          <TimePicker
            value={startTime}
            onChange={(v) => {
              setStartTime(v);
              handlePreferencesChanged();
            }}
            disabled={isSubmitting}
          />
        </div>

        <div className="field" role="group" aria-label="End time">
          <span id="end-time-label">End time</span>
          <TimePicker
            value={endTime}
            onChange={(v) => {
              setEndTime(v);
              handlePreferencesChanged();
            }}
            disabled={isSubmitting}
          />
        </div>

        <div
          className="field trip-duration-field"
          role="radiogroup"
          aria-label="Trip duration, maximum 5 days"
        >
          <span>Trip duration (max 5 days)</span>
          <div className="trip-duration-control">
            {tripDurationOptions.map((duration) => (
              <button
                type="button"
                className={`trip-duration-option${
                  numberOfDays === duration
                    ? " trip-duration-option-active"
                    : ""
                }`}
                role="radio"
                aria-checked={numberOfDays === duration}
                key={duration}
                onClick={() => void onNumberOfDaysChange(duration)}
                disabled={isSubmitting}
              >
                {duration}
              </button>
            ))}
          </div>
        </div>

        <label className="field">
          <span>Budget level</span>
          <select
            value={budgetLevel}
            onChange={(event) => {
              setBudgetLevel(event.target.value as BudgetLevel);
              handlePreferencesChanged();
            }}
          >
            <option value="free">Free</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>

        <label className="field">
          <span>Transport</span>
          <select
            value={transportMode}
            onChange={(event) => {
              setTransportMode(event.target.value as TransportMode);
              handlePreferencesChanged();
            }}
          >
            <option value="walking">Walking</option>
            <option value="driving">Driving</option>
          </select>
        </label>
      </div>

      <div className="form-summary">
        <span>Window</span>
        <strong>
          {startTime} - {endTime}
        </strong>
        <span>{interests.length || "No"} interests selected</span>
        <span>
          {numberOfDays} day{numberOfDays === 1 ? "" : "s"}
        </span>
      </div>

      {error ? (
        <div className="form-error" role="alert">
          <strong>Generation failed</strong>
          <p>{error}</p>
        </div>
      ) : null}

      <div className="form-actions">
        <button
          type="submit"
          className="button button-primary"
          disabled={isSubmitting}
          aria-label="Generate itinerary"
        >
          {submitButtonLabel}
          {hasPendingChanges && !isSubmitting && !isMultiDayPlan ? (
            <span className="pending-dot" aria-hidden="true" />
          ) : null}
        </button>

        {isMultiDayPlan ? (
          <button
            type="button"
            className="button button-outline"
            onClick={() => {
              lastRequestKeyRef.current = null;
              void requestItinerary(preferences);
            }}
            disabled={isSubmitting}
            aria-label="Regenerate all days with current preferences"
          >
            Regenerate all days
          </button>
        ) : null}

        <button
          type="button"
          className="button button-secondary"
          onClick={handleReset}
          disabled={isSubmitting}
        >
          Reset
        </button>
      </div>
    </form>
  );
}
