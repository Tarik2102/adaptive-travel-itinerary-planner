import { Badge } from "@/components/Badge";
import { SectionHeader } from "@/components/SectionHeader";
import type { GeneratedItinerary } from "@/types/itinerary";

type ItineraryResultProps = {
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

export function ItineraryResult({ itinerary }: ItineraryResultProps) {
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
