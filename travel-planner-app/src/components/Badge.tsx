import type { ReactNode } from "react";

type BadgeTone = "blue" | "emerald" | "amber" | "slate";

type BadgeProps = {
  children: ReactNode;
  tone?: BadgeTone;
};

export function Badge({ children, tone = "slate" }: BadgeProps) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
