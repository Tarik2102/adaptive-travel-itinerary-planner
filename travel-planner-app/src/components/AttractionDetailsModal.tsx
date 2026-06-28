"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import type { Attraction, AttractionImage } from "@/types/attraction";
import { isGenericDescription, truncateClean } from "@/lib/interestFilter";

type Props = {
  attraction: Attraction | null;
  images: AttractionImage[];
  imagesLoading: boolean;
  onClose: () => void;
};

function toTitleCase(value: string) {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function isWikimediaUrl(url: string): boolean {
  return url.startsWith("https://upload.wikimedia.org/");
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

// Removes any trailing U+2026 ellipsis written by the DB enrichment scripts
// so the modal always shows clean text rather than an enrichment artifact.
function stripEllipsis(text: string | null | undefined): string | null {
  const t = text?.trim();
  if (!t) return null;
  return t.endsWith("…") ? t.slice(0, -1).trimEnd() : t;
}

function formatTime(value: string | null) {
  if (!value) return null;
  const [hour, minute] = value.split(":");
  if (!hour || !minute) return value;
  return `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
}

type GalleryItem = { src: string; alt: string; attribution?: string | null };

export function AttractionDetailsModal({ attraction, images, imagesLoading, onClose }: Props) {
  const [imgIndex, setImgIndex] = useState(0);
  const [descExpanded, setDescExpanded] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const prevFocusRef = useRef<Element | null>(null);
  const isOpen = attraction !== null;

  // Build gallery from API images, falling back to primary image on the attraction
  const gallery: GalleryItem[] = [];
  if (!imagesLoading && attraction) {
    if (images.length > 0) {
      for (const img of images) {
        gallery.push({ src: img.image_url, alt: img.title ?? attraction.name, attribution: img.attribution });
      }
    } else {
      const primary = attraction.image_url ?? attraction.thumbnail_url ?? null;
      if (primary) gallery.push({ src: primary, alt: attraction.name });
    }
  }

  const totalImages = gallery.length;

  useEffect(() => {
    setImgIndex(0);
    setDescExpanded(false);
  }, [attraction?.id]);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
      prevFocusRef.current = document.activeElement;
      const id = window.setTimeout(() => closeRef.current?.focus(), 40);
      return () => {
        window.clearTimeout(id);
        document.body.style.overflow = "";
      };
    } else {
      document.body.style.overflow = "";
      if (prevFocusRef.current instanceof HTMLElement) {
        prevFocusRef.current.focus();
      }
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (totalImages > 1) {
        if (e.key === "ArrowLeft") setImgIndex((i) => (i - 1 + totalImages) % totalImages);
        if (e.key === "ArrowRight") setImgIndex((i) => (i + 1) % totalImages);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose, totalImages]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  const prevImage = useCallback(() => {
    setImgIndex((i) => (i - 1 + totalImages) % totalImages);
  }, [totalImages]);

  const nextImage = useCallback(() => {
    setImgIndex((i) => (i + 1) % totalImages);
  }, [totalImages]);

  if (!attraction) return null;

  const placeholderClass = getPlaceholderClass(attraction.category);
  const currentImage = gallery[imgIndex] ?? null;
  const rating = attraction.rating === null ? null : Number(attraction.rating).toFixed(1);
  // Full text: prefer description_en; strip any trailing U+2026 enrichment artifact.
  const fullDescription =
    stripEllipsis(attraction.description_en) ??
    stripEllipsis(attraction.description) ??
    "";
  const showRealDescription =
    !!(attraction.description_en?.trim()) ||
    !!(attraction.description_source && attraction.description?.trim()) ||
    !isGenericDescription(attraction.description);
  // Collapsed preview — clean word/sentence boundary, never mid-word.
  const { preview: descPreview, truncated: descTruncated } = fullDescription
    ? truncateClean(fullDescription, 200, { preferSentence: true })
    : { preview: "", truncated: false };

  const openTime = formatTime(attraction.opening_time);
  const closeTime = formatTime(attraction.closing_time);
  const hours =
    openTime && closeTime ? `${openTime} – ${closeTime}` : openTime ?? closeTime ?? null;

  const allCats = [
    ...(attraction.primary_category ? [attraction.primary_category] : []),
    ...(Array.isArray(attraction.secondary_categories) ? attraction.secondary_categories : []),
  ].filter(Boolean);
  const uniqueCats = [...new Set(allCats.map((c) => c.toLowerCase()))];

  return (
    <div
      className="attraction-modal-overlay"
      role="presentation"
      onClick={handleOverlayClick}
    >
      <div
        className="attraction-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="attraction-modal-title"
      >
        {/* Close */}
        <button
          ref={closeRef}
          type="button"
          className="attraction-modal-close"
          onClick={onClose}
          aria-label="Close attraction details"
        >
          ✕
        </button>

        {/* Image section */}
        <div className="attraction-modal-image-section">
          {imagesLoading ? (
            <div className="attraction-modal-image-wrap attraction-modal-image-loading">
              <span className="attraction-modal-loading-text">Loading photos…</span>
            </div>
          ) : currentImage ? (
            <div className="attraction-modal-image-wrap">
              <Image
                key={currentImage.src}
                src={currentImage.src}
                alt={currentImage.alt || attraction.name}
                fill
                sizes="(max-width: 640px) 100vw, 600px"
                style={{ objectFit: "cover" }}
                unoptimized={isWikimediaUrl(currentImage.src)}
              />
              {currentImage.attribution && (
                <div className="attraction-modal-attribution">{currentImage.attribution}</div>
              )}
              {totalImages > 1 && (
                <>
                  <button
                    type="button"
                    className="attraction-modal-nav-btn attraction-modal-nav-prev"
                    onClick={prevImage}
                    aria-label="Previous photo"
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    className="attraction-modal-nav-btn attraction-modal-nav-next"
                    onClick={nextImage}
                    aria-label="Next photo"
                  >
                    ›
                  </button>
                </>
              )}
              {totalImages > 0 && (
                <div className="attraction-modal-gallery-counter" aria-live="polite">
                  {imgIndex + 1} / {totalImages}
                </div>
              )}
            </div>
          ) : (
            <div className={`attraction-modal-image-wrap ${placeholderClass}`}>
              <span className="attraction-placeholder-label">{toTitleCase(attraction.category)}</span>
            </div>
          )}
        </div>

        {/* Body */}
        <div className="attraction-modal-body">
          <div className="attraction-modal-header">
            <p className="attraction-category">
              {toTitleCase(attraction.primary_category ?? attraction.category)}
            </p>
            <h2 id="attraction-modal-title" className="attraction-modal-name">
              {attraction.name}
            </h2>
            <div className="attraction-modal-meta-row">
              {rating && <span className="rating-pill">Rating {rating}</span>}
              {attraction.estimated_visit_duration ? (
                <span className="attraction-modal-duration">
                  {attraction.estimated_visit_duration} min visit
                </span>
              ) : null}
            </div>
          </div>

          {showRealDescription ? (
            <div className="attraction-modal-description-block">
              <p className="attraction-modal-description">
                {descExpanded ? fullDescription : descPreview}
              </p>
              {descTruncated && (
                <button
                  type="button"
                  className="attraction-description-toggle"
                  aria-expanded={descExpanded}
                  onClick={() => setDescExpanded((e) => !e)}
                >
                  {descExpanded ? "Read less" : "Read more"}
                </button>
              )}
            </div>
          ) : (
            <p className="attraction-modal-description attraction-modal-description-muted">
              Detailed visitor information about this Sarajevo attraction.
            </p>
          )}

          <dl className="attraction-modal-details">
            {hours && (
              <div>
                <dt>Hours</dt>
                <dd>{hours}</dd>
              </div>
            )}
            {attraction.price_level && (
              <div>
                <dt>Price</dt>
                <dd>{toTitleCase(attraction.price_level)}</dd>
              </div>
            )}
            {attraction.indoor_outdoor && (
              <div>
                <dt>Type</dt>
                <dd>{toTitleCase(attraction.indoor_outdoor)}</dd>
              </div>
            )}
            {uniqueCats.length > 0 && (
              <div>
                <dt>Categories</dt>
                <dd>{uniqueCats.map(toTitleCase).join(", ")}</dd>
              </div>
            )}
            {Array.isArray(attraction.tags) && attraction.tags.length > 0 && (
              <div>
                <dt>Tags</dt>
                <dd>{attraction.tags.map(toTitleCase).join(", ")}</dd>
              </div>
            )}
            <div>
              <dt>Location</dt>
              <dd>
                {parseFloat(String(attraction.latitude)).toFixed(5)},{" "}
                {parseFloat(String(attraction.longitude)).toFixed(5)}
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
}
