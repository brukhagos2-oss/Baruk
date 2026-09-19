"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, Radar, RefreshCw, Settings2, Signal as SignalIcon, Zap } from "lucide-react";

import TradingChart from "./TradingChart";
import {
  AlertsDrawer,
  BacktestPanel,
  EngineXray,
  HistoryTable,
  OpenTradesPanel,
  PerformancePanel,
  SettingsDrawer,
  SignalTicket,
  TickerRail,
  TimeframeBar,
  ToastStack,
  type ToastItem,
} from "./panels";
import { Card, Pill, fmtNum, fmtPrice, timeAgo } from "./ui";
import { playChime, pushOsNotification, registerServiceWorker, requestNotificationPermission, notificationState } from "@/lib/client/notify";
import { INSTRUMENTS, type InstrumentId, type TimeframeId } from "@/lib/market/instruments";
import type {
  AlertDTO,
  MarketResponse,
  ScanResponse,
  SettingsDTO,
  SignalsResponse,
  TickerDTO,
} from "@/lib/client/types";

const SCAN_INTERVAL = 30_000;
const MARKET_INTERVAL = 15_000;
const SIGNALS_INTERVAL = 12_000;
const TICKER_INTERVAL = 20_000;

const DEFAULT_SETTINGS: SettingsDTO = {
  minConfidence: 84,
  mode: "precision",
  autoScan: true,
  pushEnabled: true,
  soundEnabled: true,
  instruments: ["XAUUSD", "EURUSD", "USDJPY", "BTCUSD"],
  timeframes: ["M5", "M15", "M30", "H1", "H4"],
  riskPerTrade: 1,
  accountSize: 10000,
};

