import Link from "next/link";

export default function Home() {
  return (
    <main style={{ padding: "2rem", fontFamily: "Arial, sans-serif" }}>
      <h1>Real-Time Adaptive Travel Itinerary Planner</h1>

      <p>
        Sarajevo-based AI travel itinerary planning system with recommendation,
        routing, weather awareness, and real-time re-optimization.
      </p>

      <div style={{ marginTop: "1.5rem" }}>
        <Link href="/planner">Open Planner</Link>
      </div>

      <hr style={{ margin: "2rem 0" }} />

      <h2>Backend API Status</h2>

      <ul>
        <li>
          <a href="/api/health">/api/health</a>
        </li>
        <li>
          <a href="/api/attractions">/api/attractions</a>
        </li>
        <li>
          <a href="/api/routing">/api/routing</a>
        </li>
        <li>
          <a href="/api/weather">/api/weather</a>
        </li>
      </ul>
    </main>
  );
}