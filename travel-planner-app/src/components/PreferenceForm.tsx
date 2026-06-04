"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ItineraryApiResponse, ItineraryPlan } from "@/types/itinerary";
import {
  interestGroups,
  travelInterestOptions,
  type BudgetLevel,
  type PlannerPreferences,
  type PreferredPace,
  type TransportMode,
  type TravelInterest,
} from "@/types/preference";

type PreferenceFormProps = {
  onItineraryGenerated: (itineraryPlan: ItineraryPlan | null) => void;
};

const interestValidationMessage =
  "Please select at least one interest to generate your itinerary.";
const autoRegenerationDelayMs = 1000;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

type SubmissionMode = "manual" | "auto";

function isValidPreferenceInput(preferences: PlannerPreferences) {
  if (
    !timePattern.test(preferences.startTime) ||
    !timePattern.test(preferences.endTime)
  ) {
    return false;
  }

  return (
    timeToMinutes(preferences.endTime) >
    timeToMinutes(preferences.startTime)
  );
}

function timeToMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

export function PreferenceForm({ onItineraryGenerated }: PreferenceFormProps) {
  const [interests, setInterests] = useState<TravelInterest[]>([]);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [budgetLevel, setBudgetLevel] = useState<BudgetLevel>("medium");
  const [transportMode, setTransportMode] = useState<TransportMode>("walking");
  const [preferredPace, setPreferredPace] = useState<PreferredPace>("moderate");
  const [maxAttractions, setMaxAttractions] = useState(5);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionMode, setSubmissionMode] =
    useState<SubmissionMode>("manual");
  const [error, setError] = useState<string | null>(null);
  const [showInterestValidation, setShowInterestValidation] = useState(false);
  const [hasGeneratedItinerary, setHasGeneratedItinerary] = useState(false);
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
      preferredPace,
      maxAttractions,
    }),
    [
      budgetLevel,
      endTime,
      interests,
      maxAttractions,
      preferredPace,
      startTime,
      transportMode,
    ]
  );
  const preferenceKey = useMemo(
    () => JSON.stringify(preferences),
    [preferences]
  );

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

  function handlePreferencesChanged() {
    if (!hasGeneratedItinerary) {
      return;
    }

    abortControllerRef.current?.abort();
    requestSequenceRef.current += 1;
    activeRequestIdRef.current = requestSequenceRef.current;
    lastRequestKeyRef.current = null;
    setError(null);
    setIsSubmitting(false);
    onItineraryGenerated(null);
  }

  const requestItinerary = useCallback(
    async (nextPreferences: PlannerPreferences, mode: SubmissionMode) => {
      if (nextPreferences.interests.length === 0) {
        if (mode === "manual") {
          setShowInterestValidation(true);
          setError(null);
          onItineraryGenerated(null);
          setHasGeneratedItinerary(false);
        }

        return;
      }

      if (!isValidPreferenceInput(nextPreferences)) {
        if (mode === "manual") {
          setError("Please enter a valid time window before generating.");
        }

        return;
      }

      const requestKey = JSON.stringify(nextPreferences);

      if (mode === "auto" && lastRequestKeyRef.current === requestKey) {
        return;
      }

      abortControllerRef.current?.abort();
      const abortController = new AbortController();
      const requestId = requestSequenceRef.current + 1;

      requestSequenceRef.current = requestId;
      activeRequestIdRef.current = requestId;
      abortControllerRef.current = abortController;
      lastRequestKeyRef.current = requestKey;

      setIsSubmitting(true);
      setSubmissionMode(mode);
      setError(null);
      setShowInterestValidation(false);

      onItineraryGenerated(null);

      try {
        const response = await fetch("/api/itinerary", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ preferences: nextPreferences }),
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

        setHasGeneratedItinerary(true);
        onItineraryGenerated({
          itinerary: result.itinerary,
          adaptation: result.adaptation,
        });
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
        }
      }
    },
    [onItineraryGenerated]
  );

  useEffect(() => {
    if (!hasGeneratedItinerary || interests.length === 0) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void requestItinerary(preferences, "auto");
    }, autoRegenerationDelayMs);

    return () => window.clearTimeout(timeoutId);
  }, [
    hasGeneratedItinerary,
    interests.length,
    preferenceKey,
    preferences,
    requestItinerary,
  ]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (preferences.interests.length === 0) {
      setShowInterestValidation(true);
      setError(null);
      onItineraryGenerated(null);
      setHasGeneratedItinerary(false);
      return;
    }

    await requestItinerary(preferences, "manual");
  }

  function handleReset() {
    setInterests([]);
    setStartTime("09:00");
    setEndTime("17:00");
    setBudgetLevel("medium");
    setTransportMode("walking");
    setPreferredPace("moderate");
    setMaxAttractions(5);
    setOpenInterestGroups([interestGroups[0].label]);
    setError(null);
    setShowInterestValidation(false);
    setHasGeneratedItinerary(false);
    lastRequestKeyRef.current = null;
    requestSequenceRef.current += 1;
    activeRequestIdRef.current = requestSequenceRef.current;
    abortControllerRef.current?.abort();
    onItineraryGenerated(null);
  }

  return (
    <form onSubmit={handleSubmit} className="preference-form" aria-busy={isSubmitting}>
      <div className="form-header">
        <p className="eyebrow">Trip preferences</p>
        <h2>Plan your visit</h2>
        <p>
          Tune the form around your available time, preferred pace, budget, and
          Sarajevo interests.
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
        <label className="field">
          <span>Start time</span>
          <input
            type="time"
            value={startTime}
            onChange={(event) => {
              setStartTime(event.target.value);
              handlePreferencesChanged();
            }}
          />
        </label>

        <label className="field">
          <span>End time</span>
          <input
            type="time"
            value={endTime}
            onChange={(event) => {
              setEndTime(event.target.value);
              handlePreferencesChanged();
            }}
          />
        </label>

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

        <label className="field">
          <span>Travel pace</span>
          <select
            value={preferredPace}
            onChange={(event) => {
              setPreferredPace(event.target.value as PreferredPace);
              handlePreferencesChanged();
            }}
          >
            <option value="relaxed">Relaxed</option>
            <option value="moderate">Moderate</option>
            <option value="fast">Fast</option>
          </select>
        </label>

        <label className="field">
          <span>Max stops</span>
          <input
            type="number"
            min="1"
            max="12"
            value={maxAttractions}
            onChange={(event) => {
              setMaxAttractions(Number(event.target.value));
              handlePreferencesChanged();
            }}
          />
        </label>
      </div>

      <div className="form-summary">
        <span>Window</span>
        <strong>
          {startTime} - {endTime}
        </strong>
        <span>{interests.length || "No"} interests selected</span>
      </div>

      {error ? (
        <div className="form-error" role="alert">
          <strong>Generation failed</strong>
          <p>{error}</p>
        </div>
      ) : null}

      <div className="form-actions">
        <button type="submit" className="button button-primary" disabled={isSubmitting}>
          {isSubmitting && submissionMode === "auto"
            ? "Updating itinerary..."
            : isSubmitting
              ? "Generating..."
              : "Generate itinerary"}
        </button>
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
