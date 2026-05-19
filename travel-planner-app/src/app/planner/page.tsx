import Link from "next/link";
import { AttractionList } from "@/components/AttractionList";
import { PreferenceForm } from "@/components/PreferenceForm";

export default function PlannerPage() {
  return (
    <main style={{ padding: "2rem", fontFamily: "Arial, sans-serif" }}>
      <Link href="/">← Back to Home</Link>

      <h1 style={{ marginTop: "1rem" }}>Sarajevo Travel Planner</h1>

      <p>
        Enter your preferences below. In Week 2, this form will be connected to
        the recommendation and itinerary generation modules.
      </p>

      <PreferenceForm />

      <AttractionList />
    </main>
  );
}