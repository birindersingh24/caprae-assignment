import type { ReactNode } from "react";
import type { Tier } from "../types";

export const tierStyles: Record<Tier, { label: string; badge: string; dot: string; ring: string }> = {
  hot: { label: "Hot", badge: "bg-rose-50 text-rose-700 ring-rose-200", dot: "bg-rose-500", ring: "stroke-rose-500" },
  warm: { label: "Warm", badge: "bg-amber-50 text-amber-700 ring-amber-200", dot: "bg-amber-500", ring: "stroke-amber-500" },
  cold: { label: "Cold", badge: "bg-slate-100 text-slate-600 ring-slate-200", dot: "bg-slate-400", ring: "stroke-slate-400" },
};

export function TierBadge({ tier }: { tier: Tier }) {
  const s = tierStyles[tier];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${s.badge}`}>
      <span className={`size-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

/** Circular score gauge, 0-100. */
export function ScoreRing({ score, tier, size = 44 }: { score: number; tier: Tier; size?: number }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox="0 0 44 44" className="shrink-0" aria-label={`Score ${score} of 100`}>
      <circle cx="22" cy="22" r={r} fill="none" strokeWidth="4" className="stroke-slate-200" />
      <circle
        cx="22"
        cy="22"
        r={r}
        fill="none"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={`${(score / 100) * c} ${c}`}
        transform="rotate(-90 22 22)"
        className={tierStyles[tier].ring}
      />
      <text x="22" y="26.5" textAnchor="middle" className="fill-slate-900 text-[13px] font-semibold">
        {score}
      </text>
    </svg>
  );
}

export function Button({
  children,
  variant = "secondary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" }) {
  const styles = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-500 shadow-sm disabled:bg-indigo-300",
    secondary: "bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 shadow-sm disabled:text-slate-400",
    ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
  }[variant];
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed ${styles} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>{children}</div>;
}
