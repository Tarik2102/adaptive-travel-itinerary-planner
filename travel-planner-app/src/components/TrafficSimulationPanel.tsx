"use client";

import { useRef, useState } from "react";
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
  dayLabel?: string;
};

type PendingDecision = {
  current: GeneratedItinerary;
  proposed: GeneratedItinerary;
  adaptation: ItineraryAdaptation;
};

function truncateName(name: string, max = 28): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

function buildStatusMessage(adaptation: ItineraryAdaptation): string | null {
  const ts = adaptation.trafficSimulation;
  if (!ts?.enabled) return null;

  const toStop = ts.affectedSegment.to || "next stop";

  if (ts.status === "blocked_reoptimized") {
    return `Route blocked on segment to "${toStop}". Itinerary re-optimized — stops reordered for best available path.`;
  }
  if (ts.status === "ignored" || ts.status === "no_effect") {
    return adaptation.reasons[0] ?? null;
  }
  if (ts.addedDelayMinutes > 0) {
    const kind = ts.severity === "heavy" ? "Heavy traffic" : "Traffic";
    return `${kind} detected on route to "${toStop}": +${ts.addedDelayMinutes} min delay applied. Route checked — current path is still the best available option.`;
  }
  return null;
}

function getStatusClass(adaptation: ItineraryAdaptation): string {
  const ts = adaptation.trafficSimulation;
  if (ts?.status === "blocked_reoptimized") return "traffic-notification-blocked";
  if (ts?.severity === "heavy") return "traffic-notification-warning";
  return "traffic-notification-info";
}

