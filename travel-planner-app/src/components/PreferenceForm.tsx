"use client";

import { type FormEvent, useState } from "react";
import type { ItineraryApiResponse, ItineraryPlan } from "@/types/itinerary";
import {
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

function formatOption(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
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
  const [error, setError] = useState<string | null>(null);
  const [showInterestValidation, setShowInterestValidation] = useState(false);
  const allInterestsSelected = interests.length === travelInterestOptions.length;
  const interestValidationError =
    showInterestValidation && interests.length === 0
      ? interestValidationMessage
      : null;

  function toggleInterest(interest: TravelInterest) {
    setInterests((previousInterests) =>
      previousInterests.includes(interest)
        ? previousInterests.filter((item) => item !== interest)
        : [...previousInterests, interest]
    );
  }

  function handleInterestBulkToggle() {
    setInterests(allInterestsSelected ? [] : [...travelInterestOptions]);
    setShowInterestValidation(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (interests.length === 0) {
      setShowInterestValidation(true);
      setError(null);
      onItineraryGenerated(null);
      return;
    }

    const preferences: PlannerPreferences = {
      interests,
      startTime,
      endTime,
      budgetLevel,
      transportMode,
      preferredPace,
      maxAttractions,
    };

    setIsSubmitting(true);
    setError(null);
    setShowInterestValidation(false);
    onItineraryGenerated(null);

    try {
      const response = await fetch("/api/itinerary", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ preferences }),
      });

      const result = (await response.json()) as ItineraryApiResponse;

      if (!response.ok || !result.success) {
        throw new Error(
          result.success ? "Failed to generate itinerary" : result.error
        );
      }

      onItineraryGenerated({
        itinerary: result.itinerary,
        adaptation: result.adaptation,
      });
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Failed to generate itinerary"
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleReset() {
    setInterests([]);
    setStartTime("09:00");
    setEndTime("17:00");
    setBudgetLevel("medium");
    setTransportMode("walking");
    setPreferredPace("moderate");
    setMaxAttractions(5);
    setError(null);
    setShowInterestValidation(false);
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

        <div className="interest-grid">
          {travelInterestOptions.map((interest) => (
            <label className="interest-option" key={interest}>
              <input
                type="checkbox"
                className="interest-checkbox"
                checked={interests.includes(interest)}
                onChange={() => toggleInterest(interest)}
              />
              <span>{formatOption(interest)}</span>
            </label>
          ))}
        </div>

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
            onChange={(event) => setStartTime(event.target.value)}
          />
        </label>

        <label className="field">
          <span>End time</span>
          <input
            type="time"
            value={endTime}
            onChange={(event) => setEndTime(event.target.value)}
          />
        </label>

        <label className="field">
          <span>Budget level</span>
          <select
            value={budgetLevel}
            onChange={(event) =>
              setBudgetLevel(event.target.value as BudgetLevel)
            }
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
            onChange={(event) =>
              setTransportMode(event.target.value as TransportMode)
            }
          >
            <option value="walking">Walking</option>
            <option value="driving">Driving</option>
          </select>
        </label>

        <label className="field">
          <span>Travel pace</span>
          <select
            value={preferredPace}
            onChange={(event) =>
              setPreferredPace(event.target.value as PreferredPace)
            }
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
            onChange={(event) => setMaxAttractions(Number(event.target.value))}
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
          {isSubmitting ? "Generating..." : "Generate itinerary"}
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
