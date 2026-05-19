"use client";

import { useState } from "react";

export function PreferenceForm() {
  const [interests, setInterests] = useState<string[]>([]);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [budgetLevel, setBudgetLevel] = useState("medium");
  const [transportMode, setTransportMode] = useState("walking");
  const [preferredPace, setPreferredPace] = useState("moderate");

  const availableInterests = [
    "history",
    "culture",
    "nature",
    "architecture",
    "religion",
    "museum",
  ];

  function toggleInterest(interest: string) {
    setInterests((previousInterests) =>
      previousInterests.includes(interest)
        ? previousInterests.filter((item) => item !== interest)
        : [...previousInterests, interest]
    );
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const preferences = {
      interests,
      startTime,
      endTime,
      budgetLevel,
      transportMode,
      preferredPace,
    };

    console.log("Submitted preferences:", preferences);

    alert("Preference form works. Recommendation will be added in Week 2.");
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        border: "1px solid #ddd",
        borderRadius: "8px",
        padding: "1rem",
        marginBottom: "2rem",
      }}
    >
      <h2>Plan Your Trip</h2>

      <div style={{ marginBottom: "1rem" }}>
        <label>
          <strong>Interests</strong>
        </label>

        <div style={{ marginTop: "0.5rem" }}>
          {availableInterests.map((interest) => (
            <label
              key={interest}
              style={{ display: "block", marginBottom: "0.25rem" }}
            >
              <input
                type="checkbox"
                checked={interests.includes(interest)}
                onChange={() => toggleInterest(interest)}
              />{" "}
              {interest}
            </label>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <label>
          <strong>Start Time</strong>
        </label>
        <br />
        <input
          type="time"
          value={startTime}
          onChange={(event) => setStartTime(event.target.value)}
        />
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <label>
          <strong>End Time</strong>
        </label>
        <br />
        <input
          type="time"
          value={endTime}
          onChange={(event) => setEndTime(event.target.value)}
        />
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <label>
          <strong>Budget Level</strong>
        </label>
        <br />
        <select
          value={budgetLevel}
          onChange={(event) => setBudgetLevel(event.target.value)}
        >
          <option value="free">Free</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <label>
          <strong>Transport Mode</strong>
        </label>
        <br />
        <select
          value={transportMode}
          onChange={(event) => setTransportMode(event.target.value)}
        >
          <option value="walking">Walking</option>
          <option value="driving">Driving</option>
        </select>
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <label>
          <strong>Preferred Pace</strong>
        </label>
        <br />
        <select
          value={preferredPace}
          onChange={(event) => setPreferredPace(event.target.value)}
        >
          <option value="relaxed">Relaxed</option>
          <option value="moderate">Moderate</option>
          <option value="fast">Fast</option>
        </select>
      </div>

      <button type="submit">Generate Itinerary</button>
    </form>
  );
}