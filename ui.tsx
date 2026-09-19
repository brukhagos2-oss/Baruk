"use client";

import type { ReactNode } from "react";

import { INSTRUMENTS, type InstrumentId } from "@/lib/market/instruments";

export function fmtPrice(instrument: InstrumentId | string, value: number): string {
  const def = INSTRUMENTS[instrument as InstrumentId];
  const digits = def?.digits ?? 2;
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function pipLabel(instrument: InstrumentId | string): string {
  return INSTRUMENTS[instrument as InstrumentId]?.pipLabel ?? "pips";
}

export function fmtNum(value: number, digits = 1): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function signed(value: number, digits = 1): string {
  return `${value >= 0 ? "+" : ""}${fmtNum(value, digits)}`;
}

export function timeAgo(iso: string | number): string {
  const t = typeof iso === "number" ? iso * 1000 : new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - t);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function clockUtc(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString("en-GB", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function Card({
  title,
  subtitle,
  right,
  children,
  className = "",
  bodyClass = "",
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClass?: string;
}) {
  return (
    <section className={`glass rounded-2xl ${className}`}>
      {title ? (
        <header className="flex items-start justify-between gap-3 border-b border-[#182238] px-4 py-3">
          <div>
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.18em] text-slate-200">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-[11px] text-slate-500">{subtitle}</p> : null}
          </div>
          {right}
        </header>
      ) : null}
      <div className={`px-4 py-3 ${bodyClass}`}>{children}</div>
    </section>
  );
}

export function Pill({
  children,
  tone = "slate",
  className = "",
}: {
  children: ReactNode;
  tone?: "slate" | "mint" | "rose" | "amber" | "azure";
  className?: string;
}) {
  const tones: Record<string, string> = {
    slate: "bg-slate-500/10 text-slate-300 border-slate-400/20",
    mint: "bg-[#12e39a]/12 text-[#3bf0b5] border-[#12e39a]/30",
    rose: "bg-[#ff4d6a]/12 text-[#ff7f94] border-[#ff4d6a]/30",
    amber: "bg-[#f7b955]/12 text-[#ffce7a] border-[#f7b955]/30",
    azure: "bg-[#4d8dff]/12 text-[#8ab4ff] border-[#4d8dff]/30",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function ConfidenceRing({ value, size = 68, label = "CONF" }: { value: number; size?: number; label?: string }) {
  const stroke = 6;
  const radius = (size - stroke) / 2;
  const circ = 2 * Math.PI * radius;
  const pct = Math.max(0, Math.min(100, value));
  const color = pct >= 85 ? "#12e39a" : pct >= 75 ? "#7de3b0" : pct >= 60 ? "#f7b955" : "#ff4d6a";
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="#16203a" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ - (circ * pct) / 100}
          style={{ transition: "stroke-dashoffset .6s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="num text-sm font-bold" style={{ color }}>
          {Math.round(pct)}%
        </span>
        <span className="text-[8px] tracking-widest text-slate-500">{label}</span>
      </div>
    </div>
  );
}

export function Sparkline({
  points,
  color = "#12e39a",
  width = 96,
  height = 30,
}: {
  points: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  if (points.length < 2) return <svg width={width} height={height} />;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const path = points
    .map((p, i) => `${(i / (points.length - 1)) * width},${height - ((p - min) / span) * (height - 4) - 2}`)
    .join(" ");
  const id = `spark-${color.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <svg width={width} height={height} className="overflow-visible">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline points={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
      <polygon points={`0,${height} ${path} ${width},${height}`} fill={`url(#${id})`} />
    </svg>
  );
}

export function StatTile({
  label,
  value,
  sub,
  tone = "slate",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "slate" | "mint" | "rose" | "amber" | "azure";
}) {
  const colors: Record<string, string> = {
    slate: "text-slate-100",
    mint: "text-[#3bf0b5]",
    rose: "text-[#ff7f94]",
    amber: "text-[#ffce7a]",
    azure: "text-[#8ab4ff]",
  };
  return (
    <div className="rounded-xl border border-[#182238] bg-[#0a1120]/70 px-3 py-2.5">
      <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className={`num mt-1 text-lg font-bold ${colors[tone]}`}>{value}</p>
      {sub ? <p className="mt-0.5 text-[10px] text-slate-500">{sub}</p> : null}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 rounded-xl border border-[#182238] bg-[#0a1120]/60 px-3 py-2.5 text-left transition hover:border-slate-600"
      style={{ borderColor: checked ? "rgba(18,227,154,0.35)" : undefined }}
    >
      <span>
        <span className="block text-[12px] font-medium text-slate-200">{label}</span>
        {hint ? <span className="block text-[10px] text-slate-500">{hint}</span> : null}
      </span>
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition ${checked ? "bg-[#12e39a]/80" : "bg-slate-700"}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${checked ? "left-4.5" : "left-0.5"}`}
        />
      </span>
    </button>
  );
}
