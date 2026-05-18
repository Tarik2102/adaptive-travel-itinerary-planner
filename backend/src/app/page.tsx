export default function Home() {
  return (
    <main style={{ padding: "2rem", fontFamily: "Arial, sans-serif" }}>
      <h1>Travel Itinerary Backend</h1>
      <p>Next.js backend is running successfully.</p>

      <ul>
        <li>
          Health check: <a href="/api/health">/api/health</a>
        </li>
        <li>
          Attractions API: <a href="/api/attractions">/api/attractions</a>
        </li>
        <li>
          Routing API: <a href="/api/routing">/api/routing</a>
        </li>
        <li>
          Weather API: <a href="/api/weather">/api/weather</a>
        </li>
      </ul>
    </main>
  );
}