export function TrafficSimulationPanel({
  itinerary,
  preferences,
  onItineraryUpdated,
  dayLabel,
}: TrafficSimulationPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [severity, setSeverity] = useState<TrafficSeverity>("heavy");
  const [affectedLegIndex, setAffectedLegIndex] = useState<number | "auto">("auto");
  const [useLiveTraffic, setUseLiveTraffic] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decisionModalOpen, setDecisionModalOpen] = useState(false);
  const [pendingDecision, setPendingDecision] = useState<PendingDecision | null>(null);
  const [lastAdaptation, setLastAdaptation] = useState<ItineraryAdaptation | null>(null);
  const [liveTrafficInfo, setLiveTrafficInfo] = useState<{
    trafficDelaySec?: number;
    trafficSource?: string;
    fallbackReason?: string;
  } | null>(null);

  // Capture the pre-simulation itinerary the first time a simulation runs
  const originalItineraryRef = useRef<GeneratedItinerary | null>(null);
  const hasSimulated = originalItineraryRef.current !== null;

  const items = itinerary.items;
  const stopCount = items.length;

  async function handleSimulate() {
    // Capture original before the first simulation so Reset can restore it
    if (!originalItineraryRef.current) {
      originalItineraryRef.current = itinerary;
    }

    setIsSimulating(true);
    setError(null);
    setLastAdaptation(null);
    setLiveTrafficInfo(null);

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
            source: useLiveTraffic ? "live" : "simulation",
          },
        }),
      });

      const result = (await response.json()) as TrafficAdaptResponse & {
        error?: string;
        fallbackReason?: string;
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
        setLastAdaptation(result.adaptation);

        if (useLiveTraffic) {
          const affectedItem = result.itinerary.items.find(
            (item) => item.trafficSource === "tomtom"
          );
          setLiveTrafficInfo({
            trafficDelaySec: affectedItem?.trafficDelaySec,
            trafficSource: affectedItem?.trafficSource ?? result.adaptation.trafficSimulation?.status,
            fallbackReason: result.fallbackReason,
          });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Traffic simulation failed");
    } finally {
      setIsSimulating(false);
    }
  }

  function handleReset() {
    const original = originalItineraryRef.current;
    if (original) {
      onItineraryUpdated(original, {
        applied: false,
        reasons: [],
        feasibilityStatus: "feasible",
      });
    }
    originalItineraryRef.current = null;
    setLastAdaptation(null);
    setLiveTrafficInfo(null);
    setError(null);
    setDecisionModalOpen(false);
    setPendingDecision(null);
    setAffectedLegIndex("auto");
  }

  function handleStay() {
    if (pendingDecision) {
      const adaptation: ItineraryAdaptation = {
        ...pendingDecision.adaptation,
        applied: false,
        reasons: [
          ...(pendingDecision.adaptation.reasons ?? []),
          "Stayed on current route — delay is still in effect.",
        ],
      };
      onItineraryUpdated(pendingDecision.current, adaptation);
      setLastAdaptation(adaptation);
    }
    setDecisionModalOpen(false);
    setPendingDecision(null);
  }

  function handleSwitch() {
    if (pendingDecision) {
      const adaptation: ItineraryAdaptation = {
        ...pendingDecision.adaptation,
        applied: true,
      };
      onItineraryUpdated(pendingDecision.proposed, adaptation);
      setLastAdaptation(adaptation);
    }
    setDecisionModalOpen(false);
    setPendingDecision(null);
  }

  const decisionAdaptation = pendingDecision?.adaptation;
  const affectedFrom = decisionAdaptation?.trafficSimulation?.affectedSegment.from ?? "";
  const affectedTo = decisionAdaptation?.trafficSimulation?.affectedSegment.to ?? "";
  const addedDelay = decisionAdaptation?.trafficSimulation?.addedDelayMinutes ?? 0;

  const statusMessage = lastAdaptation ? buildStatusMessage(lastAdaptation) : null;
  const statusClass = lastAdaptation ? getStatusClass(lastAdaptation) : "traffic-notification-info";

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
            Traffic simulation{dayLabel ? ` — ${dayLabel}` : ""}
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
                  onChange={(e) => setSeverity(e.target.value as TrafficSeverity)}
                  disabled={isSimulating}
                >
                  <option value="moderate">Moderate (congested)</option>
                  <option value="heavy">Heavy (severe delay)</option>
                  <option value="blocked">Blocked (impassable)</option>
                </select>
              </label>

              <label className="field">
                <span>Affected segment</span>
                <select
                  value={affectedLegIndex === "auto" ? "auto" : String(affectedLegIndex)}
                  onChange={(e) => {
                    const val = e.target.value;
                    setAffectedLegIndex(val === "auto" ? "auto" : Number(val));
                  }}
                  disabled={isSimulating}
                >
                  <option value="auto">Auto (longest driving leg)</option>
                  {Array.from({ length: stopCount - 1 }, (_, i) => {
                    const fromName = items[i]?.attraction.name ?? `Stop ${i + 1}`;
                    const toName = items[i + 1]?.attraction.name ?? `Stop ${i + 2}`;
                    const legTransport = items[i + 1]?.legTransport;
                    const isWalking = legTransport === "walking";
                    return (
                      <option key={i + 1} value={String(i + 1)} disabled={isWalking}>
                        {`Leg ${i + 1}: ${truncateName(fromName)} → ${truncateName(toName)}`}
                        {isWalking ? " (walking — not eligible)" : ""}
                      </option>
                    );
                  })}
                </select>
              </label>
            </div>

            <label className="traffic-live-toggle">
              <input
                type="checkbox"
                checked={useLiveTraffic}
                onChange={(e) => {
                  setUseLiveTraffic(e.target.checked);
                  setLiveTrafficInfo(null);
                }}
                disabled={isSimulating}
              />
              <span>Use live traffic (TomTom)</span>
            </label>

            {severity === "moderate" ? (
              <p className="traffic-severity-hint">
                <strong>Congested:</strong> adds ~15–50% extra travel time on the selected driving segment. Route checked — delay applied if no faster path exists. Same stops, same geometry.
              </p>
            ) : severity === "heavy" ? (
              <p className="traffic-severity-hint">
                <strong>Heavy delay:</strong> significant slowdown on the selected driving segment. If the itinerary becomes infeasible, you will be offered a re-optimized alternative (stops reordered).
              </p>
            ) : (
              <p className="traffic-severity-hint traffic-severity-hint-blocked">
                <strong>Blocked:</strong> segment is impassable. The itinerary is automatically re-optimized — one stop is removed and the remaining stops are reordered for the best available path.
              </p>
            )}

            {error ? (
              <div className="form-error" role="alert">
                <strong>Simulation failed</strong>
                <p>{error}</p>
              </div>
            ) : null}

            {statusMessage ? (
              <div className={`traffic-notification ${statusClass}`} role="status">
                {statusMessage}
              </div>
            ) : null}

            {liveTrafficInfo ? (
              <div className="traffic-notification traffic-notification-info" role="status">
                {liveTrafficInfo.fallbackReason ? (
                  <span>
                    Live traffic unavailable ({liveTrafficInfo.fallbackReason}) — fell back to simulation.
                  </span>
                ) : (
                  <span>
                    Live traffic source: <strong>{liveTrafficInfo.trafficSource ?? "tomtom"}</strong>
                    {liveTrafficInfo.trafficDelaySec !== undefined
                      ? ` · delay ${Math.round(liveTrafficInfo.trafficDelaySec / 60)} min`
                      : ""}
                  </span>
                )}
              </div>
            ) : null}

            <div className="traffic-panel-actions">
              <button
                type="button"
                className="button button-primary traffic-simulate-btn"
                onClick={() => void handleSimulate()}
                disabled={isSimulating || stopCount < 2}
              >
                {isSimulating ? "Simulating…" : "Simulate traffic event"}
              </button>

              {hasSimulated ? (
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={handleReset}
                  disabled={isSimulating}
                >
                  Reset
                </button>
              ) : null}
            </div>

            {stopCount < 2 ? (
              <p className="traffic-severity-hint">
                Generate an itinerary with at least 2 stops to use traffic simulation.
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
              <h3 id="traffic-modal-title">Heavy traffic — choose how to proceed</h3>
            </div>

            <div className="traffic-modal-body">
              <p>
                Heavy traffic added <strong>{addedDelay} min</strong> on the segment from{" "}
                <strong>{affectedFrom}</strong> to <strong>{affectedTo}</strong> — making the
                itinerary infeasible.
              </p>
              <p>
                An adapted itinerary is available with stops reordered and one stop removed.
              </p>

              <div className="traffic-modal-comparison">
                <div className="traffic-modal-option">
                  <p className="traffic-modal-option-label">Current route (delayed)</p>
                  <p className="traffic-modal-option-value">
                    {pendingDecision.current.totalDuration} min total
                  </p>
                  <p className="traffic-modal-option-stops">
                    {pendingDecision.current.items.length} stops · same route
                  </p>
                </div>
                <div className="traffic-modal-option traffic-modal-option-proposed">
                  <p className="traffic-modal-option-label">Re-optimized route</p>
                  <p className="traffic-modal-option-value">
                    {pendingDecision.proposed.totalDuration} min total
                  </p>
                  <p className="traffic-modal-option-stops">
                    {pendingDecision.proposed.items.length} stops · reordered
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
                Switch to re-optimized route
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
