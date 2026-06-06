import Link from "next/link";
import { PlannerWorkspace } from "@/components/PlannerWorkspace";

export default function PlannerPage() {
  return (
    <main className="planner-page">
      <section className="planner-hero">
        <div className="page-container planner-hero-inner">
          <div className="planner-hero-copy">
            <Link href="/" className="back-link">
              ← Back to home
            </Link>
            <p className="eyebrow">Sarajevo, Bosnia &amp; Herzegovina</p>
            <h1>Sarajevo Travel Planner</h1>
            <p>
              Set your travel window, choose your interests, and get a
              personalized day plan — route-optimized and adapted to weather
              and traffic in real time.
            </p>
          </div>

          <div className="planner-status-grid" aria-label="How the planner works">
            <div>
              <span>01</span>
              <strong>Your preferences</strong>
              <p>Time, interests, pace &amp; budget</p>
            </div>
            <div>
              <span>02</span>
              <strong>AI itinerary</strong>
              <p>Scored &amp; route-ordered stops</p>
            </div>
            <div>
              <span>03</span>
              <strong>Smart adaptation</strong>
              <p>Weather &amp; traffic-aware</p>
            </div>
          </div>
        </div>
      </section>

      <PlannerWorkspace />
    </main>
  );
}
