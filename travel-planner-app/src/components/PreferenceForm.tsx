"use client";

import { type FormEvent, useState } from "react";

const availableInterests = [
  "history",
  "culture",
  "nature",
  "architecture",
  "religion",
  "museum",
] as const;

type Interest = (typeof availableInterests)[number];
type BudgetLevel = "free" | "low" | "medium" | "high";
type TransportMode = "walking" | "driving";
type PreferredPace = "relaxed" | "moderate" | "fast";

type PlannerPreferences = {
  interests: Interest[];
  startTime: string;
  endTime: string;
  budgetLevel: BudgetLevel;
  transportMode: TransportMode;
  preferredPace: PreferredPace;
  maxAttractions: number;
};

function formatOption(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function PreferenceForm() {
  const [interests, setInterests] = useState<Interest[]>([]);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [budgetLevel, setBudgetLevel] = useState<BudgetLevel>("medium");
  const [transportMode, setTransportMode] = useState<TransportMode>("walking");
  const [preferredPace, setPreferredPace] = useState<PreferredPace>("moderate");
  const [maxAttractions, setMaxAttractions] = useState(5);

  function toggleInterest(interest: Interest) {
    setInterests((previousInterests) =>
      previousInterests.includes(interest)
        ? previousInterests.filter((item) => item !== interest)
        : [...previousInterests, interest]
    );
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const preferences: PlannerPreferences = {
      interests,
      startTime,
      endTime,
      budgetLevel,
      transportMode,
      preferredPace,
      maxAttractions,
    };

    console.log("Submitted preferences:", preferences);

    alert("Preferences captured. Recommendation logic will be connected next.");
  }

  function handleReset() {
    setInterests([]);
    setStartTime("09:00");
    setEndTime("17:00");
    setBudgetLevel("medium");
    setTransportMode("walking");
    setPreferredPace("moderate");
    setMaxAttractions(5);
  }

  return (
    <form onSubmit={handleSubmit} className="preference-form">
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

        <div className="interest-grid">
          {availableInterests.map((interest) => (
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

      <div className="form-actions">
        <button type="submit" className="button button-primary">
          Generate itinerary
        </button>
        <button type="button" className="button button-secondary" onClick={handleReset}>
          Reset
        </button>
      </div>
    </form>
  );
}
