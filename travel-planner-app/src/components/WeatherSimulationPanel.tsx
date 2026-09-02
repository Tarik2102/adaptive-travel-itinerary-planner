"use client";

import { useState } from "react";
import { inferAttractionEnvironment } from "@/lib/weather-adaptation";
import {
  isOutdoorRiskOverride,
  weatherOverrideLabels,
  weatherOverrideValues,
  type WeatherOverride,
} from "@/lib/weather-override";
import type { GeneratedItinerary, ItineraryItem } from "@/types/itinerary";

type WeatherSimulationPanelProps = {
  itinerary: GeneratedItinerary;
  /**
   * Regenerates the active day through the same day-scoped generation path as
   * "Update this day", passing the picked condition as `weatherOverride`.
   * Resolves with the regenerated day so the panel can diff it against `itinerary`.
   */
  onSimulate: (condition: WeatherOverride) => Promise<GeneratedItinerary | null>;
  onReset: () => void;
  isBusy?: boolean;
  dayLabel?: string;
};

const CONDITION_HINTS: Record<WeatherOverride, string> = {
  clear:
    "Clear skies carry no outdoor risk — the day is generated without weather re-scoring.",
  cloudy:
    "Cloudy but dry — no outdoor risk, so outdoor stops keep their normal ranking.",
  rain: "Rain deprioritizes outdoor stops and favours indoor alternatives.",
  thunderstorm:
    "Thunderstorms are treated like rain — outdoor stops are deprioritized in favour of indoor ones.",
  snow: "Snow is treated like rain — outdoor stops are deprioritized in favour of indoor ones.",
};

// Counts the stops weather adaptation actually acts on. inferAttractionEnvironment
// resolves these from the structured DB columns first, falling back to keywords
// only for attractions that carry no environment data at all.
function countOutdoor(items: ItineraryItem[]): number {
  return items.filter(
    (item) => inferAttractionEnvironment(item.attraction) === "outdoor"
  ).length;
}

/**
 * Compares the day before and after the weather-driven regeneration and
 * describes the actual difference — never a canned count.
 */
function buildStatusMessage(
  condition: WeatherOverride,
  before: GeneratedItinerary,
  after: GeneratedItinerary
): string {
  const label = weatherOverrideLabels[condition];

  if (!isOutdoorRiskOverride(condition)) {
    const skies = condition === "clear" ? "Clear skies" : `${label} skies`;
    return `${skies} — no adaptation needed.`;
  }

  const beforeIds = new Set(before.items.map((item) => item.attraction.id));
  const afterIds = new Set(after.items.map((item) => item.attraction.id));

  const droppedOutdoor = before.items.filter(
    (item) =>
      !afterIds.has(item.attraction.id) &&
      inferAttractionEnvironment(item.attraction) === "outdoor"
  ).length;
  const addedStops = after.items.filter(
    (item) => !beforeIds.has(item.attraction.id)
  );
  const addedIndoor = addedStops.filter(
    (item) => inferAttractionEnvironment(item.attraction) === "indoor"
  ).length;
  // A newly added stop that is not classified outdoor is still shelter relative
  // to what it displaced, even when its environment is unknown.
  const addedSheltered = addedStops.filter(
    (item) => inferAttractionEnvironment(item.attraction) !== "outdoor"
  ).length;
  const replaced = Math.min(droppedOutdoor, addedSheltered);

  if (replaced > 0) {
    const stops = replaced === 1 ? "stop" : "stops";
    // Only claim "indoor" when the replacements are positively identified as such.
    const kind = addedIndoor >= replaced ? "indoor" : "sheltered";
    const alternatives =
      replaced === 1 ? `an ${kind} alternative` : `${kind} alternatives`;
    return `${label} simulated — ${replaced} outdoor ${stops} replaced with ${alternatives}.`;
  }

  if (droppedOutdoor > 0) {
    const stops = droppedOutdoor === 1 ? "stop" : "stops";
    return `${label} simulated — ${droppedOutdoor} outdoor ${stops} dropped, with nothing available to take their place.`;
  }

  if (countOutdoor(after.items) === 0) {
    return `${label} simulated — no outdoor stops left to swap out, so the day is unchanged.`;
  }

  return `${label} simulated — outdoor stops were deprioritized, but no better alternative was available. The day is unchanged.`;
}

