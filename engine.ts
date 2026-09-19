import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { alerts, botSettings, scanRuns, signals, type Signal } from "@/db/schema";
import { getCandles, type Candle, type CandleSeries } from "./market/candles";
import {
  INSTRUMENTS,
  TIMEFRAMES,
  formatPrice,
  isInstrument,
  isTimeframe,
  type InstrumentId,
  type TimeframeId,
} from "./market/instruments";
import {
  ENGINE_VERSION,
  MODES,
  buildHtfContext,
  computeIndicators,
  evaluateSetup,
  resolveTrade,
  type EngineMode,
  type SetupResult,
} from "./strategy";

export interface EngineSettings {
  minConfidence: number;
  mode: EngineMode;
  autoScan: boolean;
  pushEnabled: boolean;
  soundEnabled: boolean;
  instruments: InstrumentId[];
  timeframes: TimeframeId[];
  riskPerTrade: number;
  accountSize: number;
}

const DEFAULTS: EngineSettings = {
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

export async function getSettings(): Promise<EngineSettings> {
  const rows = await db.select().from(botSettings).where(eq(botSettings.id, 1)).limit(1);
  if (!rows.length) {
    await db.insert(botSettings).values({ id: 1 }).onConflictDoNothing();
    return DEFAULTS;
  }
  const row = rows[0];
  return {
    minConfidence: row.minConfidence,
    mode: (row.mode as EngineMode) ?? "precision",
    autoScan: row.autoScan,
    pushEnabled: row.pushEnabled,
    soundEnabled: row.soundEnabled,
    instruments: (row.instruments ?? DEFAULTS.instruments).filter(isInstrument),
    timeframes: (row.timeframes ?? DEFAULTS.timeframes).filter(isTimeframe),
    riskPerTrade: row.riskPerTrade,
    accountSize: row.accountSize,
  };
}

export async function saveSettings(patch: Partial<EngineSettings>): Promise<EngineSettings> {
  const current = await getSettings();
  const next: EngineSettings = { ...current, ...patch };
  next.minConfidence = Math.max(60, Math.min(97, Math.round(next.minConfidence)));
  if (!next.instruments.length) next.instruments = DEFAULTS.instruments;
  if (!next.timeframes.length) next.timeframes = DEFAULTS.timeframes;
  await db
    .insert(botSettings)
    .values({ id: 1, ...next, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: botSettings.id,
      set: { ...next, updatedAt: new Date() },
    });
  return next;
}

/** Concurrency-limited map so we never hammer the data providers. */
async function pooled<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      out[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return out;
}

export interface ScanSummary {
  scanned: number;
  created: number;
  resolved: number;
  rejected: number;
  durationMs: number;
  source: string;
  createdSignals: Signal[];
  at: string;
}

interface Bucket {
  instrument: InstrumentId;
  timeframe: TimeframeId;
}

/** Rolling quality control: raise the bar where recent results slipped. */
async function adaptiveThreshold(base: number, instrument: InstrumentId, timeframe: TimeframeId) {
  const recent = await db
    .select({ status: signals.status })
    .from(signals)
    .where(
      and(
        eq(signals.instrument, instrument),
        eq(signals.timeframe, timeframe),
        inArray(signals.status, ["TP", "SL", "EXPIRED"]),
      ),
    )
    .orderBy(desc(signals.createdAt))
    .limit(20);
  if (recent.length < 6) return base;
  const wins = recent.filter((r) => r.status === "TP").length;
  const rate = (wins / recent.length) * 100;
  // Aggressively defend the 80% target: if the rolling strike rate slips,
  // demand progressively higher confluence before another trade is allowed.
  if (rate < 55) return Math.min(97, base + 9);
  if (rate < 70) return Math.min(96, base + 6);
  if (rate < 80) return Math.min(95, base + 3);
  // Comfortably above target — allow a touch more flow.
  if (rate >= 90 && recent.length >= 12) return Math.max(78, base - 2);
  return base;
}

async function trackOpenTrades(series: CandleSeries, open: Signal[]): Promise<number> {
  let resolved = 0;
  const tf = TIMEFRAMES[series.timeframe];
  for (const sig of open) {
    const forward = series.candles.filter((c) => c.time > sig.signalBarTime);
    if (!forward.length) continue;
    const outcome = resolveTrade(
      series.instrument,
      {
        direction: sig.direction as "BUY" | "SELL",
        entry: sig.entry,
        stopLoss: sig.stopLoss,
        takeProfit: sig.takeProfit,
        takeProfit1: sig.takeProfit1,
      },
      forward,
      tf.maxBars,
    );

    if (outcome.status === "OPEN") {
      await db
        .update(signals)
        .set({ mfePips: outcome.mfePips, maePips: outcome.maePips, barsHeld: outcome.barsHeld })
        .where(eq(signals.id, sig.id));
      continue;
    }

    await db
      .update(signals)
      .set({
        status: outcome.status,
        exitPrice: outcome.exitPrice,
        resultPips: outcome.resultPips,
        rMultiple: outcome.rMultiple,
        mfePips: outcome.mfePips,
        maePips: outcome.maePips,
        barsHeld: outcome.barsHeld,
        closedAt: new Date(),
      })
      .where(eq(signals.id, sig.id));

    const won = outcome.status === "TP";
    await db.insert(alerts).values({
      signalId: sig.id,
      kind: outcome.status === "TP" ? "TP_HIT" : outcome.status === "SL" ? "SL_HIT" : "EXPIRED",
      title: `${won ? "🎯 TARGET HIT" : outcome.status === "SL" ? "🛑 STOP HIT" : "⏱ CLOSED AT MARKET"} · ${sig.instrument} ${sig.timeframe}`,
      body: `${sig.direction} closed at ${formatPrice(series.instrument, outcome.exitPrice ?? 0)} for ${outcome.resultPips >= 0 ? "+" : ""}${outcome.resultPips.toFixed(1)} ${INSTRUMENTS[series.instrument].pipLabel} (${outcome.rMultiple.toFixed(2)}R).`,
      instrument: sig.instrument,
      timeframe: sig.timeframe,
      payload: { status: outcome.status, resultPips: outcome.resultPips },
    });
    resolved += 1;
  }
  return resolved;
}

export async function runScan(settingsOverride?: Partial<EngineSettings>): Promise<ScanSummary> {
  const started = Date.now();
  const settings = { ...(await getSettings()), ...settingsOverride };
  const buckets: Bucket[] = [];
  for (const instrument of settings.instruments) {
    for (const timeframe of settings.timeframes) buckets.push({ instrument, timeframe });
  }

  const openRows = await db.select().from(signals).where(eq(signals.status, "OPEN"));
  const sources = new Set<string>();
  let created = 0;
  let resolvedTotal = 0;
  let rejected = 0;
  const createdSignals: Signal[] = [];

  await pooled(buckets, 4, async ({ instrument, timeframe }) => {
    try {
      const tf = TIMEFRAMES[timeframe];
      const [series, htfSeries] = await Promise.all([
        getCandles(instrument, timeframe),
        getCandles(instrument, tf.htf),
      ]);
      sources.add(series.source);
      const bucketOpen = openRows.filter(
        (s) => s.instrument === instrument && s.timeframe === timeframe,
      );
      resolvedTotal += await trackOpenTrades(series, bucketOpen);

      const closed = series.closed;
      if (closed.length < 220) return;

      // One live idea per instrument+timeframe, plus a bar cooldown.
      const stillOpen = await db
        .select({ id: signals.id })
        .from(signals)
        .where(
          and(
            eq(signals.instrument, instrument),
            eq(signals.timeframe, timeframe),
            eq(signals.status, "OPEN"),
          ),
        )
        .limit(1);
      if (stillOpen.length) return;

      const lastAny = await db
        .select({ barTime: signals.signalBarTime })
        .from(signals)
        .where(and(eq(signals.instrument, instrument), eq(signals.timeframe, timeframe)))
        .orderBy(desc(signals.signalBarTime))
        .limit(1);
      const index = closed.length - 1;
      const bar = closed[index];
      if (lastAny.length && bar.time - lastAny[0].barTime < tf.cooldownBars * tf.seconds) return;

      const indicators = computeIndicators(closed);
      const htf = buildHtfContext(htfSeries.closed, tf.htf);
      const threshold = await adaptiveThreshold(settings.minConfidence, instrument, timeframe);
      const setup = evaluateSetup({
        instrument,
        timeframe,
        candles: closed,
        index,
        indicators,
        htf,
        mode: settings.mode,
        minConfidence: threshold,
      });

      if (!setup.ok || !setup.plan) {
        rejected += 1;
        return;
      }

      const inserted = await db
        .insert(signals)
        .values({
          instrument,
          timeframe,
          direction: setup.plan.direction,
          mode: settings.mode,
          entry: setup.plan.entry,
          stopLoss: setup.plan.stopLoss,
          takeProfit: setup.plan.takeProfit,
          takeProfit1: setup.plan.takeProfit1,
          riskPips: setup.plan.riskPips,
          rewardPips: setup.plan.rewardPips,
          riskReward: setup.plan.riskReward,
          confidence: setup.confidence,
          atr: setup.plan.atr,
          htfBias: setup.htfBias,
          reasons: setup.reasons,
          filters: setup.filters,
          signalBarTime: setup.barTime,
          dataSource: series.source,
          engineVersion: ENGINE_VERSION,
          status: "OPEN",
        })
        .onConflictDoNothing()
        .returning();

      if (!inserted.length) return;
      created += 1;
      createdSignals.push(inserted[0]);

      const pipLabel = INSTRUMENTS[instrument].pipLabel;
      await db.insert(alerts).values({
        signalId: inserted[0].id,
        kind: "NEW_SIGNAL",
        title: `${setup.plan.direction === "BUY" ? "🟢 BUY" : "🔴 SELL"} ${INSTRUMENTS[instrument].label} · ${timeframe}`,
        body:
          `Entry ${formatPrice(instrument, setup.plan.entry)} · SL ${formatPrice(instrument, setup.plan.stopLoss)} · ` +
          `TP ${formatPrice(instrument, setup.plan.takeProfit)} · ${setup.plan.rewardPips.toFixed(1)} ${pipLabel} target · ` +
          `${setup.confidence}% confluence`,
        instrument,
        timeframe,
        payload: {
          direction: setup.plan.direction,
          entry: setup.plan.entry,
          stopLoss: setup.plan.stopLoss,
          takeProfit: setup.plan.takeProfit,
          confidence: setup.confidence,
        },
      });
    } catch {
      // A single broken bucket must never abort the whole scan.
    }
  });

  const durationMs = Date.now() - started;
  const source = sources.has("live") ? "live" : sources.has("fallback") ? "fallback" : "simulated";
  await db.insert(scanRuns).values({
    scanned: buckets.length,
    created,
    resolved: resolvedTotal,
    rejected,
    durationMs,
    source,
  });

  return {
    scanned: buckets.length,
    created,
    resolved: resolvedTotal,
    rejected,
    durationMs,
    source,
    createdSignals,
    at: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ *
 * Backtest — identical evaluation + identical fill logic as live.
 * ------------------------------------------------------------------ */
export interface BacktestTrade {
  time: number;
  direction: "BUY" | "SELL";
  entry: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;
  status: string;
  resultPips: number;
  rMultiple: number;
  barsHeld: number;
}

export interface BacktestResult {
  instrument: InstrumentId;
  timeframe: TimeframeId;
  mode: EngineMode;
  minConfidence: number;
  barsTested: number;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  netPips: number;
  profitFactor: number;
  expectancyR: number;
  avgWinPips: number;
  avgLossPips: number;
  maxDrawdownR: number;
  rejections: { code: string; count: number }[];
  equity: number[];
  sample: BacktestTrade[];
  source: string;
}

export async function runBacktest(
  instrument: InstrumentId,
  timeframe: TimeframeId,
  mode: EngineMode,
  minConfidence: number,
): Promise<BacktestResult> {
  const tf = TIMEFRAMES[timeframe];
  const [series, htfSeries] = await Promise.all([
    getCandles(instrument, timeframe),
    getCandles(instrument, tf.htf),
  ]);
  const candles: Candle[] = series.closed;
  const indicators = computeIndicators(candles);
  const htf = buildHtfContext(htfSeries.closed, tf.htf);

  const trades: BacktestTrade[] = [];
  const rejectTally = new Map<string, number>();
  let blockedUntilBar = 0;
  for (let i = 215; i < candles.length - 2; i += 1) {
    if (i < blockedUntilBar) continue;
    const view = candles.slice(0, i + 1);
    const setup: SetupResult = evaluateSetup({
      instrument,
      timeframe,
      candles: view,
      index: i,
      indicators,
      htf,
      mode,
      minConfidence,
    });
    rejectTally.set(setup.code, (rejectTally.get(setup.code) ?? 0) + 1);
    if (!setup.ok || !setup.plan) continue;
    const forward = candles.slice(i + 1);
    const outcome = resolveTrade(instrument, setup.plan, forward, tf.maxBars);
    if (outcome.status === "OPEN") continue;
    trades.push({
      time: candles[i].time,
      direction: setup.plan.direction,
      entry: setup.plan.entry,
      stopLoss: setup.plan.stopLoss,
      takeProfit: setup.plan.takeProfit,
      confidence: setup.confidence,
      status: outcome.status,
      resultPips: outcome.resultPips,
      rMultiple: outcome.rMultiple,
      barsHeld: outcome.barsHeld,
    });
    blockedUntilBar = i + Math.max(outcome.barsHeld, tf.cooldownBars);
  }

  const wins = trades.filter((t) => t.resultPips > 0);
  const losses = trades.filter((t) => t.resultPips <= 0);
  const grossWin = wins.reduce((a, t) => a + t.resultPips, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.resultPips, 0));
  const equity: number[] = [];
  let running = 0;
  let peak = 0;
  let maxDd = 0;
  for (const t of trades) {
    running += t.rMultiple;
    equity.push(Number(running.toFixed(3)));
    peak = Math.max(peak, running);
    maxDd = Math.max(maxDd, peak - running);
  }

  return {
    instrument,
    timeframe,
    mode,
    minConfidence,
    barsTested: candles.length,
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
    netPips: trades.reduce((a, t) => a + t.resultPips, 0),
    profitFactor: grossLoss === 0 ? (grossWin > 0 ? 99 : 0) : grossWin / grossLoss,
    expectancyR: trades.length ? trades.reduce((a, t) => a + t.rMultiple, 0) / trades.length : 0,
    avgWinPips: wins.length ? grossWin / wins.length : 0,
    avgLossPips: losses.length ? grossLoss / losses.length : 0,
    maxDrawdownR: maxDd,
    rejections: [...rejectTally.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count),
    equity,
    sample: trades.slice(-40).reverse(),
    source: series.source,
  };
}

/* ------------------------------------------------------------------ *
 * Live snapshot for the dashboard (what the engine sees right now).
 * ------------------------------------------------------------------ */
export interface MarketSnapshot {
  instrument: InstrumentId;
  timeframe: TimeframeId;
  livePrice: number;
  changePct: number;
  source: string;
  provider: string;
  lastBarTime: number;
  atr: number;
  adx: number;
  rsi: number;
  ema21: number;
  ema50: number;
  ema200: number;
  htfBias: string;
  status: "SIGNAL" | "WATCH" | "STANDBY";
  confidence: number;
  direction: "BUY" | "SELL" | null;
  reasons: string[];
  rejections: string[];
  nextStep: string;
}

export async function getSnapshot(
  instrument: InstrumentId,
  timeframe: TimeframeId,
  mode: EngineMode,
  minConfidence: number,
): Promise<MarketSnapshot> {
  const tf = TIMEFRAMES[timeframe];
  const [series, htfSeries] = await Promise.all([
    getCandles(instrument, timeframe),
    getCandles(instrument, tf.htf),
  ]);
  const closed = series.closed;
  const indicators = computeIndicators(closed);
  const htf = buildHtfContext(htfSeries.closed, tf.htf);
  const index = closed.length - 1;
  const setup = evaluateSetup({
    instrument,
    timeframe,
    candles: closed,
    index,
    indicators,
    htf,
    mode,
    minConfidence,
  });

  const dayBars = Math.max(1, Math.round(86400 / tf.seconds));
  const ref = closed[Math.max(0, index - dayBars)]?.close ?? closed[0].close;
  const changePct = ((series.livePrice - ref) / ref) * 100;

  const status: MarketSnapshot["status"] = setup.ok
    ? "SIGNAL"
    : setup.confidence >= Math.max(55, minConfidence - 12)
      ? "WATCH"
      : "STANDBY";

  return {
    instrument,
    timeframe,
    livePrice: series.livePrice,
    changePct,
    source: series.source,
    provider: series.provider,
    lastBarTime: closed[index]?.time ?? 0,
    atr: indicators.atr14[index] ?? 0,
    adx: indicators.adx[index] ?? 0,
    rsi: indicators.rsi14[index] ?? 0,
    ema21: indicators.ema21[index] ?? 0,
    ema50: indicators.ema50[index] ?? 0,
    ema200: indicators.ema200[index] ?? 0,
    htfBias: setup.htfBias,
    status,
    confidence: setup.confidence,
    direction: setup.direction,
    reasons: setup.reasons,
    rejections: setup.rejections,
    nextStep:
      setup.rejections[0] ??
      (setup.ok ? "Valid setup — order parameters published" : "Monitoring for confirmation"),
  };
}

export async function getPerformance() {
  const rows = await db
    .select()
    .from(signals)
    .where(inArray(signals.status, ["TP", "SL", "EXPIRED"]))
    .orderBy(desc(signals.closedAt))
    .limit(500);

  const wins = rows.filter((r) => (r.resultPips ?? 0) > 0);
  const losses = rows.filter((r) => (r.resultPips ?? 0) <= 0);
  const grossWin = wins.reduce((a, r) => a + (r.resultPips ?? 0), 0);
  const grossLoss = Math.abs(losses.reduce((a, r) => a + (r.resultPips ?? 0), 0));
  const byInstrument = new Map<string, { trades: number; wins: number; pips: number }>();
  for (const r of rows) {
    const cur = byInstrument.get(r.instrument) ?? { trades: 0, wins: 0, pips: 0 };
    cur.trades += 1;
    if ((r.resultPips ?? 0) > 0) cur.wins += 1;
    cur.pips += r.resultPips ?? 0;
    byInstrument.set(r.instrument, cur);
  }

  const [{ count: openCount }] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(signals)
    .where(eq(signals.status, "OPEN"));

  return {
    trades: rows.length,
    wins: wins.length,
    losses: losses.length,
    winRate: rows.length ? (wins.length / rows.length) * 100 : 0,
    netPips: rows.reduce((a, r) => a + (r.resultPips ?? 0), 0),
    profitFactor: grossLoss === 0 ? (grossWin > 0 ? 99 : 0) : grossWin / grossLoss,
    expectancyR: rows.length ? rows.reduce((a, r) => a + (r.rMultiple ?? 0), 0) / rows.length : 0,
    openCount,
    byInstrument: [...byInstrument.entries()].map(([instrument, v]) => ({
      instrument,
      trades: v.trades,
      winRate: v.trades ? (v.wins / v.trades) * 100 : 0,
      pips: v.pips,
    })),
    equity: rows
      .slice()
      .reverse()
      .reduce<number[]>((acc, r) => {
        const prev = acc.length ? acc[acc.length - 1] : 0;
        acc.push(Number((prev + (r.rMultiple ?? 0)).toFixed(3)));
        return acc;
      }, []),
    modes: MODES,
  };
}
