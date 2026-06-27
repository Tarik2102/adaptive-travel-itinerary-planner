"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { AttractionDetailsModal } from "@/components/AttractionDetailsModal";
import { Badge } from "@/components/Badge";
import { ItineraryMap } from "@/components/ItineraryMap";
import { ItineraryLoader } from "@/components/Loader";
import { SectionHeader } from "@/components/SectionHeader";
import type { Attraction, AttractionImage } from "@/types/attraction";
import type {
  GeneratedItinerary,
  ItineraryAdaptation,
  ItineraryDayPlan,
  ItineraryItem,
} from "@/types/itinerary";

type ItineraryResultProps = {
  adaptation: ItineraryAdaptation | null;
  itinerary: GeneratedItinerary | null;
  days?: ItineraryDayPlan[];
  activeDayIndex: number;
  expandedDayIndex: number | null;
  onDayCardClick: (index: number) => void;
  isUpdatingDay: boolean;
  isExtendingDays: boolean;
  updateDayProgress: string | null;
  updateDayError: string | null;
  isGenerating: boolean;
  generationProgress: string | null;
};

type ImagesResponse =
  | { success: true; data: AttractionImage[] }
  | { success: false; error?: string };

function buildMapKey(itinerary: GeneratedItinerary): string {
  const stopIds = itinerary.items.map((item) => item.attraction.id).join("-");
  const geoCount = itinerary.routeGeometry?.coordinates.length ?? 0;
  return `${stopIds}:${geoCount}`;
}

function getItineraryPlaceholderClass(category: string): string {
  const cat = category.toLowerCase();
  if (cat.includes("museum")) return "placeholder-museum";
  if (cat.includes("food") || cat.includes("cafe") || cat.includes("restaurant")) return "placeholder-food";
  if (cat.includes("nature") || cat.includes("park") || cat.includes("viewpoint")) return "placeholder-nature";
  if (cat.includes("religion") || cat.includes("mosque") || cat.includes("church")) return "placeholder-religion";
  if (cat.includes("history") || cat.includes("culture") || cat.includes("heritage") || cat.includes("architecture")) return "placeholder-heritage";
  if (cat.includes("sport")) return "placeholder-sport";
  if (cat.includes("shopping")) return "placeholder-shopping";
  if (cat.includes("entertainment")) return "placeholder-entertainment";
  return "placeholder-default";
}

function isWikimediaUrl(url: string): boolean {
  return url.startsWith("https://upload.wikimedia.org/");
}

