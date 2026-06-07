"use client";

import { useCallback, useRef, useState } from "react";
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

// Shared panel: summary stats + adaptation + map + stop list.
// Used for both single-day display and inside expanded day cards.
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

      {itinerary.items.length === 0 ? (
        <div className="state-panel">
          <h3>No feasible itinerary found</h3>
          <p>The selected travel window is too short for the ranked attractions.</p>
        </div>
      ) : (
        <>
          <ItineraryMap
            key={buildMapKey(itinerary)}
            items={itinerary.items}
            routeGeometry={itinerary.routeGeometry}
            routing={itinerary.routing}
            transportMode={itinerary.transportMode}
          />

          <div className="itinerary-list">
            {itinerary.items.map((item, index) => {
              const imageSrc =
                item.attraction.thumbnail_url ?? item.attraction.image_url ?? null;
              const placeholderClass = getItineraryPlaceholderClass(
                item.attraction.category
              );

              return (
                <button
                  type="button"
                  className="itinerary-card itinerary-card-clickable"
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
