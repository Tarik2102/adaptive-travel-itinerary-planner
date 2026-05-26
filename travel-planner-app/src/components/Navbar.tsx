"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const navigationItems = [
  { href: "/", label: "Home" },
  { href: "/planner", label: "Planner" },
] as const;

export function Navbar() {
  const pathname = usePathname();
  const [isHidden, setIsHidden] = useState(false);
  const lastScrollY = useRef(0);

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      const isNearTop = currentScrollY < 80;
      const isScrollingUp = currentScrollY < lastScrollY.current;

      setIsHidden(!isNearTop && isScrollingUp);
      lastScrollY.current = currentScrollY;
    };

    lastScrollY.current = window.scrollY;
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  return (
    <header className={`site-header${isHidden ? " site-header-hidden" : ""}`}>
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
