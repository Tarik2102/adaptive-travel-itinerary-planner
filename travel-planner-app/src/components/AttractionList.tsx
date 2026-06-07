"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AttractionCard } from "@/components/AttractionCard";
import { AttractionDetailsModal } from "@/components/AttractionDetailsModal";
import { AttractionSkeletonGrid } from "@/components/Loader";
import { SectionHeader } from "@/components/SectionHeader";
import {
  INTEREST_GROUPS,
  getFilteredGroups,
  type InterestGroupId,
} from "@/lib/interestFilter";
import type { Attraction, AttractionImage } from "@/types/attraction";

const MAX_PER_DB_CATEGORY = 4;

type AttractionsResponse =
  | { success: true; data: Attraction[] }
  | { success: false; error?: string };

type ImagesResponse =
  | { success: true; data: AttractionImage[] }
  | { success: false; error?: string };

function toTitleCase(value: string) {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function getDbCategoryLabel(attraction: Attraction): string {
  return toTitleCase(attraction.primary_category ?? attraction.category ?? "Other");
}

export function AttractionList() {
  const [attractions, setAttractions] = useState<Attraction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeFilters, setActiveFilters] = useState<Set<InterestGroupId>>(new Set());

  const [selectedAttraction, setSelectedAttraction] = useState<Attraction | null>(null);
  const [modalImages, setModalImages] = useState<AttractionImage[]>([]);
  const [modalImagesLoading, setModalImagesLoading] = useState(false);
  const imageCache = useRef<Map<number, AttractionImage[]>>(new Map());

  const fetchAttractions = useCallback(async () => {
    await Promise.resolve();
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/attractions");
      if (!response.ok) throw new Error("Failed to fetch attractions");
      const result = (await response.json()) as AttractionsResponse;
      if (!result.success) throw new Error(result.error || "Failed to fetch attractions");
      setAttractions(Array.isArray(result.data) ? result.data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => void fetchAttractions(), 0);
    return () => window.clearTimeout(id);
  }, [fetchAttractions]);

  const handleCardClick = useCallback(async (attraction: Attraction) => {
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
  }, []);

  const handleModalClose = useCallback(() => {
    setSelectedAttraction(null);
  }, []);

  const toggleFilter = useCallback((id: InterestGroupId) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearFilters = useCallback(() => setActiveFilters(new Set()), []);

  // Default view: group by DB category, 4 per group
  const dbGroupedAttractions = useMemo(() => {
    const groups = new Map<string, { preview: Attraction[]; total: number }>();
    for (const attraction of attractions) {
      const label = getDbCategoryLabel(attraction);
      if (!groups.has(label)) groups.set(label, { preview: [], total: 0 });
      const group = groups.get(label)!;
      group.total += 1;
      if (group.preview.length < MAX_PER_DB_CATEGORY) group.preview.push(attraction);
    }
    return Array.from(groups.entries());
  }, [attractions]);

  // Interest-filtered view
  const filteredGroups = useMemo(
    () => getFilteredGroups(attractions, activeFilters),
    [attractions, activeFilters],
  );

  const isFiltering = activeFilters.size > 0;
  const allSelected = activeFilters.size === INTEREST_GROUPS.length;

  return (
    <section className="attractions-section">
      <SectionHeader
        eyebrow="Explore Sarajevo"
        title="Sarajevo Highlights"
        description="A curated sample of top attractions by category. The full dataset powers your itinerary."
      />

      {/* Interest filter bar */}
      <div className="highlights-filter-bar" role="group" aria-label="Filter attractions by interest">
        <span className="highlights-filter-label" aria-hidden="true">Filter</span>
        {INTEREST_GROUPS.map((group) => {
          const active = activeFilters.has(group.id);
          return (
            <button
              key={group.id}
              type="button"
              className={`highlights-filter-chip${active ? " highlights-filter-chip-active" : ""}`}
              onClick={() => toggleFilter(group.id)}
              aria-pressed={active}
            >
              {group.label}
            </button>
          );
        })}
        {isFiltering && (
          <button
            type="button"
            className="highlights-filter-clear"
            onClick={clearFilters}
            aria-label="Clear all filters"
          >
            Clear
          </button>
        )}
      </div>

      {loading ? (
        <AttractionSkeletonGrid />
      ) : error ? (
        <div className="state-panel state-panel-error">
          <h3>Attractions could not be loaded</h3>
          <p>{error}</p>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => void fetchAttractions()}
          >
            Try again
          </button>
        </div>
      ) : attractions.length === 0 ? (
        <div className="state-panel">
          <h3>No attractions found</h3>
          <p>The database returned an empty attractions list.</p>
        </div>
      ) : (
        <div className="attractions-by-category">
          {!isFiltering
            ? // Default: grouped by DB category
              dbGroupedAttractions.map(([category, { preview, total }]) => (
                <div className="attractions-category-group" key={category}>
                  <div className="attractions-category-heading">
                    <span className="attractions-category-name">{category}</span>
                    {total > MAX_PER_DB_CATEGORY ? (
                      <span className="attractions-category-count">
                        {MAX_PER_DB_CATEGORY} of {total}
                      </span>
                    ) : null}
                  </div>
                  <div className="attraction-grid">
                    {preview.map((attraction) => (
                      <AttractionCard
                        key={attraction.id}
                        attraction={attraction}
                        onClick={() => void handleCardClick(attraction)}
                      />
                    ))}
                  </div>
                </div>
              ))
            : // Filtered: grouped by interest
              filteredGroups.length === 0 ? (
                <div className="state-panel">
                  <h3>No matching attractions</h3>
                  <p>No attractions matched the selected interests. Try a different filter.</p>
                </div>
              ) : (
                filteredGroups.map(({ label, items, total }) => (
                  <div className="attractions-category-group" key={label}>
                    <div className="attractions-category-heading">
                      <span className="attractions-category-name">{label}</span>
                      {total > items.length ? (
                        <span className="attractions-category-count">
                          {items.length} of {total}
                          {allSelected && " (top 4)"}
                        </span>
                      ) : (
                        <span className="attractions-category-count">{total}</span>
                      )}
                    </div>
                    <div className="attraction-grid">
                      {items.map((attraction) => (
                        <AttractionCard
                          key={attraction.id}
                          attraction={attraction}
                          onClick={() => void handleCardClick(attraction)}
                        />
                      ))}
                    </div>
                  </div>
                ))
              )}
        </div>
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
