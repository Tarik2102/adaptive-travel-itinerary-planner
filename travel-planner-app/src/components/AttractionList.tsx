"use client";

import { useEffect, useState } from "react";
import type { Attraction } from "@/types/attraction";

export function AttractionList() {
  const [attractions, setAttractions] = useState<Attraction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function fetchAttractions() {
      try {
        const response = await fetch("/api/attractions");

        if (!response.ok) {
          throw new Error("Failed to fetch attractions");
        }

        const result = await response.json();

        if (!result.success) {
          throw new Error(result.error || "Failed to fetch attractions");
        }

        setAttractions(result.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }

    fetchAttractions();
  }, []);

  if (loading) {
    return <p>Loading attractions...</p>;
  }

  if (error) {
    return <p style={{ color: "red" }}>Error: {error}</p>;
  }

  if (attractions.length === 0) {
    return <p>No attractions found in the database yet.</p>;
  }

  return (
    <section>
      <h2>Available Attractions</h2>

      <div style={{ display: "grid", gap: "1rem", marginTop: "1rem" }}>
        {attractions.map((attraction) => (
          <article
            key={attraction.id}
            style={{
              border: "1px solid #ddd",
              borderRadius: "8px",
              padding: "1rem",
            }}
          >
            <h3>{attraction.name}</h3>

            <p>{attraction.description}</p>

            <p>
              <strong>Category:</strong> {attraction.category}
            </p>

            <p>
              <strong>Duration:</strong>{" "}
              {attraction.estimated_visit_duration} minutes
            </p>

            <p>
              <strong>Price:</strong> {attraction.price_level || "N/A"}
            </p>

            <p>
              <strong>Type:</strong> {attraction.indoor_outdoor || "N/A"}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}