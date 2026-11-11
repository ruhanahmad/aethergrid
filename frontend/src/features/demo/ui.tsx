import type { ComponentProps, ReactNode } from "react";

export function DemoButton({ tone = "normal", className = "", ...props }:
  ComponentProps<"button"> & { tone?: "normal" | "primary" | "danger" }) {
  const tones = {
    normal: "border-slate-700 bg-slate-800/70 text-slate-100 hover:bg-slate-700",
    primary: "border-cyan-200 bg-cyan-200 text-slate-950 hover:bg-cyan-100",
    danger: "border-rose-400/35 bg-rose-500/10 text-rose-100 hover:bg-rose-500/20",
  };
  return <button type="button" {...props} className={`inline-flex items-center justify-center gap-2 rounded-lg border px-3.5 py-2.5 text-sm font-semibold motion-safe:transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 disabled:cursor-not-allowed disabled:opacity-40 ${tones[tone]} ${className}`} />;
}

export function Pill({ children, tone = "neutral" }: {
  children: ReactNode;
  tone?: "neutral" | "active" | "healthy" | "warning" | "danger";
}) {
  const tones = {
    neutral: "border-slate-600/60 bg-slate-800 text-slate-200",
    active: "border-cyan-400/30 bg-cyan-500/10 text-cyan-100",
    healthy: "border-emerald-400/30 bg-emerald-500/10 text-emerald-200",
    warning: "border-amber-400/35 bg-amber-500/10 text-amber-200",
    danger: "border-rose-400/35 bg-rose-500/10 text-rose-200",
  };
  return <span className={`inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${tones[tone]}`}>
    <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />{children}
  </span>;
}
