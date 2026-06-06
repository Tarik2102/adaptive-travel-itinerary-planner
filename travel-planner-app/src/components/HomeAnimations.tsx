"use client";

import { useEffect } from "react";

export function HomeAnimations() {
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mediaQuery.matches) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const el = entry.target as HTMLElement;
          const grid = el.closest(".reveal-grid") as HTMLElement | null;

          if (entry.isIntersecting) {
            // Entering: clear exit flag on parent grid, add revealed
            if (grid) grid.classList.remove("reveal-exiting");
            el.classList.add("revealed");
          } else {
            // Leaving: mark parent grid as exiting (removes stagger delays),
            // then remove revealed so the exit transition fires.
            if (grid) grid.classList.add("reveal-exiting");
            el.classList.remove("revealed");
          }
        });
      },
      // A small negative rootMargin means items start animating slightly
      // before they fully exit, giving a smooth unbuild feel.
      { threshold: 0.08, rootMargin: "0px 0px -16px 0px" }
    );

    document.querySelectorAll(".reveal-item").forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, []);

  return null;
}
