import Image from "next/image";
import Link from "next/link";
import { SectionHeader } from "@/components/SectionHeader";
import { HomeAnimations } from "@/components/HomeAnimations";

const features = [
  {
    icon: "🤖",
    title: "AI-Powered Recommendations",
    description:
      "Attraction selection driven by your interests, travel pace, budget, and available time.",
  },
  {
    icon: "🌤",
    title: "Weather-Aware Adaptation",
    description:
      "Itineraries update automatically when weather conditions change during your trip.",
  },
  {
    icon: "🗺",
    title: "Route-Aware Stop Ordering",
    description:
      "Stops are reordered to minimise travel time using real OpenRouteService data.",
  },
  {
    icon: "📍",
    title: "Interactive Map Visualisation",
    description:
      "View your full route on an interactive Leaflet map with numbered stop markers.",
  },
  {
    icon: "🚶",
    title: "Mixed-Mode Route Segments",
    description:
      "Walking and driving segments are combined for the most practical daily route.",
  },
  {
    icon: "🚦",
    title: "Traffic Adaptation Simulation",
    description:
      "Simulate road disruptions and watch the itinerary re-optimise around them instantly.",
  },
] as const;

const steps = [
  {
    number: "01",
    title: "Choose Your Interests",
    description:
      "Select from cultural, historic, nature, food, and architectural categories.",
  },
  {
    number: "02",
    title: "Get AI Recommendations",
    description:
      "The AI picks the best Sarajevo attractions for your profile and time budget.",
  },
  {
    number: "03",
    title: "Review Your Itinerary",
    description:
      "See weather notes, adapted stops, and a full day summary before you go.",
  },
  {
    number: "04",
    title: "Follow the Route on the Map",
    description:
      "Navigate with an interactive map showing your optimised route and every stop.",
  },
] as const;

const reviews = [
  {
    rating: 5,
    text: "Planning a Sarajevo visit felt straightforward — I picked my interests and had a full day itinerary ready in minutes.",
    author: "Early tester",
    tag: "City explorer",
  },
  {
    rating: 5,
    text: "The weather awareness is a great touch. It flagged a rainy afternoon and suggested indoor alternatives automatically.",
    author: "Demo user",
    tag: "Weekend traveller",
  },
  {
    rating: 4,
    text: "The map with numbered stops and walking routes made it easy to see the full plan at a glance before heading out.",
    author: "Beta participant",
    tag: "Cultural enthusiast",
  },
] as const;

export default function Home() {
  return (
    <>
      <HomeAnimations />

      <main className="home-main">
        {/* ── Hero ──────────────────────────────────────────── */}
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
            <p className="eyebrow hero-eyebrow">AI-Powered Travel Planning</p>
            <h1>Plan Smarter Trips Around Sarajevo</h1>
            <p className="hero-copy">
              An AI-powered itinerary planner that adapts to your interests,
              weather, travel time, and route conditions in real time.
            </p>

            <div className="hero-actions">
              <Link href="/planner" className="button button-primary">
                Start Planning
              </Link>
              <a href="#features" className="button button-ghost">
                Explore Features
              </a>
            </div>

            <div className="hero-metrics" aria-label="Key capabilities">
              <span>🌤 Weather-aware</span>
              <span>🗺 Route-optimised</span>
              <span>🤖 AI-powered</span>
            </div>
          </div>
        </section>

        {/* ── Features ──────────────────────────────────────── */}
        <section className="page-section home-section-features" id="features">
          <div className="page-container">
            <div className="reveal-item">
              <SectionHeader
                eyebrow="What it does"
                title="Everything you need for a great Sarajevo day"
                description="Six core capabilities working together to build smarter, adaptive itineraries."
                align="center"
              />
            </div>
            <div className="home-feature-grid reveal-grid">
              {features.map((f) => (
                <article className="home-feature-card reveal-item" key={f.title}>
                  <span className="home-feature-icon" aria-hidden="true">
                    {f.icon}
                  </span>
                  <h3>{f.title}</h3>
                  <p>{f.description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ── How It Works ──────────────────────────────────── */}
        <section className="page-section home-section-steps" id="how-it-works">
          <div className="page-container">
            <div className="reveal-item">
              <SectionHeader
                eyebrow="How it works"
                title="From interests to itinerary in four steps"
                align="center"
              />
            </div>
            <div className="home-steps reveal-grid">
              {steps.map((step) => (
                <div className="home-step reveal-item" key={step.number}>
                  <span className="home-step-number" aria-hidden="true">
                    {step.number}
                  </span>
                  <h3>{step.title}</h3>
                  <p>{step.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Early User Feedback ───────────────────────────── */}
        <section className="page-section home-section-reviews">
          <div className="page-container">
            <div className="reveal-item">
              <SectionHeader
                eyebrow="Early User Feedback"
                title="What travellers value"
                description="Feedback collected during early testing of the planner."
                align="center"
              />
            </div>
            <div className="home-reviews reveal-grid">
              {reviews.map((r) => (
                <article className="home-review-card reveal-item" key={r.author}>
                  <div
                    className="home-review-stars"
                    aria-label={`${r.rating} out of 5 stars`}
                  >
                    {"★".repeat(r.rating)}
                    {"☆".repeat(5 - r.rating)}
                  </div>
                  <p className="home-review-text">"{r.text}"</p>
                  <div className="home-review-author">
                    <span className="home-review-name">{r.author}</span>
                    <span className="home-review-tag">{r.tag}</span>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ── Final CTA ─────────────────────────────────────── */}
        <section className="home-cta-section">
          <div className="page-container home-cta-inner">
            <h2>Ready to explore Sarajevo?</h2>
            <p>Build your personalised itinerary in minutes — no account needed.</p>
            <Link href="/planner" className="button button-primary home-cta-btn">
              Start Planning Now
            </Link>
          </div>
        </section>
      </main>

      {/* ── Footer ────────────────────────────────────────── */}
      <footer className="site-footer">
        <div className="page-container site-footer-inner">
          <div className="footer-brand">
            <Image
              src="/sarajevo-planner-logo.png"
              alt="Sarajevo Planner"
              width={180}
              height={45}
              className="footer-logo"
            />
            <p className="footer-tagline">
              Real-Time Adaptive AI-Based Travel Itinerary Planner
            </p>
          </div>

          <nav className="footer-nav" aria-label="Footer navigation">
            <Link href="/">Home</Link>
            <Link href="/planner">Planner</Link>
            <a href="#features">Features</a>
            <a href="#how-it-works">How It Works</a>
          </nav>

          <p className="footer-copy">
            © 2026 Sarajevo Planner · Graduate project demo
          </p>
        </div>
      </footer>
    </>
  );
}
