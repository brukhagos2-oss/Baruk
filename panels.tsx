"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BellRing,
  Check,
  FlaskConical,
  Gauge,
  Layers,
  ShieldCheck,
  Target,
  TrendingUp,
  X,
} from "lucide-react";

import { INSTRUMENTS, TIMEFRAMES, type InstrumentId, type TimeframeId } from "@/lib/market/instruments";
import type {
  AlertDTO,
  BacktestDTO,
  LiveSignalDTO,
  PerformanceDTO,
  SettingsDTO,
  SignalDTO,
  SnapshotDTO,
  TickerDTO,
} from "@/lib/client/types";
import {
  Card,
  ConfidenceRing,
  Pill,
  Sparkline,
  StatTile,
  Toggle,
  clockUtc,
  fmtNum,
  fmtPrice,
  pipLabel,
  signed,
  timeAgo,
} from "./ui";

/* ------------------------------------------------------------------ */
export function TickerRail({
  tickers,
  selected,
  onSelect,
}: {
  tickers: TickerDTO[];
  selected: InstrumentId;
  onSelect: (id: InstrumentId) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
      {tickers.map((t) => {
        const active = t.id === selected;
        const up = t.changePct >= 0;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onSelect(t.id)}
            className={`glass group relative overflow-hidden rounded-2xl px-3.5 py-3 text-left transition-all ${
              active ? "ring-1 ring-[#12e39a]/50" : "hover:-translate-y-0.5 hover:ring-1 hover:ring-slate-500/30"
            }`}
          >
            <span
              className="absolute inset-x-0 top-0 h-[2px]"
              style={{ background: active ? t.accent : "transparent" }}
            />
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[11px] font-bold tracking-widest text-slate-200">{t.label}</p>
                <p className="text-[9px] uppercase tracking-[0.2em] text-slate-500">{t.short}</p>
              </div>
              <Sparkline points={t.spark} color={up ? "#12e39a" : "#ff4d6a"} width={64} height={24} />
            </div>
            <div className="mt-2 flex items-end justify-between">
              <span className="num text-[17px] font-bold text-white">
                {t.price ? fmtPrice(t.id, t.price) : "—"}
              </span>
              <span
                className={`num text-[11px] font-semibold ${up ? "text-[#3bf0b5]" : "text-[#ff7f94]"}`}
              >
                {up ? "▲" : "▼"} {Math.abs(t.changePct).toFixed(2)}%
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
export function TimeframeBar({
  value,
  onChange,
  enabled,
}: {
  value: TimeframeId;
  onChange: (tf: TimeframeId) => void;
  enabled: TimeframeId[];
}) {
  const order: TimeframeId[] = ["M1", "M5", "M15", "M30", "H1", "H4"];
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {order.map((tf) => {
        const active = tf === value;
        const scanned = enabled.includes(tf);
        return (
          <button
            key={tf}
            type="button"
            onClick={() => onChange(tf)}
            className={`relative rounded-lg px-3 py-1.5 text-[11px] font-semibold tracking-wider transition ${
              active
                ? "bg-[#12e39a] text-[#04120c] shadow-[0_0_20px_-6px_#12e39a]"
                : "border border-[#1d2941] bg-[#0b1220]/70 text-slate-400 hover:text-slate-100"
            }`}
          >
            {TIMEFRAMES[tf].scalper && tf !== value ? (
              <span className="absolute -top-1 -right-1 h-1.5 w-1.5 rounded-full bg-[#f7b955]" />
            ) : null}
            {tf === "M1" ? "M1 ⚡" : tf}
            {!scanned ? <span className="ml-1 text-[9px] opacity-60">off</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
function LevelRow({
  label,
  price,
  pips,
  instrument,
  tone,
}: {
  label: string;
  price: number;
  pips?: string;
  instrument: InstrumentId;
  tone: "mint" | "rose" | "amber" | "slate";
}) {
  const colors: Record<string, string> = {
    mint: "border-[#12e39a]/35 bg-[#12e39a]/8 text-[#3bf0b5]",
    rose: "border-[#ff4d6a]/35 bg-[#ff4d6a]/8 text-[#ff7f94]",
    amber: "border-[#f7b955]/35 bg-[#f7b955]/8 text-[#ffce7a]",
    slate: "border-slate-600/30 bg-slate-500/5 text-slate-300",
  };
  return (
    <div className={`flex items-center justify-between rounded-xl border px-3 py-2 ${colors[tone]}`}>
      <span className="text-[10px] font-bold uppercase tracking-[0.18em]">{label}</span>
      <span className="flex items-baseline gap-2">
        <span className="num text-[15px] font-bold text-white">{fmtPrice(instrument, price)}</span>
        {pips ? <span className="num text-[10px] opacity-80">{pips}</span> : null}
      </span>
    </div>
  );
}

export function SignalTicket({
  signal,
  settings,
}: {
  signal: LiveSignalDTO | SignalDTO;
  settings: SettingsDTO;
}) {
  const live = "livePrice" in signal ? (signal as LiveSignalDTO) : null;
  const def = INSTRUMENTS[signal.instrument];
  const buy = signal.direction === "BUY";
  const unit = pipLabel(signal.instrument);
  const riskCash = (settings.accountSize * settings.riskPerTrade) / 100;
  const lots = signal.riskPips > 0 ? riskCash / (signal.riskPips * def.pipValuePerLot) : 0;
  const progress = live ? live.progress : signal.status === "TP" ? 1 : 0;
  const floating = live?.floatingPips ?? signal.resultPips ?? 0;

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border ${
        buy ? "border-[#12e39a]/35" : "border-[#ff4d6a]/35"
      } bg-[linear-gradient(160deg,rgba(13,21,36,0.95),rgba(7,11,20,0.98))]`}
    >
      <div
        className="absolute inset-x-0 top-0 h-[3px]"
        style={{ background: buy ? "linear-gradient(90deg,#12e39a,#0b7d58)" : "linear-gradient(90deg,#ff4d6a,#8c1f33)" }}
      />
      <div className="flex items-start justify-between gap-3 px-4 pt-4">
        <div>
          <div className="flex items-center gap-2">
            <span
              className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-[12px] font-black tracking-widest ${
                buy ? "bg-[#12e39a] text-[#04120c]" : "bg-[#ff4d6a] text-[#1a0308]"
              }`}
            >
              {buy ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
              {signal.direction}
            </span>
            <span className="text-[15px] font-bold text-white">{def.label}</span>
            <Pill tone="azure">{signal.timeframe}</Pill>
          </div>
          <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-slate-500">
            {clockUtc(signal.signalBarTime)} UTC · bar close · {signal.mode} · {signal.dataSource} feed
          </p>
        </div>
        <ConfidenceRing value={signal.confidence} />
      </div>

      <div className="mt-3 grid gap-1.5 px-4">
        <LevelRow
          label="Take profit"
          price={signal.takeProfit}
          pips={`+${fmtNum(signal.rewardPips)} ${unit}`}
          instrument={signal.instrument}
          tone="mint"
        />
        <LevelRow
          label="Partial TP1"
          price={signal.takeProfit1}
          pips={`+${fmtNum(signal.rewardPips * 0.55)} ${unit}`}
          instrument={signal.instrument}
          tone="slate"
        />
        <LevelRow label="Entry" price={signal.entry} instrument={signal.instrument} tone="amber" />
        <LevelRow
          label="Stop loss"
          price={signal.stopLoss}
          pips={`-${fmtNum(signal.riskPips)} ${unit}`}
          instrument={signal.instrument}
          tone="rose"
        />
      </div>

      {/* live travel bar */}
      <div className="px-4 pt-3">
        <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-slate-500">
          <span>SL</span>
          <span className={floating >= 0 ? "text-[#3bf0b5]" : "text-[#ff7f94]"}>
            {live ? "LIVE " : "FINAL "}
            {signed(floating)} {unit}
          </span>
          <span>TP</span>
        </div>
        <div className="relative mt-1 h-2 overflow-hidden rounded-full bg-[linear-gradient(90deg,rgba(255,77,106,0.35),rgba(148,163,184,0.2),rgba(18,227,154,0.35))]">
          <span
            className="absolute top-1/2 h-3.5 w-[3px] -translate-y-1/2 rounded bg-white shadow-[0_0_10px_2px_rgba(255,255,255,0.4)]"
            style={{ left: `${Math.max(1, Math.min(99, progress * 100))}%` }}
          />
        </div>
        {live ? (
          <p className="num mt-1 text-right text-[10px] text-slate-500">
            live {fmtPrice(signal.instrument, live.livePrice)}
          </p>
        ) : null}
      </div>

      <div className="mt-3 grid grid-cols-4 gap-2 px-4">
        <StatTile label="R:R" value={`1:${fmtNum(signal.riskReward, 2)}`} />
        <StatTile label={`Risk ${unit}`} value={fmtNum(signal.riskPips)} tone="rose" />
        <StatTile label={`Reward ${unit}`} value={fmtNum(signal.rewardPips)} tone="mint" />
        <StatTile label="Lot size" value={fmtNum(lots, 2)} sub={`${settings.riskPerTrade}% risk`} tone="amber" />
      </div>

      <div className="mt-3 border-t border-[#182238] px-4 py-3">
        <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
          <ShieldCheck size={12} className="text-[#12e39a]" /> Confluence stack
        </p>
        <ul className="grid gap-1">
          {signal.reasons.map((r) => (
            <li key={r} className="flex items-start gap-1.5 text-[11px] text-slate-300">
              <Check size={12} className="mt-0.5 shrink-0 text-[#12e39a]" />
              {r}
            </li>
          ))}
        </ul>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Pill tone="slate">HTF {signal.htfBias}</Pill>
          <Pill tone="slate">ATR {fmtPrice(signal.instrument, signal.atr)}</Pill>
          {typeof signal.filters?.adx === "number" ? <Pill tone="slate">ADX {signal.filters.adx}</Pill> : null}
          {typeof signal.filters?.rsi === "number" ? <Pill tone="slate">RSI {signal.filters.rsi}</Pill> : null}
          {typeof signal.filters?.session === "string" ? (
            <Pill tone="slate">{signal.filters.session}</Pill>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
export function EngineXray({ snapshot, minConfidence }: { snapshot: SnapshotDTO | null; minConfidence: number }) {
  if (!snapshot) {
    return (
      <Card title="Engine x-ray" subtitle="Live read of the confirmation stack">
        <p className="py-6 text-center text-xs text-slate-500">Waiting for market data…</p>
      </Card>
    );
  }
  const tone = snapshot.status === "SIGNAL" ? "mint" : snapshot.status === "WATCH" ? "amber" : "slate";
  return (
    <Card
      title="Engine x-ray"
      subtitle={`${snapshot.instrument} ${snapshot.timeframe} · bar closed ${timeAgo(snapshot.lastBarTime)}`}
      right={<Pill tone={tone}>{snapshot.status}</Pill>}
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label="Confluence" value={`${snapshot.confidence}%`} sub={`need ${minConfidence}%`} tone={tone} />
        <StatTile label="HTF bias" value={snapshot.htfBias} tone={snapshot.htfBias === "BULL" ? "mint" : snapshot.htfBias === "BEAR" ? "rose" : "slate"} />
        <StatTile label="ADX" value={fmtNum(snapshot.adx)} sub="trend strength" tone="azure" />
        <StatTile label="RSI" value={fmtNum(snapshot.rsi)} sub="momentum band" tone="amber" />
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <div className="rounded-xl border border-[#182238] bg-[#0a1120]/60 p-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
            <Check size={12} className="text-[#12e39a]" /> Conditions met
          </p>
          {snapshot.reasons.length ? (
            <ul className="grid gap-1">
              {snapshot.reasons.map((r) => (
                <li key={r} className="text-[11px] text-slate-300">
                  • {r}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[11px] text-slate-500">No confirmations yet on this bar.</p>
          )}
        </div>
        <div className="rounded-xl border border-[#182238] bg-[#0a1120]/60 p-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
            <X size={12} className="text-[#ff7f94]" /> Blocking filter
          </p>
          <p className="text-[11px] text-slate-300">{snapshot.nextStep}</p>
          <p className="mt-2 text-[10px] text-slate-500">
            Feed {snapshot.source} · {snapshot.provider} · EMA21 {fmtPrice(snapshot.instrument, snapshot.ema21)} ·
            EMA200 {fmtPrice(snapshot.instrument, snapshot.ema200)}
          </p>
        </div>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
export function PerformancePanel({ performance }: { performance: PerformanceDTO | null }) {
  if (!performance) return null;
  const wr = performance.winRate;
  const tone = wr >= 80 ? "mint" : wr >= 65 ? "amber" : "rose";
  return (
    <Card
      title="Live performance"
      subtitle="Every trade resolved on the same candles the chart renders"
      right={<Pill tone={tone}>{fmtNum(wr)}% win rate</Pill>}
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label="Closed trades" value={performance.trades} sub={`${performance.openCount} live`} />
        <StatTile label="Wins / losses" value={`${performance.wins}/${performance.losses}`} tone="mint" />
        <StatTile label="Net pips" value={signed(performance.netPips)} tone={performance.netPips >= 0 ? "mint" : "rose"} />
        <StatTile
          label="Profit factor"
          value={performance.profitFactor >= 99 ? "∞" : fmtNum(performance.profitFactor, 2)}
          sub={`expectancy ${signed(performance.expectancyR, 2)}R`}
          tone="azure"
        />
      </div>
      {performance.byInstrument.length ? (
        <div className="mt-3 grid gap-1.5">
          {performance.byInstrument.map((row) => (
            <div
              key={row.instrument}
              className="flex items-center gap-3 rounded-xl border border-[#182238] bg-[#0a1120]/60 px-3 py-2"
            >
              <span className="w-20 text-[11px] font-semibold text-slate-200">{row.instrument}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#16203a]">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(2, Math.min(100, row.winRate))}%`,
                    background: row.winRate >= 80 ? "#12e39a" : row.winRate >= 60 ? "#f7b955" : "#ff4d6a",
                  }}
                />
              </div>
              <span className="num w-12 text-right text-[11px] text-slate-300">{fmtNum(row.winRate)}%</span>
              <span
                className={`num w-20 text-right text-[11px] ${row.pips >= 0 ? "text-[#3bf0b5]" : "text-[#ff7f94]"}`}
              >
                {signed(row.pips)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-[11px] text-slate-500">
          No closed trades yet — the engine only books results from real closed candles.
        </p>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
export function HistoryTable({ history }: { history: SignalDTO[] }) {
  return (
    <Card title="Signal history" subtitle="Resolved exactly at TP / SL touch on live candles">
      {history.length ? (
        <div className="max-h-[320px] overflow-y-auto">
          <table className="w-full text-left text-[11px]">
            <thead className="sticky top-0 bg-[#0a0f1a] text-[9px] uppercase tracking-[0.14em] text-slate-500">
              <tr>
                <th className="py-1.5">Pair</th>
                <th>TF</th>
                <th>Side</th>
                <th className="text-right">Entry</th>
                <th className="text-right">Exit</th>
                <th className="text-right">Pips</th>
                <th className="text-right">R</th>
                <th className="text-right">Result</th>
              </tr>
            </thead>
            <tbody className="num">
              {history.map((s) => {
                const win = (s.resultPips ?? 0) > 0;
                return (
                  <tr key={s.id} className="border-t border-[#131c2f] text-slate-300">
                    <td className="py-1.5 font-semibold text-slate-200">{s.instrument}</td>
                    <td>{s.timeframe}</td>
                    <td className={s.direction === "BUY" ? "text-[#3bf0b5]" : "text-[#ff7f94]"}>{s.direction}</td>
                    <td className="text-right">{fmtPrice(s.instrument, s.entry)}</td>
                    <td className="text-right">{s.exitPrice ? fmtPrice(s.instrument, s.exitPrice) : "—"}</td>
                    <td className={`text-right ${win ? "text-[#3bf0b5]" : "text-[#ff7f94]"}`}>
                      {signed(s.resultPips ?? 0)}
                    </td>
                    <td className="text-right">{signed(s.rMultiple ?? 0, 2)}</td>
                    <td className="text-right">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${
                          s.status === "TP"
                            ? "bg-[#12e39a]/15 text-[#3bf0b5]"
                            : s.status === "SL"
                              ? "bg-[#ff4d6a]/15 text-[#ff7f94]"
                              : "bg-slate-500/15 text-slate-300"
                        }`}
                      >
                        {s.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="py-6 text-center text-[11px] text-slate-500">No resolved signals yet.</p>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
export function BacktestPanel({
  instrument,
  timeframe,
  mode,
  minConfidence,
}: {
  instrument: InstrumentId;
  timeframe: TimeframeId;
  mode: string;
  minConfidence: number;
}) {
  const [data, setData] = useState<BacktestDTO | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/backtest?instrument=${instrument}&tf=${timeframe}&mode=${mode}&minConfidence=${minConfidence}`,
      );
      const json = (await res.json()) as BacktestDTO & { error?: string };
      if (json.error) throw new Error(json.error);
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Validation failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setData(null);
  }, [instrument, timeframe, mode, minConfidence]);

  const wr = data?.winRate ?? 0;

  return (
    <Card
      title="Strategy validation"
      subtitle="Replays the identical engine over the loaded live history — no separate demo model"
      right={
        <button
          type="button"
          onClick={run}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg border border-[#12e39a]/40 bg-[#12e39a]/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-[#3bf0b5] transition hover:bg-[#12e39a]/20 disabled:opacity-50"
        >
          <FlaskConical size={12} />
          {loading ? "Running…" : "Run validation"}
        </button>
      }
    >
      {error ? <p className="text-[11px] text-[#ff7f94]">{error}</p> : null}
      {!data && !error ? (
        <p className="text-[11px] text-slate-500">
          Runs {instrument} {timeframe} through the same evaluate → fill pipeline used live. Stops are assumed
          first whenever a bar touches both levels, so results are never flattered.
        </p>
      ) : null}
      {data ? (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatTile
              label="Win rate"
              value={`${fmtNum(wr)}%`}
              sub={`${data.wins}W / ${data.losses}L`}
              tone={wr >= 80 ? "mint" : wr >= 65 ? "amber" : "rose"}
            />
            <StatTile label="Trades" value={data.trades} sub={`${data.barsTested} bars`} />
            <StatTile
              label="Profit factor"
              value={data.profitFactor >= 99 ? "∞" : fmtNum(data.profitFactor, 2)}
              tone="azure"
            />
            <StatTile
              label="Net pips"
              value={signed(data.netPips)}
              sub={`${signed(data.expectancyR, 2)}R / trade`}
              tone={data.netPips >= 0 ? "mint" : "rose"}
            />
          </div>
          {data.equity.length > 1 ? (
            <div className="mt-3 rounded-xl border border-[#182238] bg-[#0a1120]/60 p-3">
              <p className="mb-1 text-[10px] uppercase tracking-[0.16em] text-slate-500">Equity curve (R)</p>
              <Sparkline points={data.equity} color="#12e39a" width={520} height={70} />
              <p className="mt-1 text-[10px] text-slate-500">
                Max drawdown {fmtNum(data.maxDrawdownR, 2)}R · avg win {fmtNum(data.avgWinPips)} · avg loss{" "}
                {fmtNum(data.avgLossPips)}
              </p>
            </div>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
export function AlertsDrawer({
  open,
  alerts,
  onClose,
  onMarkRead,
}: {
  open: boolean;
  alerts: AlertDTO[];
  onClose: () => void;
  onMarkRead: () => void;
}) {
  return (
    <div
      className={`fixed inset-y-0 right-0 z-50 w-full max-w-sm transform border-l border-[#1a2338] bg-[#070b14]/95 backdrop-blur-xl transition-transform duration-300 ${
        open ? "translate-x-0" : "translate-x-full"
      }`}
    >
      <div className="flex items-center justify-between border-b border-[#182238] px-4 py-3">
        <h3 className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.18em] text-slate-200">
          <BellRing size={14} className="text-[#12e39a]" /> Alert feed
        </h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onMarkRead}
            className="rounded-lg border border-[#1d2941] px-2 py-1 text-[10px] text-slate-400 hover:text-slate-100"
          >
            Mark read
          </button>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-100">
            <X size={16} />
          </button>
        </div>
      </div>
      <div className="h-[calc(100%-49px)] overflow-y-auto px-3 py-3">
        {alerts.length ? (
          <ul className="grid gap-2">
            {alerts.map((a) => (
              <li
                key={a.id}
                className={`rounded-xl border px-3 py-2 ${
                  a.kind === "NEW_SIGNAL"
                    ? "border-[#4d8dff]/30 bg-[#4d8dff]/5"
                    : a.kind === "TP_HIT"
                      ? "border-[#12e39a]/30 bg-[#12e39a]/5"
                      : a.kind === "SL_HIT"
                        ? "border-[#ff4d6a]/30 bg-[#ff4d6a]/5"
                        : "border-[#182238] bg-[#0a1120]/60"
                } ${a.readAt ? "opacity-70" : ""}`}
              >
                <p className="text-[12px] font-semibold text-slate-100">{a.title}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">{a.body}</p>
                <p className="mt-1 text-[9px] uppercase tracking-widest text-slate-600">{timeAgo(a.createdAt)}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-10 text-center text-[11px] text-slate-500">No alerts yet.</p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
export function SettingsDrawer({
  open,
  settings,
  onClose,
  onChange,
  notifState,
  onEnablePush,
}: {
  open: boolean;
  settings: SettingsDTO;
  onClose: () => void;
  onChange: (patch: Partial<SettingsDTO>) => void;
  notifState: string;
  onEnablePush: () => void;
}) {
  const allTf: TimeframeId[] = ["M1", "M5", "M15", "M30", "H1", "H4"];
  const allIn: InstrumentId[] = ["XAUUSD", "EURUSD", "USDJPY", "BTCUSD"];
  return (
    <div
      className={`fixed inset-y-0 right-0 z-50 w-full max-w-sm transform overflow-y-auto border-l border-[#1a2338] bg-[#070b14]/95 backdrop-blur-xl transition-transform duration-300 ${
        open ? "translate-x-0" : "translate-x-full"
      }`}
    >
      <div className="flex items-center justify-between border-b border-[#182238] px-4 py-3">
        <h3 className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.18em] text-slate-200">
          <Gauge size={14} className="text-[#12e39a]" /> Engine control
        </h3>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-100">
          <X size={16} />
        </button>
      </div>

      <div className="grid gap-4 px-4 py-4">
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Risk profile</p>
          <div className="grid gap-1.5">
            {(["precision", "balanced", "runner"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onChange({ mode: m })}
                className={`rounded-xl border px-3 py-2 text-left transition ${
                  settings.mode === m
                    ? "border-[#12e39a]/50 bg-[#12e39a]/8"
                    : "border-[#182238] bg-[#0a1120]/60 hover:border-slate-600"
                }`}
              >
                <p className="text-[12px] font-semibold capitalize text-slate-100">{m}</p>
                <p className="text-[10px] text-slate-500">
                  {m === "precision"
                    ? "80%+ strike-rate target · tight ATR target, structural stop"
                    : m === "balanced"
                      ? "1.6R average payoff · balanced hit rate"
                      : "2.5R trend runner · lower hit rate, big pips"}
                </p>
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Minimum confluence
            </p>
            <span className="num text-[12px] font-bold text-[#3bf0b5]">{settings.minConfidence}%</span>
          </div>
          <input
            type="range"
            min={65}
            max={95}
            value={settings.minConfidence}
            onChange={(e) => onChange({ minConfidence: Number(e.target.value) })}
            className="w-full accent-[#12e39a]"
          />
          <p className="text-[10px] text-slate-500">
            Higher = fewer, cleaner signals. Below 75 the bot becomes reactive again.
          </p>
        </div>

        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Scanned pairs</p>
          <div className="flex flex-wrap gap-1.5">
            {allIn.map((id) => {
              const on = settings.instruments.includes(id);
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() =>
                    onChange({
                      instruments: on
                        ? settings.instruments.filter((x) => x !== id)
                        : [...settings.instruments, id],
                    })
                  }
                  className={`rounded-lg px-2.5 py-1.5 text-[11px] font-semibold ${
                    on ? "bg-[#12e39a]/15 text-[#3bf0b5] ring-1 ring-[#12e39a]/40" : "bg-[#0a1120] text-slate-500"
                  }`}
                >
                  {INSTRUMENTS[id].label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            Scanned timeframes
          </p>
          <div className="flex flex-wrap gap-1.5">
            {allTf.map((tf) => {
              const on = settings.timeframes.includes(tf);
              return (
                <button
                  key={tf}
                  type="button"
                  onClick={() =>
                    onChange({
                      timeframes: on ? settings.timeframes.filter((x) => x !== tf) : [...settings.timeframes, tf],
                    })
                  }
                  className={`rounded-lg px-2.5 py-1.5 text-[11px] font-semibold ${
                    on ? "bg-[#4d8dff]/15 text-[#8ab4ff] ring-1 ring-[#4d8dff]/40" : "bg-[#0a1120] text-slate-500"
                  }`}
                >
                  {tf}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-2">
          <Toggle
            checked={settings.autoScan}
            onChange={(v) => onChange({ autoScan: v })}
            label="Auto scan"
            hint="Scan every 30s on closed candles only"
          />
          <Toggle
            checked={settings.pushEnabled}
            onChange={(v) => onChange({ pushEnabled: v })}
            label="Phone / desktop push"
            hint="OS notification the moment a setup validates"
          />
          <Toggle
            checked={settings.soundEnabled}
            onChange={(v) => onChange({ soundEnabled: v })}
            label="Alert sound"
            hint="Chime + vibration on new signals"
          />
        </div>

        {notifState !== "granted" ? (
          <button
            type="button"
            onClick={onEnablePush}
            className="rounded-xl border border-[#f7b955]/40 bg-[#f7b955]/10 px-3 py-2 text-[11px] font-semibold text-[#ffce7a]"
          >
            Enable phone notifications ({notifState})
          </button>
        ) : (
          <p className="rounded-xl border border-[#12e39a]/30 bg-[#12e39a]/8 px-3 py-2 text-[11px] text-[#3bf0b5]">
            Notifications armed. Install this page to your home screen for lock-screen alerts.
          </p>
        )}

        <div className="grid grid-cols-2 gap-2">
          <label className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
            Account size
            <input
              type="number"
              value={settings.accountSize}
              onChange={(e) => onChange({ accountSize: Number(e.target.value) })}
              className="num mt-1 w-full rounded-lg border border-[#1d2941] bg-[#0a1120] px-2 py-1.5 text-[12px] text-slate-100"
            />
          </label>
          <label className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
            Risk %
            <input
              type="number"
              step="0.1"
              value={settings.riskPerTrade}
              onChange={(e) => onChange({ riskPerTrade: Number(e.target.value) })}
              className="num mt-1 w-full rounded-lg border border-[#1d2941] bg-[#0a1120] px-2 py-1.5 text-[12px] text-slate-100"
            />
          </label>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
export interface ToastItem {
  id: number;
  title: string;
  body: string;
  tone: "mint" | "rose" | "azure";
}

export function ToastStack({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[60] grid w-[min(360px,calc(100vw-2rem))] gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast-in pointer-events-auto overflow-hidden rounded-2xl border bg-[#0a0f1acc] px-4 py-3 backdrop-blur-xl ${
            t.tone === "mint"
              ? "border-[#12e39a]/45 shadow-[0_0_40px_-16px_#12e39a]"
              : t.tone === "rose"
                ? "border-[#ff4d6a]/45 shadow-[0_0_40px_-16px_#ff4d6a]"
                : "border-[#4d8dff]/45"
          }`}
          onClick={() => onDismiss(t.id)}
        >
          <div className="flex items-start gap-2">
            {t.tone === "mint" ? (
              <TrendingUp size={16} className="mt-0.5 text-[#3bf0b5]" />
            ) : t.tone === "rose" ? (
              <Target size={16} className="mt-0.5 text-[#ff7f94]" />
            ) : (
              <Activity size={16} className="mt-0.5 text-[#8ab4ff]" />
            )}
            <div>
              <p className="text-[12px] font-bold text-slate-100">{t.title}</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">{t.body}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
export function OpenTradesPanel({
  open,
  onSelect,
}: {
  open: LiveSignalDTO[];
  onSelect: (instrument: InstrumentId, tf: TimeframeId) => void;
}) {
  return (
    <Card
      title="Live positions"
      subtitle="Tracked tick-by-tick against the same feed"
      right={<Pill tone={open.length ? "mint" : "slate"}>{open.length} open</Pill>}
    >
      {open.length ? (
        <ul className="grid gap-1.5">
          {open.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onSelect(s.instrument, s.timeframe)}
                className="w-full rounded-xl border border-[#182238] bg-[#0a1120]/60 px-3 py-2 text-left transition hover:border-slate-600"
              >
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-200">
                    <span className={s.direction === "BUY" ? "text-[#3bf0b5]" : "text-[#ff7f94]"}>
                      {s.direction}
                    </span>
                    {s.instrument}
                    <Pill tone="azure">{s.timeframe}</Pill>
                  </span>
                  <span
                    className={`num text-[12px] font-bold ${
                      s.floatingPips >= 0 ? "text-[#3bf0b5]" : "text-[#ff7f94]"
                    }`}
                  >
                    {signed(s.floatingPips)} {pipLabel(s.instrument)}
                  </span>
                </div>
                <div className="num mt-1 flex items-center justify-between text-[10px] text-slate-500">
                  <span>E {fmtPrice(s.instrument, s.entry)}</span>
                  <span className="text-[#ff7f94]">SL {fmtPrice(s.instrument, s.stopLoss)}</span>
                  <span className="text-[#3bf0b5]">TP {fmtPrice(s.instrument, s.takeProfit)}</span>
                  <span>{timeAgo(s.createdAt)}</span>
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[#16203a]">
                  <div
                    className="h-full rounded-full bg-[linear-gradient(90deg,#ff4d6a,#f7b955,#12e39a)]"
                    style={{ width: `${Math.max(2, Math.min(100, s.progress * 100))}%` }}
                  />
                </div>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex items-center gap-2 py-4 text-[11px] text-slate-500">
          <Layers size={14} /> No open positions — the engine is waiting for A+ confluence.
        </p>
      )}
    </Card>
  );
}
