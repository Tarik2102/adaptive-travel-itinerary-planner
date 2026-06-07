import Image from "next/image";
import type { Attraction } from "@/types/attraction";
import { Badge } from "@/components/Badge";
import { getDisplayDescription } from "@/lib/interestFilter";

type AttractionCardProps = {
  attraction: Attraction;
  onClick?: () => void;
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
  if (!value) return "Price N/A";
  if (value.toLowerCase() === "free") return "Free";
  return `${toTitleCase(value)} price`;
}

function formatTime(value: string | null) {
  if (!value) return null;
  const [hour, minute] = value.split(":");
  if (!hour || !minute) return value;
  return `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
}

function formatHours(openingTime: string | null, closingTime: string | null) {
  const opening = formatTime(openingTime);
  const closing = formatTime(closingTime);
  if (!opening || !closing) return "Hours unavailable";
  return `${opening} - ${closing}`;
}

function getPriceTone(priceLevel: string | null) {
  if (!priceLevel || priceLevel.toLowerCase() === "free") return "emerald";
  return priceLevel.toLowerCase() === "high" ? "amber" : "blue";
}

function getTypeTone(type: string | null) {
  return type?.toLowerCase() === "outdoor" ? "emerald" : "slate";
}

function getPlaceholderClass(category: string): string {
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

export function AttractionCard({ attraction, onClick }: AttractionCardProps) {
  const description = getDisplayDescription(attraction);
  const placeholderClass = getPlaceholderClass(attraction.category);
  const imageSrc = attraction.thumbnail_url ?? attraction.image_url ?? null;

  const cardContent = (
    <>
      <div className={`attraction-card-image ${!imageSrc ? placeholderClass : ""}`}>
        {imageSrc ? (
          <Image
            src={imageSrc}
            alt={attraction.name}
            fill
            sizes="(max-width: 760px) 100vw, 50vw"
            style={{ objectFit: "cover" }}
            unoptimized={isWikimediaUrl(imageSrc)}
            onError={(e) => {
              const target = e.currentTarget as HTMLImageElement;
              target.style.display = "none";
              const parent = target.parentElement;
              if (parent) {
                parent.classList.add(placeholderClass);
                const label = document.createElement("span");
                label.className = "attraction-placeholder-label";
                label.textContent = toTitleCase(attraction.category);
                parent.appendChild(label);
              }
            }}
          />
        ) : (
          <span className="attraction-placeholder-label">
            {toTitleCase(attraction.category)}
          </span>
        )}
      </div>

      <div className="attraction-card-top">
        <div>
          <p className="attraction-category">{toTitleCase(attraction.category)}</p>
          <h3>{attraction.name}</h3>
        </div>
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

      {onClick && (
        <div className="attraction-card-view-hint" aria-hidden="true">
          View details →
        </div>
      )}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className="attraction-card attraction-card-interactive"
        onClick={onClick}
        aria-label={`View details for ${attraction.name}`}
      >
        {cardContent}
      </button>
    );
  }

  return <article className="attraction-card">{cardContent}</article>;
}
