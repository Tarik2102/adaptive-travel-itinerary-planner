"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navigationItems = [
  { href: "/", label: "Home" },
  { href: "/planner", label: "Planner" },
] as const;

export function Navbar() {
  const pathname = usePathname();

  return (
    <header className="site-header">
      <div className="nav-container">
        <Link href="/" className="brand-link" aria-label="Sarajevo Planner home">
          <span className="brand-mark">SP</span>
          <span className="brand-copy">
            <span className="brand-title">Sarajevo Planner</span>
            <span className="brand-subtitle">Adaptive AI itineraries</span>
          </span>
        </Link>

        <nav className="nav-links" aria-label="Primary navigation">
          {navigationItems.map((item) => {
            const isActive =
              item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-link${isActive ? " nav-link-active" : ""}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <Link href="/planner" className="nav-action">
          Plan Trip
        </Link>
      </div>
    </header>
  );
}
