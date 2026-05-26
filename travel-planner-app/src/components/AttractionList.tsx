"use client";

import { useCallback, useEffect, useState } from "react";
import { AttractionCard } from "@/components/AttractionCard";
import { AttractionSkeletonGrid } from "@/components/Loader";
import { SectionHeader } from "@/components/SectionHeader";
import type { Attraction } from "@/types/attraction";

type AttractionsResponse =
  | {
      success: true;
      data: Attraction[];
    }
  | {
      success: false;
      error?: string;
    };

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

  return (
    <section className="attractions-section">
      <SectionHeader
        eyebrow="Live attraction data"
        title="Available Sarajevo attractions"
        description="Cards below are loaded from the existing attractions API without changing backend logic."
      />

      {loading ? (
        <>
          <p className="state-copy">Loading attractions from the database...</p>
          <AttractionSkeletonGrid />
        </>
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
        <div className="attraction-grid">
          {attractions.map((attraction) => (
            <AttractionCard attraction={attraction} key={attraction.id} />
          ))}
        </div>
      )}
    </section>
  );
}