export default function Dashboard() {
  const [instrument, setInstrument] = useState<InstrumentId>("XAUUSD");
  const [timeframe, setTimeframe] = useState<TimeframeId>("M15");
  const [market, setMarket] = useState<MarketResponse | null>(null);
  const [tickers, setTickers] = useState<TickerDTO[]>([]);
  const [signals, setSignals] = useState<SignalsResponse | null>(null);
  const [alerts, setAlerts] = useState<AlertDTO[]>([]);
  const [unread, setUnread] = useState(0);
  const [settings, setSettings] = useState<SettingsDTO>(DEFAULT_SETTINGS);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [countdown, setCountdown] = useState(SCAN_INTERVAL / 1000);
  const [chartLoading, setChartLoading] = useState(true);
  const [notifPerm, setNotifPerm] = useState<string>("default");
  const [clock, setClock] = useState("");

  const seenAlerts = useRef<Set<number> | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const pushToast = useCallback((toast: Omit<ToastItem, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [{ ...toast, id }, ...prev].slice(0, 4));
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 12_000);
  }, []);

  /* ---------------- loaders ---------------- */
  const loadMarket = useCallback(
    async (silent = false) => {
      if (!silent) setChartLoading(true);
      try {
        const res = await fetch(`/api/market?instrument=${instrument}&tf=${timeframe}`, { cache: "no-store" });
        if (res.ok) setMarket((await res.json()) as MarketResponse);
      } catch {
        /* keep last frame */
      } finally {
        setChartLoading(false);
      }
    },
    [instrument, timeframe],
  );

  const loadSignals = useCallback(async () => {
    try {
      const res = await fetch("/api/signals?limit=60", { cache: "no-store" });
      if (res.ok) setSignals((await res.json()) as SignalsResponse);
    } catch {
      /* ignore */
    }
  }, []);

  const loadTickers = useCallback(async () => {
    try {
      const res = await fetch("/api/tickers", { cache: "no-store" });
      if (res.ok) {
        const json = (await res.json()) as { tickers: TickerDTO[] };
        setTickers(json.tickers);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const loadAlerts = useCallback(async () => {
    try {
      const res = await fetch("/api/alerts?limit=40", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as { alerts: AlertDTO[]; unread: number };
      setAlerts(json.alerts);
      setUnread(json.unread);

      if (seenAlerts.current === null) {
        seenAlerts.current = new Set(json.alerts.map((a) => a.id));
        return;
      }
      const fresh = json.alerts.filter((a) => !seenAlerts.current!.has(a.id)).reverse();
      for (const a of fresh) {
        seenAlerts.current.add(a.id);
        const tone = a.kind === "SL_HIT" ? "rose" : a.kind === "NEW_SIGNAL" ? "azure" : "mint";
        pushToast({ title: a.title, body: a.body, tone });
        if (settingsRef.current.soundEnabled) {
          playChime(a.kind === "NEW_SIGNAL" ? "signal" : a.kind === "TP_HIT" ? "win" : "loss");
        }
        if (settingsRef.current.pushEnabled) {
          void pushOsNotification({
            title: a.title,
            body: a.body,
            tag: `apex-${a.id}`,
            sticky: a.kind === "NEW_SIGNAL",
          });
        }
      }
    } catch {
      /* ignore */
    }
  }, [pushToast]);

  const runScan = useCallback(
    async (manual = false) => {
      if (scanning) return;
      setScanning(true);
      setCountdown(SCAN_INTERVAL / 1000);
      try {
        const res = await fetch("/api/engine/scan", { method: "POST" });
        const json = (await res.json()) as ScanResponse;
        if (manual && json.summary) {
          pushToast({
            title: "Scan complete",
            body: `${json.summary.scanned} market/timeframe pairs analysed · ${json.summary.created} new setup(s) · ${json.summary.resolved} closed · feed ${json.summary.source}`,
            tone: "azure",
          });
        }
      } catch {
        /* ignore */
      } finally {
        setScanning(false);
        await Promise.all([loadSignals(), loadAlerts(), loadMarket(true)]);
      }
    },
    [scanning, loadSignals, loadAlerts, loadMarket, pushToast],
  );

  /* ---------------- boot ---------------- */
  useEffect(() => {
    void registerServiceWorker();
    setNotifPerm(notificationState());
    (async () => {
      try {
        const res = await fetch("/api/settings", { cache: "no-store" });
        if (res.ok) {
          const json = (await res.json()) as { settings: SettingsDTO };
          setSettings(json.settings);
        }
      } catch {
        /* defaults */
      }
      await Promise.all([loadTickers(), loadSignals(), loadAlerts()]);
      void runScan(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadMarket();
  }, [loadMarket]);

  useEffect(() => {
    const id = setInterval(() => void loadMarket(true), MARKET_INTERVAL);
    return () => clearInterval(id);
  }, [loadMarket]);

  useEffect(() => {
    const a = setInterval(() => void loadSignals(), SIGNALS_INTERVAL);
    const b = setInterval(() => void loadTickers(), TICKER_INTERVAL);
    const c = setInterval(() => void loadAlerts(), SIGNALS_INTERVAL);
    return () => {
      clearInterval(a);
      clearInterval(b);
      clearInterval(c);
    };
  }, [loadSignals, loadTickers, loadAlerts]);

  useEffect(() => {
    const id = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (settingsRef.current.autoScan) void runScan(false);
          return SCAN_INTERVAL / 1000;
        }
        return prev - 1;
      });
      setClock(
        new Date().toLocaleTimeString("en-GB", { timeZone: "UTC", hour12: false }) + " UTC",
      );
    }, 1000);
    return () => clearInterval(id);
  }, [runScan]);

  /* ---------------- settings ---------------- */
  const patchSettings = useCallback(async (patch: Partial<SettingsDTO>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const json = (await res.json()) as { settings: SettingsDTO };
        setSettings(json.settings);
      }
    } catch {
      /* keep optimistic value */
    }
  }, []);

  const enablePush = useCallback(async () => {
    const state = await requestNotificationPermission();
    setNotifPerm(state);
    if (state === "granted") {
      playChime("win");
      void pushOsNotification({
        title: "✅ APEX alerts armed",
        body: "You will now get an instant push the moment a validated setup prints.",
        tag: "apex-armed",
      });
    }
  }, []);

  /* ---------------- derived ---------------- */
  const activeSignal = market?.activeSignal ?? null;
  const liveActive = useMemo(
    () => signals?.open.find((s) => s.id === activeSignal?.id) ?? null,
    [signals, activeSignal],
  );
  const chartSignal = activeSignal ?? market?.lastClosedSignal ?? null;
  const snapshot = market?.snapshot ?? null;
  const feedLive = market?.feed.source === "live";
  const price = snapshot?.livePrice ?? 0;
  const change = snapshot?.changePct ?? 0;

  return (
    <div className="mx-auto max-w-[1680px] px-3 pb-10 pt-4 lg:px-6">
      <ToastStack toasts={toasts} onDismiss={(id) => setToasts((p) => p.filter((t) => t.id !== id))} />

      {/* ---------- header ---------- */}
      <header className="glass mb-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-[linear-gradient(135deg,#12e39a,#0b7d58)] shadow-[0_0_28px_-8px_#12e39a]">
            <SignalIcon size={20} className="text-[#04120c]" />
          </div>
          <div>
            <h1 className="text-[15px] font-black tracking-[0.18em] text-white">APEX SIGNAL ENGINE</h1>
            <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">
              multi-timeframe confluence · v3.0 · {clock || "—"}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-lg border border-[#1d2941] bg-[#0b1220]/70 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-300">
            <span
              className={`live-dot h-1.5 w-1.5 rounded-full ${feedLive ? "bg-[#12e39a]" : "bg-[#f7b955]"}`}
            />
            {feedLive ? "live feed" : market?.feed.source === "fallback" ? "backup feed" : "offline model"}
          </span>
          <Pill tone="mint">{settings.mode}</Pill>
          <Pill tone="azure">min {settings.minConfidence}%</Pill>
          <button
            type="button"
            onClick={() => void runScan(true)}
            disabled={scanning}
            className="flex items-center gap-1.5 rounded-lg border border-[#12e39a]/40 bg-[#12e39a]/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-[#3bf0b5] transition hover:bg-[#12e39a]/20 disabled:opacity-50"
          >
            <Radar size={13} className={scanning ? "animate-spin" : ""} />
            {scanning ? "scanning" : `scan ${countdown}s`}
          </button>
          <button
            type="button"
            onClick={() => {
              setAlertsOpen(true);
              setSettingsOpen(false);
              void fetch("/api/alerts", { method: "POST" }).then(() => setUnread(0));
            }}
            className="relative rounded-lg border border-[#1d2941] bg-[#0b1220]/70 p-2 text-slate-300 transition hover:text-white"
          >
            <Bell size={15} />
            {unread > 0 ? (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#ff4d6a] px-1 text-[9px] font-bold text-white">
                {unread}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            onClick={() => {
              setSettingsOpen(true);
              setAlertsOpen(false);
            }}
            className="rounded-lg border border-[#1d2941] bg-[#0b1220]/70 p-2 text-slate-300 transition hover:text-white"
          >
            <Settings2 size={15} />
          </button>
        </div>
      </header>

      {notifPerm !== "granted" ? (
        <button
          type="button"
          onClick={() => void enablePush()}
          className="mb-3 flex w-full items-center justify-center gap-2 rounded-xl border border-[#f7b955]/35 bg-[#f7b955]/8 px-4 py-2 text-[11px] font-semibold text-[#ffce7a] transition hover:bg-[#f7b955]/14"
        >
          <Bell size={13} /> Tap to arm phone + desktop push alerts for every validated signal
        </button>
      ) : null}

      <TickerRail tickers={tickers} selected={instrument} onSelect={setInstrument} />

      <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_400px]">
        {/* ---------- left column ---------- */}
        <div className="grid content-start gap-3">
          <Card
            title={
              <span className="flex items-center gap-2">
                {INSTRUMENTS[instrument].label}
                <span className="num text-[13px] font-bold text-white">{price ? fmtPrice(instrument, price) : "—"}</span>
                <span className={`num text-[11px] ${change >= 0 ? "text-[#3bf0b5]" : "text-[#ff7f94]"}`}>
                  {change >= 0 ? "+" : ""}
                  {fmtNum(change, 2)}% 24h
                </span>
              </span>
            }
            subtitle={
              snapshot
                ? `${market?.feed.provider} feed · last closed bar ${timeAgo(snapshot.lastBarTime)} · ATR ${fmtPrice(instrument, snapshot.atr)}`
                : "connecting…"
            }
            right={<TimeframeBar value={timeframe} onChange={setTimeframe} enabled={settings.timeframes} />}
            bodyClass="p-2 sm:p-3"
          >
            <TradingChart
              candles={market?.candles ?? []}
              overlays={market?.overlays ?? { ema21: [], ema50: [], ema200: [] }}
              signal={chartSignal}
              digits={INSTRUMENTS[instrument].digits}
              instrumentLabel={INSTRUMENTS[instrument].label}
              timeframeLabel={timeframe}
              livePrice={price}
              loading={chartLoading}
            />
            {chartSignal ? (
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-xl border border-[#f7b955]/30 bg-[#f7b955]/8 px-3 py-2">
                  <p className="text-[9px] uppercase tracking-[0.16em] text-[#ffce7a]">Entry</p>
                  <p className="num text-[15px] font-bold text-white">{fmtPrice(instrument, chartSignal.entry)}</p>
                </div>
                <div className="rounded-xl border border-[#ff4d6a]/30 bg-[#ff4d6a]/8 px-3 py-2">
                  <p className="text-[9px] uppercase tracking-[0.16em] text-[#ff7f94]">Stop loss</p>
                  <p className="num text-[15px] font-bold text-white">{fmtPrice(instrument, chartSignal.stopLoss)}</p>
                </div>
                <div className="rounded-xl border border-[#12e39a]/30 bg-[#12e39a]/8 px-3 py-2">
                  <p className="text-[9px] uppercase tracking-[0.16em] text-[#3bf0b5]">Take profit</p>
                  <p className="num text-[15px] font-bold text-white">{fmtPrice(instrument, chartSignal.takeProfit)}</p>
                </div>
                <div className="rounded-xl border border-[#1d2941] bg-[#0a1120]/70 px-3 py-2">
                  <p className="text-[9px] uppercase tracking-[0.16em] text-slate-500">Risk / reward</p>
                  <p className="num text-[15px] font-bold text-white">
                    {fmtNum(chartSignal.riskPips)} / {fmtNum(chartSignal.rewardPips)}{" "}
                    <span className="text-[10px] text-slate-500">{INSTRUMENTS[instrument].pipLabel}</span>
                  </p>
                </div>
              </div>
            ) : null}
          </Card>

          <EngineXray snapshot={snapshot} minConfidence={settings.minConfidence} />
          <BacktestPanel
            instrument={instrument}
            timeframe={timeframe}
            mode={settings.mode}
            minConfidence={settings.minConfidence}
          />
          <HistoryTable history={signals?.history ?? []} />
        </div>

        {/* ---------- right column ---------- */}
        <div className="grid content-start gap-3">
          {chartSignal ? (
            <div className={activeSignal ? "ring-alert rounded-2xl" : ""}>
              <SignalTicket signal={liveActive ?? chartSignal} settings={settings} />
              {!activeSignal ? (
                <p className="mt-1.5 text-center text-[10px] uppercase tracking-widest text-slate-500">
                  last closed setup on this chart · {chartSignal.status}
                </p>
              ) : null}
            </div>
          ) : (
            <Card title="Active setup" subtitle="Nothing valid on this pair/timeframe yet">
              <div className="flex flex-col items-center gap-2 py-6 text-center">
                <Zap size={24} className="text-[#f7b955]" />
                <p className="text-[12px] text-slate-300">Engine armed — filters are still blocking entry.</p>
                <p className="max-w-[260px] text-[11px] text-slate-500">{snapshot?.nextStep ?? "Loading…"}</p>
              </div>
            </Card>
          )}

          <OpenTradesPanel
            open={signals?.open ?? []}
            onSelect={(i, t) => {
              setInstrument(i);
              setTimeframe(t);
            }}
          />
          <PerformancePanel performance={signals?.performance ?? null} />

          <Card title="How the sensitivity was cut" subtitle="Why this build stops firing on noise">
            <ul className="grid gap-1.5 text-[11px] leading-relaxed text-slate-400">
              <li>• Signals are only evaluated on <b className="text-slate-200">fully closed candles</b> — no intrabar flicker.</li>
              <li>• A trade must agree with the <b className="text-slate-200">higher-timeframe regime</b> (EMA50/200 + slope).</li>
              <li>• <b className="text-slate-200">ADX + DI</b> gate kills range noise; MACD must be expanding, not fading.</li>
              <li>• Entry requires a <b className="text-slate-200">pullback into EMA21 value</b>, never a chase of an extended bar.</li>
              <li>• Volatility regime filter blocks dead tape and news spikes (0.45×–2.6× median ATR).</li>
              <li>• One idea per pair/timeframe + bar cooldown, and the threshold auto-tightens if the rolling win rate slips.</li>
            </ul>
          </Card>
        </div>
      </div>

      <footer className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#141d30] bg-[#080d17]/60 px-4 py-3 text-[10px] text-slate-500">
        <span className="flex items-center gap-1.5">
          <RefreshCw size={11} /> Auto-scan {settings.autoScan ? "on" : "off"} · chart refresh 15s · engine scan 30s
        </span>
        <span>Entry / SL / TP / pips are computed from the same closed candles rendered above — no demo model.</span>
      </footer>

      <AlertsDrawer
        open={alertsOpen}
        alerts={alerts}
        onClose={() => setAlertsOpen(false)}
        onMarkRead={() => void fetch("/api/alerts", { method: "POST" }).then(() => setUnread(0))}
      />
      <SettingsDrawer
        open={settingsOpen}
        settings={settings}
        onClose={() => setSettingsOpen(false)}
        onChange={(patch) => void patchSettings(patch)}
        notifState={notifPerm}
        onEnablePush={() => void enablePush()}
      />
      {(alertsOpen || settingsOpen) ? (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
          onClick={() => {
            setAlertsOpen(false);
            setSettingsOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
