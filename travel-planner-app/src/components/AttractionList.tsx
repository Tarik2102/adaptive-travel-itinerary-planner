"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AttractionCard } from "@/components/AttractionCard";
import { AttractionSkeletonGrid } from "@/components/Loader";
import { SectionHeader } from "@/components/SectionHeader";
import type { Attraction } from "@/types/attraction";

const MAX_PER_CATEGORY = 4;

type AttractionsResponse =
  | {
      success: true;
      data: Attraction[];
    }
  | {
      success: false;
      error?: string;
    };

function toTitleCase(value: string) {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function getCategoryLabel(attraction: Attraction): string {
  const raw = attraction.primary_category ?? attraction.category ?? "Other";
  return toTitleCase(raw);
}

export function AttractionList() {
  const [attractions, setAttractions] = useState<Attraction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAttractions = useCallback(async () => {
    await Promise.resolve();

    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/attractions");

      if (!response.ok) {
        throw new Error("Failed to fetch attractions");
      }

      const result = (await response.json()) as AttractionsResponse;

      if (!result.success) {
        throw new Error(result.error || "Failed to fetch attractions");
      }

      setAttractions(Array.isArray(result.data) ? result.data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void fetchAttractions();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [fetchAttractions]);

  const groupedAttractions = useMemo(() => {
    const groups = new Map<string, { preview: Attraction[]; total: number }>();
    for (const attraction of attractions) {
      const label = getCategoryLabel(attraction);
      if (!groups.has(label)) groups.set(label, { preview: [], total: 0 });
      const group = groups.get(label)!;
      group.total += 1;
      if (group.preview.length < MAX_PER_CATEGORY) {
        group.preview.push(attraction);
      }
    }
    return Array.from(groups.entries());
  }, [attractions]);

  return (
    <section className="attractions-section">
      <SectionHeader
        eyebrow="Explore Sarajevo"
        title="Sarajevo Highlights"
        description="A curated sample of top attractions by category. The full dataset powers your itinerary."
      />

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
          {groupedAttractions.map(([category, { preview, total }]) => (
            <div className="attractions-category-group" key={category}>
              <div className="attractions-category-heading">
                <span className="attractions-category-name">{category}</span>
                {total > MAX_PER_CATEGORY ? (
                  <span className="attractions-category-count">
                    {MAX_PER_CATEGORY} of {total}
                  </span>
                ) : null}
              </div>
              <div className="attraction-grid">
                {preview.map((attraction) => (
                  <AttractionCard attraction={attraction} key={attraction.id} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
