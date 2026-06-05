"use client";

import { useState } from "react";
import type {
  GeneratedItinerary,
  ItineraryAdaptation,
  TrafficAdaptResponse,
  TrafficSeverity,
} from "@/types/itinerary";
import type { PlannerPreferences } from "@/types/preference";

type TrafficSimulationPanelProps = {
  itinerary: GeneratedItinerary;
  preferences: PlannerPreferences;
  onItineraryUpdated: (
    itinerary: GeneratedItinerary,
    adaptation: ItineraryAdaptation
  ) => void;
};

type PendingDecision = {
  current: GeneratedItinerary;
  proposed: GeneratedItinerary;
  adaptation: ItineraryAdaptation;
};

export function TrafficSimulationPanel({
  itinerary,
  preferences,
  onItineraryUpdated,
}: TrafficSimulationPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [severity, setSeverity] = useState<TrafficSeverity>("heavy");
  const [affectedLegIndex, setAffectedLegIndex] = useState<number | "auto">(
    "auto"
  );
  const [isSimulating, setIsSimulating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decisionModalOpen, setDecisionModalOpen] = useState(false);
  const [pendingDecision, setPendingDecision] =
    useState<PendingDecision | null>(null);
  const [blockedNotification, setBlockedNotification] = useState<string | null>(
    null
  );
  const [stayNote, setStayNote] = useState<string | null>(null);

  const stopCount = itinerary.items.length;

  async function handleSimulate() {
    setIsSimulating(true);
    setError(null);
    setBlockedNotification(null);
    setStayNote(null);

    try {
      const response = await fetch("/api/itinerary/adapt-traffic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentItinerary: itinerary,
          preferences: {
            interests: preferences.interests,
            transport: preferences.transportMode,
            startTime: preferences.startTime,
            endTime: preferences.endTime,
            maxStops: preferences.maxAttractions,
          },
          trafficSimulation: {
            enabled: true,
            severity,
            affectedLegIndex,
          },
        }),
      });

      const result = (await response.json()) as TrafficAdaptResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(result.error ?? "Traffic simulation failed");
      }

      if (result.trafficDecisionRequired) {
        setPendingDecision({
          current: result.currentItinerary,
          proposed: result.proposedItinerary,
          adaptation: result.adaptation,
        });
        setDecisionModalOpen(true);
      } else {
        onItineraryUpdated(result.itinerary, result.adaptation);

        if (severity === "blocked") {
          setBlockedNotification(
            "Route blocked. The itinerary was automatically updated."
          );
        }
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Traffic simulation failed"
      );
    } finally {
      setIsSimulating(false);
    }
  }

  function handleStay() {
    if (pendingDecision) {
      onItineraryUpdated(pendingDecision.current, {
        ...pendingDecision.adaptation,
        applied: false,
        reasons: [
          ...(pendingDecision.adaptation.reasons ?? []),
          "You chose to stay on the current route. The delay is still in effect.",
        ],
      });
      setStayNote(
        "You chose to stay on the current route. The delay is still in effect."
      );
    }
    setDecisionModalOpen(false);
    setPendingDecision(null);
  }

  function handleSwitch() {
    if (pendingDecision) {
      onItineraryUpdated(pendingDecision.proposed, {
        ...pendingDecision.adaptation,
        applied: true,
      });
    }
    setDecisionModalOpen(false);
    setPendingDecision(null);
  }

  const decisionAdaptation = pendingDecision?.adaptation;
  const affectedFrom =
    decisionAdaptation?.trafficSimulation?.affectedSegment.from ?? "";
  const affectedTo =
    decisionAdaptation?.trafficSimulation?.affectedSegment.to ?? "";
  const addedDelay =
    decisionAdaptation?.trafficSimulation?.addedDelayMinutes ?? 0;

  return (
    <>
      <div className="traffic-panel">
        <button
          type="button"
          className="traffic-panel-toggle"
          onClick={() => setIsOpen((prev) => !prev)}
          aria-expanded={isOpen}
        >
          <span className="traffic-panel-toggle-label">
            Traffic simulation test
          </span>
          <span className="traffic-panel-toggle-icon" aria-hidden="true">
            {isOpen ? "−" : "+"}
          </span>
        </button>

        {isOpen ? (
          <div className="traffic-panel-body">
            <div className="traffic-panel-grid">
              <label className="field">
                <span>Severity</span>
                <select
                  value={severity}
                  onChange={(e) =>
                    setSeverity(e.target.value as TrafficSeverity)
                  }
                  disabled={isSimulating}
                >
                  <option value="moderate">Moderate delay</option>
                  <option value="heavy">Heavy delay</option>
                  <option value="blocked">Blocked route</option>
                </select>
              </label>

              <label className="field">
                <span>Affected leg</span>
                <select
                  value={affectedLegIndex === "auto" ? "auto" : String(affectedLegIndex)}
                  onChange={(e) => {
                    const val = e.target.value;
                    setAffectedLegIndex(val === "auto" ? "auto" : Number(val));
                  }}
                  disabled={isSimulating}
                >
                  <option value="auto">Auto (longest leg)</option>
                  {Array.from({ length: stopCount - 1 }, (_, i) => (
                    <option key={i + 1} value={String(i + 1)}>
                      Stop {i + 1} → Stop {i + 2}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {severity === "moderate" ? (
              <p className="traffic-severity-hint">
                Moderate delay: adds ~15–50% extra travel time. No route change
                required.
              </p>
            ) : severity === "heavy" ? (
              <p className="traffic-severity-hint">
                Heavy delay: significant slowdown. You will be asked whether to
                switch to an adapted route.
              </p>
            ) : (
              <p className="traffic-severity-hint traffic-severity-hint-blocked">
                Blocked route: segment is impassable. Itinerary will be
                automatically updated.
              </p>
            )}

            {error ? (
              <div className="form-error" role="alert">
                <strong>Simulation failed</strong>
                <p>{error}</p>
              </div>
            ) : null}

            {blockedNotification ? (
              <div className="traffic-notification traffic-notification-blocked" role="status">
                {blockedNotification}
              </div>
            ) : null}

            {stayNote ? (
              <div className="traffic-notification traffic-notification-info" role="status">
                {stayNote}
              </div>
            ) : null}

            <button
              type="button"
              className="button button-primary traffic-simulate-btn"
              onClick={() => void handleSimulate()}
              disabled={isSimulating || stopCount < 2}
            >
              {isSimulating ? "Simulating…" : "Simulate traffic event"}
            </button>

            {stopCount < 2 ? (
              <p className="traffic-severity-hint">
                Generate an itinerary with at least 2 stops to use traffic
                simulation.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {decisionModalOpen && pendingDecision ? (
        <div
          className="traffic-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="traffic-modal-title"
        >
          <div className="traffic-modal">
            <div className="traffic-modal-header">
              <p className="attraction-category">Real-time adaptation</p>
              <h3 id="traffic-modal-title">Traffic delay detected</h3>
            </div>

            <div className="traffic-modal-body">
              <p>
                Heavy simulated traffic added{" "}
                <strong>{addedDelay} minutes</strong> between{" "}
                <strong>{affectedFrom}</strong> and{" "}
                <strong>{affectedTo}</strong>.
              </p>
              <p>An adapted route is available. Choose how to proceed.</p>

              <div className="traffic-modal-comparison">
                <div className="traffic-modal-option">
                  <p className="traffic-modal-option-label">Current route</p>
                  <p className="traffic-modal-option-value">
                    {pendingDecision.current.totalDuration} min total
                  </p>
                  <p className="traffic-modal-option-stops">
                    {pendingDecision.current.items.length} stops
                  </p>
                </div>
                <div className="traffic-modal-option traffic-modal-option-proposed">
                  <p className="traffic-modal-option-label">Adapted route</p>
                  <p className="traffic-modal-option-value">
                    {pendingDecision.proposed.totalDuration} min total
                  </p>
                  <p className="traffic-modal-option-stops">
                    {pendingDecision.proposed.items.length} stops
                  </p>
                </div>
              </div>

              {(decisionAdaptation?.reasons ?? []).length > 0 ? (
                <ul className="traffic-modal-reasons">
                  {(decisionAdaptation?.reasons ?? []).map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              ) : null}
            </div>

            <div className="traffic-modal-actions">
              <button
                type="button"
                className="button button-secondary"
                onClick={handleStay}
              >
                Stay on current route
              </button>
              <button
                type="button"
                className="button button-primary"
                onClick={handleSwitch}
              >
                Switch to adapted route
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
