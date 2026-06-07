"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type NavItem = {
  href: string;
  label: string;
};

const navigationItems: NavItem[] = [
  { href: "/", label: "Home" },
  { href: "/#features", label: "Features" },
  { href: "/#how-it-works", label: "How It Works" },
  { href: "/planner", label: "Planner" },
];

function isNavItemActive(
  item: NavItem,
  pathname: string,
  hash: string
): boolean {
  if (item.href === "/") {
    // Home is active only when at root with no hash
    return pathname === "/" && !hash;
  }
  if (item.href.startsWith("/#")) {
    // Section links: active when on home page with matching hash
    return pathname === "/" && hash === item.href.slice(1); // e.g. "#features"
  }
  return pathname.startsWith(item.href);
}

export function Navbar() {
  const pathname = usePathname();
  const [hash, setHash] = useState("");
  const [isHidden, setIsHidden] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const lastScrollY = useRef(0);

  // Keep hash in sync for section-link active detection.
  // Re-runs on pathname change so navigating from /planner → /#features works.
  useEffect(() => {
    const sync = () => setHash(window.location.hash);
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [pathname]);

  // Scroll listener: track hero-vs-scrolled state and show/hide behaviour.
  useEffect(() => {
    const handleScroll = () => {
      const y = window.scrollY;
      const isNearTop = y < 60;
      const isScrollingUp = y < lastScrollY.current;

      // Switch to solid navbar once user scrolls past the very top
      setIsScrolled(!isNearTop);

      // Existing hide behaviour: visible while scrolling down, hides on scroll up
      setIsHidden(!isNearTop && isScrollingUp);

      lastScrollY.current = y;
    };

    lastScrollY.current = window.scrollY;
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const headerClass = [
    "site-header",
    isHidden ? "site-header-hidden" : "",
    isScrolled ? "site-header-scrolled" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <header className={headerClass}>
      <div className="nav-container">
        <Link href="/" className="brand-link" aria-label="Sarajevo Planner home">
          <Image
            src="/sarajevo-planner-logo.png"
            alt="Sarajevo Planner"
            width={240}
            height={60}
            priority
            className="brand-logo"
          />
        </Link>

        <nav className="nav-links" aria-label="Primary navigation">
          {navigationItems.map((item) => {
            const active = isNavItemActive(item, pathname, hash);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-link${active ? " nav-link-active" : ""}`}
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