function toTitleCase(value: string) {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

// ── Static leave-reminder (per-card helper line) ────────────────────────────
const LEAVE_REMINDER_LEAD_MINUTES = 10;

// ── Simulated trip clock ─────────────────────────────────────────────────────
/** Real milliseconds per simulated minute (20× speed: 10-hr day ≈ 30 s). */
const SIM_TICK_MS = 50;

/** Extra buffer (min) added on top of travel time for the SOON reminder. */
const REMINDER_BUFFER_MINUTES = 5;

// ── Shared time utilities ────────────────────────────────────────────────────
function parseTimeToMinutes(timeStr: string): number | null {
  const [hourStr, minStr] = timeStr.split(":");
  const hour = Number(hourStr);
  const minute = Number(minStr);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

function minutesToTimeStr(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function computeReminderTime(plannedEndTime: string): string | null {
  const totalMinutes = parseTimeToMinutes(plannedEndTime);
  if (totalMinutes === null) return null;
  const result = totalMinutes - LEAVE_REMINDER_LEAD_MINUTES;
  if (result < 0) return null;
  return minutesToTimeStr(result);
}

// ── Travel-aware reminder windows ────────────────────────────────────────────
type ReminderWindow = {
  stopIndex: number;
  currentStopName: string;
  nextStopName: string;
  /** Simulated time (min since midnight) when the SOON banner should appear. */
  soonTime: number;
  /** Simulated time (min since midnight) when departure is due — the NOW threshold. */
  departureTime: number;
  /** Simulated time (min since midnight) when the traveller arrives at the next stop. */
  nextStopStartMinutes: number;
};

type ActiveBanner = {
  key: string;
  type: "soon" | "now";
  window: ReminderWindow;
  minutesUntilDeparture: number;
};

function computeReminderWindows(items: ItineraryItem[]): ReminderWindow[] {
  if (items.length < 2) return [];
  const windows: ReminderWindow[] = [];
  for (let i = 0; i < items.length - 1; i++) {
    const item = items[i];
    const nextItem = items[i + 1];
    const departureMinutes = parseTimeToMinutes(item.plannedEndTime);
    const nextStopStartMinutes = parseTimeToMinutes(nextItem.plannedStartTime);
    const travelMins = nextItem.travelTimeFromPrevious;
    if (
      departureMinutes === null ||
      nextStopStartMinutes === null ||
      !Number.isFinite(travelMins) ||
      travelMins < 0
    ) {
      continue;
    }
    const leadMinutes = travelMins + REMINDER_BUFFER_MINUTES;
    const soonTime = departureMinutes - leadMinutes;
    if (soonTime < 0) continue;
    windows.push({
      stopIndex: i,
      currentStopName: item.attraction.name,
      nextStopName: nextItem.attraction.name,
      soonTime,
      departureTime: departureMinutes,
      nextStopStartMinutes,
    });
  }
  return windows;
}

function getActiveBanner(
  simTimeMinutes: number,
  windows: ReminderWindow[]
): ActiveBanner | null {
  for (const w of windows) {
    if (simTimeMinutes >= w.soonTime && simTimeMinutes < w.departureTime) {
      return {
        key: `${w.stopIndex}-soon`,
        type: "soon",
        window: w,
        minutesUntilDeparture: w.departureTime - simTimeMinutes,
      };
    }
    if (simTimeMinutes >= w.departureTime && simTimeMinutes < w.nextStopStartMinutes) {
      return {
        key: `${w.stopIndex}-now`,
        type: "now",
        window: w,
        minutesUntilDeparture: 0,
      };
    }
  }
  return null;
}

function getStopStatus(
  item: ItineraryItem,
  simTimeMinutes: number
): "done" | "current" | "upcoming" {
  const startMin = parseTimeToMinutes(item.plannedStartTime);
  const endMin = parseTimeToMinutes(item.plannedEndTime);
  if (startMin === null || endMin === null) return "upcoming";
  if (simTimeMinutes >= endMin) return "done";
  if (simTimeMinutes >= startMin) return "current";
  return "upcoming";
}

function formatScore(score: number) {
  return `${Math.round(score * 100)}% match`;
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function formatStatus(status: GeneratedItinerary["feasibilityStatus"]) {
  if (status === "partial") return "Partial";
  if (status === "infeasible") return "Infeasible";
  return "Feasible";
}

function getStatusTone(status: GeneratedItinerary["feasibilityStatus"]) {
  if (status === "feasible") return "emerald";
  if (status === "partial") return "amber";
  return "slate";
}

function formatAdaptationStatus(status: ItineraryAdaptation["feasibilityStatus"]) {
  if (status === "adjusted") return "Adjusted";
  if (status === "not_feasible") return "Not feasible";
  return "Feasible";
}

function getAdaptationStatusTone(status: ItineraryAdaptation["feasibilityStatus"]) {
  if (status === "feasible") return "emerald";
  if (status === "adjusted") return "amber";
  return "slate";
}

function getAdaptationTitle(adaptation: ItineraryAdaptation) {
  const trafficSim = adaptation.trafficSimulation;

  if (trafficSim?.status === "blocked_reoptimized") {
    return "Route blocked — itinerary automatically updated";
  }
  if (trafficSim?.enabled && trafficSim.severity === "heavy") {
    return "Simulated heavy traffic delay detected";
  }
  if (trafficSim?.enabled && trafficSim.severity === "moderate") {
    return "Simulated moderate traffic delay applied";
  }

  const hasWeatherAdjustment =
    (adaptation.affectedAttractions?.length ?? 0) > 0 ||
    (adaptation.replacedAttractions?.length ?? 0) > 0;
  const hasScheduleAdjustment = (adaptation.removedAttractions?.length ?? 0) > 0;

  if (hasWeatherAdjustment && hasScheduleAdjustment) return "Real-time adjustment applied";
  if (hasWeatherAdjustment) return "Weather-aware adjustment applied";
  if (hasScheduleAdjustment) return "Schedule optimized to fit your available time";
  return "No real-time adjustment needed";
}

function AdaptationCard({ adaptation }: { adaptation: ItineraryAdaptation }) {
  const removedAttractions = adaptation.removedAttractions ?? [];
  const replacedAttractions = adaptation.replacedAttractions ?? [];
  const affectedAttractions = adaptation.affectedAttractions ?? [];

  return (
    <aside
      className={`adaptation-panel${adaptation.applied ? " adaptation-panel-active" : ""}`}
      aria-label="Real-time adaptation summary"
    >
      <div className="adaptation-panel-top">
        <div>
          <p className="attraction-category">Real-time adaptation</p>
          <h3>{getAdaptationTitle(adaptation)}</h3>
        </div>
        {adaptation.feasibilityStatus ? (
          <Badge tone={getAdaptationStatusTone(adaptation.feasibilityStatus)}>
            {formatAdaptationStatus(adaptation.feasibilityStatus)}
          </Badge>
        ) : null}
      </div>

      {adaptation.weatherCondition ? (
        <p className="adaptation-weather">
          {toTitleCase(adaptation.weatherCondition)} detected.
        </p>
      ) : null}

      {adaptation.reasons.length > 0 ? (
        <ul className="adaptation-list">
          {adaptation.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}

      {removedAttractions.length > 0 ? (
        <div className="adaptation-detail-group">
          <strong>Removed attractions</strong>
          <ul>
            {removedAttractions.map((attraction) => (
              <li key={attraction.id}>
                Removed: {attraction.name} - {attraction.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {replacedAttractions.length > 0 ? (
        <div className="adaptation-detail-group">
          <strong>Replaced attractions</strong>
          <ul>
            {replacedAttractions.map((replacement) => (
              <li key={`${replacement.removed.id}-${replacement.replacement.id}`}>
                {replacement.removed.name} replaced with{" "}
                {replacement.replacement.name} - {replacement.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {affectedAttractions.length > 0 ? (
        <div className="adaptation-detail-group">
          <strong>Affected attractions</strong>
          <ul>
            {affectedAttractions.map((attraction) => (
              <li key={attraction.id}>
                {attraction.name} - {attraction.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {adaptation.trafficSimulation?.enabled ? (
        <div className="adaptation-detail-group adaptation-traffic-detail">
          <strong>Traffic simulation details</strong>
          <ul>
            <li>Severity: {toTitleCase(adaptation.trafficSimulation.severity)}</li>
            {adaptation.trafficSimulation.affectedSegment.from ? (
              <li>
                Affected segment:{" "}
                {adaptation.trafficSimulation.affectedSegment.from} →{" "}
                {adaptation.trafficSimulation.affectedSegment.to}
              </li>
            ) : null}
            {adaptation.trafficSimulation.addedDelayMinutes > 0 ? (
              <li>
                Added delay: {adaptation.trafficSimulation.addedDelayMinutes} min
                (original {adaptation.trafficSimulation.originalLegTravelTime} min →{" "}
                {adaptation.trafficSimulation.simulatedLegTravelTime} min)
              </li>
            ) : null}
            <li>
              Status:{" "}
              {toTitleCase(adaptation.trafficSimulation.status.replace(/_/g, " "))}
            </li>
          </ul>
        </div>
      ) : null}
    </aside>
  );
}

// Shared panel: summary stats + adaptation + map + clock + stop list.
// Used for both single-day display and inside expanded day cards.
// Clock state is local — unmounts naturally when a day card closes, resetting on re-open.
function ItineraryDetailPanel({
  itinerary,
  adaptation,
  updateDayError,
  onAttractionClick,
}: {
  itinerary: GeneratedItinerary;
  adaptation: ItineraryAdaptation | null;
  updateDayError: string | null;
  onAttractionClick: (attraction: Attraction) => void;
}) {
  const items = itinerary.items;
  const rangeMin =
    parseTimeToMinutes(items[0]?.plannedStartTime ?? "09:00") ?? 9 * 60;
  const rangeMax =
    parseTimeToMinutes(items[items.length - 1]?.plannedEndTime ?? "18:00") ?? 18 * 60;

  const [simTimeMinutes, setSimTimeMinutes] = useState(rangeMin);
  const [isPlaying, setIsPlaying] = useState(false);
  const [dismissedBannerKeys, setDismissedBannerKeys] = useState<Set<string>>(
    new Set()
  );
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reset clock whenever the itinerary data changes (new generation, Update Day, etc.)
  useEffect(() => {
    const newMin =
      parseTimeToMinutes(itinerary.items[0]?.plannedStartTime ?? "09:00") ?? 9 * 60;
    setSimTimeMinutes(newMin);
    setIsPlaying(false);
    setDismissedBannerKeys(new Set());
    if (playIntervalRef.current) {
      clearInterval(playIntervalRef.current);
      playIntervalRef.current = null;
    }
  }, [itinerary]); // eslint-disable-line react-hooks/exhaustive-deps

  // Drive the simulated clock forward at SIM_TICK_MS per simulated minute
  useEffect(() => {
    if (playIntervalRef.current) {
      clearInterval(playIntervalRef.current);
      playIntervalRef.current = null;
    }
    if (!isPlaying) return;
    playIntervalRef.current = setInterval(() => {
      setSimTimeMinutes((prev) => {
        const next = prev + 1;
        if (next >= rangeMax) {
          setIsPlaying(false);
          return rangeMax;
        }
        return next;
      });
    }, SIM_TICK_MS);
    return () => {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
        playIntervalRef.current = null;
      }
    };
  }, [isPlaying, rangeMax]);

  const reminderWindows = useMemo(() => computeReminderWindows(items), [items]);
  const rawBanner = getActiveBanner(simTimeMinutes, reminderWindows);
  const activeBanner =
    rawBanner && !dismissedBannerKeys.has(rawBanner.key) ? rawBanner : null;

  const sliderFillPct =
    rangeMax > rangeMin
      ? Math.round(((simTimeMinutes - rangeMin) / (rangeMax - rangeMin)) * 100)
      : 0;

  function dismissBanner(key: string) {
    setDismissedBannerKeys((prev) => new Set([...prev, key]));
  }

  return (
    <>
      {updateDayError ? (
        <div className="form-error" role="alert">
          <strong>Update failed</strong>
          <p>{updateDayError}</p>
        </div>
      ) : null}

      <div className="itinerary-summary-grid" aria-label="Itinerary summary">
        <div>
          <span>Total duration</span>
          <strong>{itinerary.totalDuration} min</strong>
        </div>
        <div>
          <span>Visit time</span>
          <strong>{itinerary.totalVisitTime} min</strong>
        </div>
        <div>
          <span>Travel time</span>
          <strong>{itinerary.totalTravelTime} min</strong>
        </div>
        <div>
          <span>Status</span>
          <Badge tone={getStatusTone(itinerary.feasibilityStatus)}>
            {formatStatus(itinerary.feasibilityStatus)}
          </Badge>
        </div>
      </div>

      {adaptation?.recommendationSource === "fallback" ? (
        <p className="recommendation-source-note">Fallback recommendations</p>
      ) : null}

      {adaptation ? <AdaptationCard adaptation={adaptation} /> : null}

      {items.length === 0 ? (
        <div className="state-panel">
          <h3>No feasible itinerary found</h3>
          <p>The selected travel window is too short for the ranked attractions.</p>
        </div>
      ) : (
        <>
          <ItineraryMap
            key={buildMapKey(itinerary)}
            items={items}
            routeGeometry={itinerary.routeGeometry}
            routing={itinerary.routing}
            transportMode={itinerary.transportMode}
          />

          {/* ── Simulated trip clock ── */}
          <div className="trip-clock" aria-label="Simulated trip clock">
            <div className="trip-clock-header">
              <span className="trip-clock-label">Simulated clock</span>
              <span
                className="trip-clock-time"
                aria-live="polite"
                aria-atomic="true"
              >
                {minutesToTimeStr(simTimeMinutes)}
              </span>
            </div>
            <div className="trip-clock-controls">
              <button
                type="button"
                className="trip-clock-play-btn"
                onClick={() => setIsPlaying((p) => !p)}
                aria-label={isPlaying ? "Pause trip clock" : "Play trip clock"}
              >
                {isPlaying ? (
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 11 11"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <rect x="0.5" y="0.5" width="3.5" height="10" rx="1" />
                    <rect x="7" y="0.5" width="3.5" height="10" rx="1" />
                  </svg>
                ) : (
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 11 11"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M1.5 0.5L10.5 5.5L1.5 10.5V0.5Z" />
                  </svg>
                )}
              </button>
              <input
                type="range"
                className="trip-clock-slider"
                min={rangeMin}
                max={rangeMax}
                value={simTimeMinutes}
                step={1}
                style={{ "--fill": `${sliderFillPct}%` } as React.CSSProperties}
                onChange={(e) => {
                  setIsPlaying(false);
                  setSimTimeMinutes(Number(e.target.value));
                }}
                aria-label="Trip time scrubber"
                aria-valuenow={simTimeMinutes}
                aria-valuemin={rangeMin}
                aria-valuemax={rangeMax}
                aria-valuetext={minutesToTimeStr(simTimeMinutes)}
              />
              <span className="trip-clock-speed" aria-hidden="true">
                ×20
              </span>
            </div>
          </div>

          {/* ── Active leave-reminder banner ── */}
          {activeBanner ? (
            <div
              key={activeBanner.key}
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className={`trip-banner trip-banner-${activeBanner.type}`}
            >
              <div className="trip-banner-top">
                <p className="trip-banner-text">
                  {activeBanner.type === "soon"
                    ? `Time to move soon — wrap up at ${activeBanner.window.currentStopName} and head to ${activeBanner.window.nextStopName} in about ${activeBanner.minutesUntilDeparture} min.`
                    : `Head to ${activeBanner.window.nextStopName} now.`}
                </p>
                <button
                  type="button"
                  className="trip-banner-dismiss"
                  onClick={() => dismissBanner(activeBanner.key)}
                  aria-label="Dismiss reminder"
                >
                  ×
                </button>
              </div>
            </div>
          ) : null}

          {/* ── Stop list with clock-driven status ── */}
          <div className="itinerary-list">
            {items.map((item, index) => {
              const imageSrc =
                item.attraction.thumbnail_url ?? item.attraction.image_url ?? null;
              const placeholderClass = getItineraryPlaceholderClass(
                item.attraction.category
              );
              const nextStop =
                index < items.length - 1 ? items[index + 1] : null;
              const reminderTime = nextStop
                ? computeReminderTime(item.plannedEndTime)
                : null;
              const stopStatus = getStopStatus(item, simTimeMinutes);

              return (
                <button
                  type="button"
                  className={`itinerary-card itinerary-card-clickable${
                    stopStatus !== "upcoming" ? ` itinerary-card-${stopStatus}` : ""
                  }`}
                  key={item.attraction.id}
                  onClick={() => onAttractionClick(item.attraction)}
                  aria-label={`View details for ${item.attraction.name}`}
                >
                  {imageSrc ? (
                    <div className="itinerary-card-image">
                      <Image
                        src={imageSrc}
                        alt={item.attraction.name}
                        fill
                        sizes="(max-width: 760px) 100vw, 640px"
                        style={{ objectFit: "cover" }}
                        unoptimized={isWikimediaUrl(imageSrc)}
                        onError={(e) => {
                          const target = e.currentTarget as HTMLImageElement;
                          target.style.display = "none";
                          const parent = target.parentElement;
                          if (parent) {
                            parent.classList.remove(
                              ...Array.from(parent.classList).filter(
                                (c) => c !== "itinerary-card-image"
                              )
                            );
                            parent.classList.add(
                              "itinerary-card-image",
                              placeholderClass
                            );
                            const label = document.createElement("span");
                            label.className = "attraction-placeholder-label";
                            label.textContent = toTitleCase(item.attraction.category);
                            parent.appendChild(label);
                          }
                        }}
                      />
                    </div>
                  ) : (
                    <div className={`itinerary-card-image ${placeholderClass}`}>
                      <span className="attraction-placeholder-label">
                        {toTitleCase(item.attraction.category)}
                      </span>
                    </div>
                  )}

                  <div className="itinerary-card-top">
                    <div>
                      <p className="attraction-category">
                        Stop {index + 1} - {toTitleCase(item.attraction.category)}
                      </p>
                      <h3>{item.attraction.name}</h3>
                    </div>
                    <span className="rating-pill">{formatScore(item.score)}</span>
                  </div>

                  <p className="itinerary-reason">{item.reason}</p>

                  <div className="badge-row">
                    <Badge tone="blue">{toTitleCase(item.attraction.category)}</Badge>
                    <Badge tone="emerald">
                      {item.plannedStartTime} - {item.plannedEndTime}
                    </Badge>
                    <Badge tone="slate">
                      Visit {item.attraction.estimated_visit_duration} min
                    </Badge>
                  </div>

                  {reminderTime && nextStop ? (
                    <p
                      className="itinerary-leave-reminder"
                      aria-label={`Leave reminder at ${reminderTime}: prepare to head to ${nextStop.attraction.name}`}
                    >
                      Leave reminder · {reminderTime} — Prepare to head to{" "}
                      {nextStop.attraction.name}
                    </p>
                  ) : null}

                  <dl className="itinerary-meta">
                    <div>
                      <dt>Travel from previous</dt>
                      <dd>
                        {item.travelTimeFromPrevious === 0
                          ? "0 min"
                          : item.legTransport
                            ? `${item.legTransport === "walking" ? "Walk" : "Drive"} · ${item.travelTimeFromPrevious} min`
                            : `${item.travelTimeFromPrevious} min`}
                      </dd>
                    </div>
                    <div>
                      <dt>Planned time</dt>
                      <dd>
                        {item.plannedStartTime} - {item.plannedEndTime}
                      </dd>
                    </div>
                  </dl>
                </button>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}

function DayPlanCard({
  day,
  isOpen,
  isActive,
  isUpdating,
  updateProgress,
  updateError,
  onOpen,
  onAttractionClick,
}: {
  day: ItineraryDayPlan;
  isOpen: boolean;
  isActive: boolean;
  isUpdating: boolean;
  updateProgress: string | null;
  updateError: string | null;
  onOpen: () => void;
  onAttractionClick: (attraction: Attraction) => void;
}) {
  const stopCount = day.itinerary.items.length;
  const duration = day.itinerary.totalDuration;
  const transport = day.generatedPreferences.transportMode;

  return (
    <div className={`day-plan-card${isOpen ? " day-plan-card-open" : ""}`} data-day-number={day.dayNumber}>
      <button
        type="button"
        className="day-plan-card-header"
        onClick={onOpen}
        aria-expanded={isOpen}
      >
        <div className="day-plan-card-header-main">
          <span className="day-plan-card-label">Day {day.dayNumber} Plan</span>
          <span className="day-plan-card-meta">
            {stopCount} stop{stopCount !== 1 ? "s" : ""}
            {duration > 0 ? ` · ${formatDuration(duration)}` : ""}
            {transport ? ` · ${capitalize(transport)}` : ""}
          </span>
        </div>

        <span className="day-plan-card-side">
          {isActive && isUpdating && updateProgress ? (
            <span className="day-plan-updating" aria-live="polite">
              <span className="mini-spinner" aria-hidden="true" />
              <span>{updateProgress}</span>
            </span>
          ) : (
            <span
              className={`day-plan-chevron${isOpen ? " day-plan-chevron-open" : ""}`}
              aria-hidden="true"
            />
          )}
        </span>
      </button>

      {isOpen ? (
        <div className="day-plan-card-body">
          <ItineraryDetailPanel
            itinerary={day.itinerary}
            adaptation={day.adaptation}
            updateDayError={updateError}
            onAttractionClick={onAttractionClick}
          />
        </div>
      ) : null}
    </div>
  );
}

export function ItineraryResult({
  adaptation,
  days,
  itinerary,
  activeDayIndex,
  expandedDayIndex,
  onDayCardClick,
  isUpdatingDay,
  isExtendingDays,
  updateDayProgress,
  updateDayError,
  isGenerating,
  generationProgress,
}: ItineraryResultProps) {
  const [selectedAttraction, setSelectedAttraction] = useState<Attraction | null>(null);
  const [modalImages, setModalImages] = useState<AttractionImage[]>([]);
  const [modalImagesLoading, setModalImagesLoading] = useState(false);
  const imageCache = useRef<Map<number, AttractionImage[]>>(new Map());

  const isMultiDay = (days?.length ?? 0) > 1;
  const visibleActiveDayIndex =
    isMultiDay && days ? Math.min(activeDayIndex, days.length - 1) : 0;
  const activeDay = isMultiDay && days ? days[visibleActiveDayIndex] : null;
  const displayedItinerary = activeDay?.itinerary ?? itinerary;
  const displayedAdaptation = activeDay?.adaptation ?? adaptation;

  const handleCardClick = useCallback(
    async (attraction: Attraction) => {
      setSelectedAttraction(attraction);

      if (imageCache.current.has(attraction.id)) {
        setModalImages(imageCache.current.get(attraction.id)!);
        setModalImagesLoading(false);
        return;
      }

      setModalImages([]);
      setModalImagesLoading(true);
      try {
        const res = await fetch(`/api/attractions/${attraction.id}/images`);
        const data = (await res.json()) as ImagesResponse;
        const imgs = data.success ? data.data : [];
        imageCache.current.set(attraction.id, imgs);
        setModalImages(imgs);
      } catch {
        setModalImages([]);
      } finally {
        setModalImagesLoading(false);
      }
    },
    []
  );

  const handleModalClose = useCallback(() => {
    setSelectedAttraction(null);
  }, []);

  // Loading state: no plan yet but generation is in progress
  if (!displayedItinerary) {
    if (isGenerating) {
      return (
        <section className="itinerary-section">
          <SectionHeader
            eyebrow="Generated itinerary"
            title="Recommended route"
            description="Ranked attractions fitted to the selected travel window."
          />
          <ItineraryLoader
            message={generationProgress ?? "Generating your itinerary..."}
          />
        </section>
      );
    }

    return (
      <div className="state-panel itinerary-empty-state">
        <p className="itinerary-empty-eyebrow">Your itinerary</p>
        <h3>Ready to plan your day?</h3>
        <p>
          Choose your interests on the left and click{" "}
          <strong>Generate itinerary</strong> to build your personalized
          Sarajevo route.
        </p>
      </div>
    );
  }

  return (
    <section className="itinerary-section">
      <SectionHeader
        eyebrow="Generated itinerary"
        title="Recommended route"
        description="Ranked attractions fitted to the selected travel window."
      />

      {isMultiDay && days ? (
        <>
          <div className="day-plan-cards">
            {days.map((day, index) => (
              <DayPlanCard
                key={day.dayNumber}
                day={day}
                isOpen={index === expandedDayIndex}
                isActive={index === visibleActiveDayIndex}
                isUpdating={isUpdatingDay && !isExtendingDays}
                updateProgress={updateDayProgress}
                updateError={
                  index === visibleActiveDayIndex ? updateDayError : null
                }
                onOpen={() => onDayCardClick(index)}
                onAttractionClick={handleCardClick}
              />
            ))}
          </div>

          {isExtendingDays && updateDayProgress ? (
            <div className="day-plan-extension-status" aria-live="polite">
              <span className="mini-spinner" aria-hidden="true" />
              <span>{updateDayProgress}</span>
            </div>
          ) : null}
        </>
      ) : (
        // Single-day: render detail panel directly
        <ItineraryDetailPanel
          itinerary={displayedItinerary}
          adaptation={displayedAdaptation}
          updateDayError={updateDayError}
          onAttractionClick={handleCardClick}
        />
      )}

      <AttractionDetailsModal
        attraction={selectedAttraction}
        images={modalImages}
        imagesLoading={modalImagesLoading}
        onClose={handleModalClose}
      />
    </section>
  );
}