export function WeatherSimulationPanel({
  itinerary,
  onSimulate,
  onReset,
  isBusy = false,
  dayLabel,
}: WeatherSimulationPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [condition, setCondition] = useState<WeatherOverride>("rain");
  const [isSimulating, setIsSimulating] = useState(false);
  const [hasSimulated, setHasSimulated] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusIsAdaptive, setStatusIsAdaptive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stopCount = itinerary.items.length;
  const outdoorCount = countOutdoor(itinerary.items);
  const disabled = isSimulating || isBusy;

  async function handleSimulate() {
    // `itinerary` is the day as it stands right now — the "before" side of the diff.
    const before = itinerary;

    setIsSimulating(true);
    setError(null);
    setStatusMessage(null);

    try {
      const after = await onSimulate(condition);

      if (!after) {
        throw new Error("Weather simulation failed");
      }

      setHasSimulated(true);
      setStatusMessage(buildStatusMessage(condition, before, after));
      setStatusIsAdaptive(isOutdoorRiskOverride(condition));
    } catch (simulationError) {
      setError(
        simulationError instanceof Error
          ? simulationError.message
          : "Weather simulation failed"
      );
    } finally {
      setIsSimulating(false);
    }
  }

  function handleReset() {
    onReset();
    setHasSimulated(false);
    setStatusMessage(null);
    setStatusIsAdaptive(false);
    setError(null);
  }

  return (
    <div className="weather-panel">
      <button
        type="button"
        className="weather-panel-toggle"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
      >
        <span className="weather-panel-toggle-label">
          Weather simulation{dayLabel ? ` — ${dayLabel}` : ""}
        </span>
        <span className="weather-panel-toggle-icon" aria-hidden="true">
          {isOpen ? "−" : "+"}
        </span>
      </button>

      {isOpen ? (
        <div className="weather-panel-body">
          <div className="weather-panel-grid">
            <label className="field">
              <span>Condition</span>
              <select
                value={condition}
                onChange={(event) =>
                  setCondition(event.target.value as WeatherOverride)
                }
                disabled={disabled}
              >
                {weatherOverrideValues.map((value) => (
                  <option key={value} value={value}>
                    {weatherOverrideLabels[value]}
                    {isOutdoorRiskOverride(value) ? " (outdoor risk)" : ""}
                  </option>
                ))}
              </select>
            </label>

            <div className="field weather-panel-readout">
              <span>Current day</span>
              <p className="weather-hint">
                {stopCount} {stopCount === 1 ? "stop" : "stops"} · {outdoorCount}{" "}
                exposed to the weather
              </p>
            </div>
          </div>

          <p className="weather-hint">{CONDITION_HINTS[condition]}</p>

          {error ? (
            <div className="form-error" role="alert">
              <strong>Simulation failed</strong>
              <p>{error}</p>
            </div>
          ) : null}

          {statusMessage ? (
            <div
              className={`weather-notification ${
                statusIsAdaptive
                  ? "weather-notification-warning"
                  : "weather-notification-info"
              }`}
              role="status"
            >
              {statusMessage}
            </div>
          ) : null}

          <div className="weather-panel-actions">
            <button
              type="button"
              className="button button-primary weather-simulate-btn"
              onClick={() => void handleSimulate()}
              disabled={disabled || stopCount === 0}
            >
              {isSimulating ? "Simulating…" : "Simulate weather"}
            </button>

            {hasSimulated ? (
              <button
                type="button"
                className="button button-secondary"
                onClick={handleReset}
                disabled={disabled}
              >
                Reset
              </button>
            ) : null}
          </div>

          {stopCount === 0 ? (
            <p className="weather-hint">
              Generate an itinerary with at least one stop to simulate weather.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
