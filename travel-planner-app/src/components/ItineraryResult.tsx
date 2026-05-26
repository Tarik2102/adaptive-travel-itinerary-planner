import { Badge } from "@/components/Badge";
import { SectionHeader } from "@/components/SectionHeader";
import type { GeneratedItinerary, ItineraryAdaptation } from "@/types/itinerary";

type ItineraryResultProps = {
  adaptation: ItineraryAdaptation | null;
  itinerary: GeneratedItinerary | null;
};

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

function formatStatus(status: GeneratedItinerary["feasibilityStatus"]) {
  if (status === "partial") {
    return "Partial";
  }

  if (status === "infeasible") {
    return "Infeasible";
  }

  return "Feasible";
}

function getStatusTone(status: GeneratedItinerary["feasibilityStatus"]) {
  if (status === "feasible") {
    return "emerald";
  }

  if (status === "partial") {
    return "amber";
  }

  return "slate";
}

function formatAdaptationStatus(
  status: ItineraryAdaptation["feasibilityStatus"]
) {
  if (status === "adjusted") {
    return "Adjusted";
  }

  if (status === "not_feasible") {
    return "Not feasible";
  }

  return "Feasible";
}

function getAdaptationStatusTone(
  status: ItineraryAdaptation["feasibilityStatus"]
) {
  if (status === "feasible") {
    return "emerald";
  }

  if (status === "adjusted") {
    return "amber";
  }

  return "slate";
}

function getAdaptationTitle(adaptation: ItineraryAdaptation) {
  const hasWeatherAdjustment =
    (adaptation.affectedAttractions?.length ?? 0) > 0 ||
    (adaptation.replacedAttractions?.length ?? 0) > 0;
  const hasScheduleAdjustment =
    (adaptation.removedAttractions?.length ?? 0) > 0;

  if (hasWeatherAdjustment && hasScheduleAdjustment) {
    return "Real-time adjustment applied";
  }

  if (hasWeatherAdjustment) {
    return "Weather-aware adjustment applied";
  }

  if (hasScheduleAdjustment) {
    return "Schedule optimized to fit your available time";
  }

  return "No real-time adjustment needed";
}

function AdaptationCard({
  adaptation,
}: {
  adaptation: ItineraryAdaptation;
}) {
  const removedAttractions = adaptation.removedAttractions ?? [];
  const replacedAttractions = adaptation.replacedAttractions ?? [];
  const affectedAttractions = adaptation.affectedAttractions ?? [];

  return (
    <aside
      className={`adaptation-panel${
        adaptation.applied ? " adaptation-panel-active" : ""
      }`}
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
    </aside>
  );
}

export function ItineraryResult({
  adaptation,
  itinerary,
}: ItineraryResultProps) {
  if (!itinerary) {
    return null;
  }

  return (
    <section className="itinerary-section">
      <SectionHeader
        eyebrow="Generated itinerary"
        title="Recommended route"
        description="Ranked attractions fitted to the selected travel window."
      />

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

      {adaptation ? <AdaptationCard adaptation={adaptation} /> : null}

      {itinerary.items.length === 0 ? (
        <div className="state-panel">
          <h3>No feasible itinerary found</h3>
          <p>
            The selected travel window is too short for the ranked attractions.
          </p>
        </div>
      ) : (
        <div className="itinerary-list">
          {itinerary.items.map((item, index) => (
            <article className="itinerary-card" key={item.attraction.id}>
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
                  <dd>{item.travelTimeFromPrevious} min</dd>
                </div>
                <div>
                  <dt>Planned time</dt>
                  <dd>
                    {item.plannedStartTime} - {item.plannedEndTime}
                  </dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
