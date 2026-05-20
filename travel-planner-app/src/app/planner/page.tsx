import Link from "next/link";
import { PlannerWorkspace } from "@/components/PlannerWorkspace";

export default function PlannerPage() {
  return (
    <main className="planner-page">
      <section className="planner-hero">
        <div className="page-container planner-hero-inner">
          <div className="planner-hero-copy">
            <Link href="/" className="back-link">
              Back to home
            </Link>
            <p className="eyebrow">Planner workspace</p>
            <h1>Sarajevo Travel Planner</h1>
            <p>
              Set a travel window, choose your interests, and review the
              Sarajevo attractions currently available through the planner API.
            </p>
          </div>

          <div className="planner-status-grid" aria-label="Planner modules">
            <div>
              <span>01</span>
              <strong>Preferences</strong>
              <p>User profile input</p>
            </div>
            <div>
              <span>02</span>
              <strong>Attractions</strong>
              <p>Fetched from API</p>
            </div>
            <div>
              <span>03</span>
              <strong>Adaptation</strong>
              <p>Ready for Week 2</p>
            </div>
          </div>
        </div>
      </section>

      <PlannerWorkspace />
    </main>
  );
}
