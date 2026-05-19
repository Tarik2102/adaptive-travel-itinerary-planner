import type { Attraction } from "@/types/attraction";
import { Badge } from "@/components/Badge";

type AttractionCardProps = {
  attraction: Attraction;
};

function toTitleCase(value: string) {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function formatOptionalLabel(value: string | null) {
  return value ? toTitleCase(value) : "Not specified";
}

function formatPriceLevel(value: string | null) {
  if (!value) {
    return "Price N/A";
  }

  if (value.toLowerCase() === "free") {
    return "Free";
  }

  return `${toTitleCase(value)} price`;
}

function formatTime(value: string | null) {
  if (!value) {
    return null;
  }

  const [hour, minute] = value.split(":");

  if (!hour || !minute) {
    return value;
  }

  return `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
}

function formatHours(openingTime: string | null, closingTime: string | null) {
  const opening = formatTime(openingTime);
  const closing = formatTime(closingTime);

  if (!opening || !closing) {
    return "Hours unavailable";
  }

  return `${opening} - ${closing}`;
}

function getPriceTone(priceLevel: string | null) {
  if (!priceLevel || priceLevel.toLowerCase() === "free") {
    return "emerald";
  }

  return priceLevel.toLowerCase() === "high" ? "amber" : "blue";
}

function getTypeTone(type: string | null) {
  return type?.toLowerCase() === "outdoor" ? "emerald" : "slate";
}

export function AttractionCard({ attraction }: AttractionCardProps) {
  const description =
    attraction.description?.trim() || "No description is available yet.";
  const rating =
    attraction.rating === null ? null : Number(attraction.rating).toFixed(1);

  return (
    <article className="attraction-card">
      <div className="attraction-card-top">
        <div>
          <p className="attraction-category">
            {toTitleCase(attraction.category)}
          </p>
          <h3>{attraction.name}</h3>
        </div>

        {rating ? <span className="rating-pill">Rating {rating}</span> : null}
      </div>

      <p className="attraction-description">{description}</p>

      <div className="badge-row" aria-label="Attraction details">
        <Badge tone="blue">{toTitleCase(attraction.category)}</Badge>
        <Badge tone={getPriceTone(attraction.price_level)}>
          {formatPriceLevel(attraction.price_level)}
        </Badge>
        <Badge tone={getTypeTone(attraction.indoor_outdoor)}>
          {formatOptionalLabel(attraction.indoor_outdoor)}
        </Badge>
      </div>

      <dl className="attraction-meta">
        <div>
          <dt>Visit</dt>
          <dd>{attraction.estimated_visit_duration} min</dd>
        </div>
        <div>
          <dt>Open</dt>
          <dd>{formatHours(attraction.opening_time, attraction.closing_time)}</dd>
        </div>
      </dl>
    </article>
  );
}
