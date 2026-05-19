import Image from "next/image";
import Link from "next/link";
import { SectionHeader } from "@/components/SectionHeader";

const apiLinks = [
  { href: "/api/health", label: "Health" },
  { href: "/api/attractions", label: "Attractions" },
  { href: "/api/routing", label: "Routing" },
  { href: "/api/weather", label: "Weather" },
] as const;

const capabilities = [
  {
    title: "Preference-led planning",
    description:
      "Capture interests, travel pace, budget, and time windows before itinerary generation.",
  },
  {
    title: "Sarajevo attraction base",
    description:
      "Browse local cultural, historic, nature, and architectural stops from the app database.",
  },
  {
    title: "Adaptive architecture",
    description:
      "Prepared for weather, routing, recommendation, and real-time re-optimization modules.",
  },
] as const;

export default function Home() {
  return (
    <main>
      <section className="hero-section">
        <Image
          src="/sarajevo-hero.png"
          alt="Sarajevo cityscape along the Miljacka river"
          fill
          priority
          className="hero-image"
          sizes="100vw"
        />
        <div className="hero-overlay" />

        <div className="page-container hero-content">
          <p className="eyebrow hero-eyebrow">Graduate project prototype</p>
          <h1>Real-Time Adaptive AI-Based Travel Itinerary Planner</h1>
          <p className="hero-copy">
            A Sarajevo-focused itinerary planning system combining attraction
            recommendations, routing, weather awareness, and adaptive
            re-optimization.
          </p>

          <div className="hero-actions">
            <Link href="/planner" className="button button-primary">
              Open Planner
            </Link>
            <a href="/api/health" className="button button-ghost">
              Check API
            </a>
          </div>

          <div className="hero-metrics" aria-label="Project scope">
            <span>Sarajevo attractions</span>
            <span>Routing ready</span>
            <span>Weather aware</span>
          </div>
        </div>
      </section>

      <section className="page-section">
        <div className="page-container">
          <SectionHeader
            eyebrow="Planner foundation"
            title="Designed for adaptive city exploration"
            description="The interface keeps the current backend flow visible while giving the planner a clearer, more professional travel-product experience."
          />

          <div className="feature-grid">
            {capabilities.map((capability) => (
              <article className="feature-card" key={capability.title}>
                <h3>{capability.title}</h3>
                <p>{capability.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="page-section page-section-soft">
        <div className="page-container api-panel">
          <SectionHeader
            eyebrow="Development status"
            title="Backend endpoints remain available"
            description="These links are kept for quick checks while the full-stack prototype grows."
          />

          <div className="api-link-grid">
            {apiLinks.map((link) => (
              <a className="api-link-card" href={link.href} key={link.href}>
                <span>{link.label}</span>
                <code>{link.href}</code>
              </a>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
