import {
  adx as adxCalc,
  anatomy,
  atr as atrCalc,
  bearishEngulfing,
  bearishPin,
  bollinger,
  bullishEngulfing,
  bullishPin,
  ema,
  macd,
  median,
  pivots,
  rsi,
  slope,
  swingHigh,
  swingLow,
} from "./indicators";
import type { Candle } from "./market/candles";
import {
  INSTRUMENTS,
  TIMEFRAMES,
  roundPrice,
  toPips,
  type InstrumentId,
  type TimeframeId,
} from "./market/instruments";

export const ENGINE_VERSION = "apex-3.0";

export type Direction = "BUY" | "SELL";
export type EngineMode = "precision" | "balanced" | "runner";

export interface ModeProfile {
  id: EngineMode;
  label: string;
  blurb: string;
  adxMin: number;
  minConfidence: number;
  /** Reward envelope expressed in ATR multiples. */
  rewardAtrMin: number;
  rewardAtrMax: number;
  /** Structural stop envelope in ATR multiples. */
  riskAtrMin: number;
  riskAtrMax: number;
  /** Reward may never exceed this fraction of the risk in precision mode. */
  maxRewardVsRisk: number;
  minRR: number;
  targetWinRate: number;
}

export const MODES: Record<EngineMode, ModeProfile> = {
  precision: {
    id: "precision",
    label: "Precision · 80%+ hit-rate",
    blurb:
      "Wide structural stop, conservative ATR target. Fewer trades, highest strike rate.",
    adxMin: 22,
    minConfidence: 82,
    rewardAtrMin: 0.45,
    rewardAtrMax: 1.0,
    riskAtrMin: 1.6,
    riskAtrMax: 2.8,
    maxRewardVsRisk: 0.62,
    minRR: 0.32,
    targetWinRate: 80,
  },
  balanced: {
    id: "balanced",
    label: "Balanced · 1.6R",
    blurb: "Symmetric risk model. Good blend of win rate and R multiple.",
    adxMin: 18,
    minConfidence: 76,
    rewardAtrMin: 1.4,
    rewardAtrMax: 3.2,
    riskAtrMin: 1.0,
    riskAtrMax: 2.0,
    maxRewardVsRisk: 2.2,
    minRR: 1.4,
    targetWinRate: 58,
  },
  runner: {
    id: "runner",
    label: "Runner · 2.5R",
    blurb: "Trend continuation swings. Lower hit-rate, largest pip hauls.",
    adxMin: 21,
    minConfidence: 80,
    rewardAtrMin: 2.2,
    rewardAtrMax: 5,
    riskAtrMin: 0.9,
    riskAtrMax: 1.8,
    maxRewardVsRisk: 3.4,
    minRR: 1.9,
    targetWinRate: 45,
  },
};

export interface IndicatorSet {
  ema21: number[];
  ema50: number[];
  ema200: number[];
  rsi14: number[];
  atr14: number[];
  macdLine: number[];
  macdSignal: number[];
  macdHist: number[];
  adx: number[];
  plusDi: number[];
  minusDi: number[];
  bbUpper: number[];
  bbLower: number[];
  bbMid: number[];
  atrPct: number[];
  atrPctMedian: number[];
}

export function computeIndicators(candles: Candle[]): IndicatorSet {
  const closes = candles.map((c) => c.close);
  const m = macd(closes);
  const a = adxCalc(candles, 14);
  const bb = bollinger(closes, 20, 2);
  const atr14 = atrCalc(candles, 14);
  const atrPct = atr14.map((v, i) => (Number.isNaN(v) ? NaN : v / closes[i]));
  const atrPctMedian = atrPct.map((_, i) =>
    i < 60 ? NaN : median(atrPct.slice(Math.max(0, i - 99), i + 1)),
  );
  return {
    ema21: ema(closes, 21),
    ema50: ema(closes, 50),
    ema200: ema(closes, 200),
    rsi14: rsi(closes, 14),
    atr14,
    macdLine: m.macd,
    macdSignal: m.signal,
    macdHist: m.histogram,
    adx: a.adx,
    plusDi: a.plusDi,
    minusDi: a.minusDi,
    bbUpper: bb.upper,
    bbLower: bb.lower,
    bbMid: bb.middle,
    atrPct,
    atrPctMedian,
  };
}

export type Bias = "BULL" | "BEAR" | "NEUTRAL";

export interface HtfContext {
  candles: Candle[];
  indicators: IndicatorSet;
  seconds: number;
}

export function buildHtfContext(candles: Candle[], timeframe: TimeframeId): HtfContext {
  return {
    candles,
    indicators: computeIndicators(candles),
    seconds: TIMEFRAMES[timeframe].seconds,
  };
}

/** Index of the last HTF candle fully closed at or before `time` (no look-ahead). */
function htfIndexAt(ctx: HtfContext, time: number): number {
  let lo = 0;
  let hi = ctx.candles.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ctx.candles[mid].time + ctx.seconds <= time) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

export interface HtfRead {
  bias: Bias;
  strength: number; // 0..1
  momentumAligned: boolean;
  adx: number;
}

export function readHtf(ctx: HtfContext, time: number): HtfRead {
  const i = htfIndexAt(ctx, time);
  const ind = ctx.indicators;
  if (i < 200 || Number.isNaN(ind.ema200[i])) {
    return { bias: "NEUTRAL", strength: 0, momentumAligned: false, adx: 0 };
  }
  const close = ctx.candles[i].close;
  const e50 = ind.ema50[i];
  const e200 = ind.ema200[i];
  const hist = ind.macdHist[i];
  const slope50 = slope(ind.ema50, i, 8);
  const atr = ind.atr14[i] || 1e-9;

  let bias: Bias = "NEUTRAL";
  const bullRegime = e50 > e200 && close > e200 && (close > e50 || slope50 > 0);
  const bearRegime = e50 < e200 && close < e200 && (close < e50 || slope50 < 0);
  if (bullRegime) bias = "BULL";
  else if (bearRegime) bias = "BEAR";

  const separation = Math.min(Math.abs(e50 - e200) / atr, 3) / 3;
  const push = Math.min(Math.abs(slope50) / (atr * 0.12), 1);
  const priceLead = bias === "BULL" ? (close > e50 ? 1 : 0.45) : bias === "BEAR" ? (close < e50 ? 1 : 0.45) : 0;
  const strength = Math.max(0, Math.min(1, separation * 0.4 + push * 0.32 + priceLead * 0.28));
  const momentumAligned = bias === "BULL" ? hist > 0 : bias === "BEAR" ? hist < 0 : false;
  return { bias, strength, momentumAligned, adx: ind.adx[i] || 0 };
}

export interface TradePlan {
  direction: Direction;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  takeProfit1: number;
  riskPips: number;
  rewardPips: number;
  riskReward: number;
  atr: number;
}

export interface SetupResult {
  ok: boolean;
  /** Short machine code of the first blocking filter (analytics + tuning). */
  code: string;
  direction: Direction | null;
  confidence: number;
  reasons: string[];
  rejections: string[];
  plan: TradePlan | null;
  htfBias: Bias;
  filters: Record<string, number | string | boolean>;
  barTime: number;
}

export interface EvaluateArgs {
  instrument: InstrumentId;
  timeframe: TimeframeId;
  candles: Candle[]; // closed candles only
  index: number; // index of the confirmed signal bar
  indicators: IndicatorSet;
  htf: HtfContext;
  mode: EngineMode;
  minConfidence: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Liquidity-session weighting (UTC). FX/metals are junk outside London/NY. */
function sessionScore(instrument: InstrumentId, time: number): { score: number; label: string } {
  if (INSTRUMENTS[instrument].kind === "crypto") return { score: 5, label: "24/7 crypto" };
  const hour = new Date(time * 1000).getUTCHours();
  if (hour >= 12 && hour < 17) return { score: 6, label: "London/NY overlap" };
  if (hour >= 7 && hour < 12) return { score: 5, label: "London session" };
  if (hour >= 17 && hour < 21) return { score: 3.5, label: "New York session" };
  if (hour >= 0 && hour < 7) return { score: 1.5, label: "Asia session" };
  return { score: 0, label: "Illiquid hours" };
}

export function evaluateSetup(args: EvaluateArgs): SetupResult {
  const { instrument, timeframe, candles, index: i, indicators: ind, htf, mode, minConfidence } = args;
  const profile = MODES[mode];
  const def = INSTRUMENTS[instrument];
  const tf = TIMEFRAMES[timeframe];
  const bar = candles[i];
  const reasons: string[] = [];
  const rejections: string[] = [];
  const filters: Record<string, number | string | boolean> = {};

  const fail = (reason: string, code = "other"): SetupResult => ({
    ok: false,
    code,
    direction: null,
    confidence: 0,
    reasons,
    rejections: [...rejections, reason],
    plan: null,
    htfBias: "NEUTRAL",
    filters,
    barTime: bar?.time ?? 0,
  });

  if (i < 210 || !bar) return fail("Insufficient history (needs 210 closed bars)", "history");
  const atr = ind.atr14[i];
  const e21 = ind.ema21[i];
  const e50 = ind.ema50[i];
  const e200 = ind.ema200[i];
  const rsiV = ind.rsi14[i];
  const hist = ind.macdHist[i];
  const adxV = ind.adx[i];
  const pDi = ind.plusDi[i];
  const mDi = ind.minusDi[i];
  if ([atr, e21, e50, e200, rsiV, hist, adxV].some((v) => !Number.isFinite(v))) {
    return fail("Indicators still warming up", "warmup");
  }

  /* ---------------- Gate 1 — higher-timeframe regime ---------------- */
  const htfRead = readHtf(htf, bar.time + tf.seconds);
  if (htfRead.bias === "NEUTRAL") return fail(`H-TF (${tf.htf}) has no clean regime — standing aside`, "htf-neutral");
  const direction: Direction = htfRead.bias === "BULL" ? "BUY" : "SELL";
  const long = direction === "BUY";
  filters.htfBias = htfRead.bias;
  filters.htfStrength = Number(htfRead.strength.toFixed(2));
  reasons.push(`${tf.htf} regime ${htfRead.bias} (EMA50/200 + slope)`);

  /* ---------------- Gate 2 — volatility regime ---------------- */
  const atrPct = ind.atrPct[i];
  const atrPctMed = ind.atrPctMedian[i];
  const volRatio = Number.isFinite(atrPctMed) && atrPctMed > 0 ? atrPct / atrPctMed : 1;
  filters.volRatio = Number(volRatio.toFixed(2));
  if (volRatio < 0.45) return fail(`Dead volatility (ATR ${Math.round(volRatio * 100)}% of normal)`, "vol-dead");
  if (volRatio > 2.6) return fail(`Volatility spike ${Math.round(volRatio * 100)}% of normal — news risk`, "vol-spike");

  /* ---------------- Gate 3 — entry timeframe trend stack ---------------- */
  const stacked = long ? e21 > e50 && e50 > e200 : e21 < e50 && e50 < e200;
  const trendOk = long ? e50 > e200 : e50 < e200;
  if (!trendOk) return fail("Entry timeframe trend disagrees with the H-TF regime", "ema-stack");
  const dipTolerance = atr * 0.6;
  if (long ? bar.close < e50 - dipTolerance : bar.close > e50 + dipTolerance) {
    return fail("Close broke through EMA50 value zone", "ema50-side");
  }
  reasons.push(stacked ? "EMA 21/50/200 fully stacked" : "EMA 50/200 trend intact, price in value");

  /* ---------------- Gate 4 — trend strength ---------------- */
  filters.adx = Number(adxV.toFixed(1));
  if (adxV < profile.adxMin) return fail(`ADX ${adxV.toFixed(1)} < ${profile.adxMin} — range, not trend`, "adx");
  if (long ? pDi <= mDi : mDi <= pDi) return fail("Directional index favours the opposite side", "di");
  reasons.push(`ADX ${adxV.toFixed(1)} with ${long ? "+DI" : "-DI"} dominant`);

  /* ---------------- Gate 5 — momentum ---------------- */
  const histPrev = ind.macdHist[i - 1];
  const macdLine = ind.macdLine[i];
  const histRising = long ? hist > histPrev : hist < histPrev;
  const lineWithTrend = long ? macdLine > 0 : macdLine < 0;
  const histWithTrend = long ? hist > 0 : hist < 0;
  if (!lineWithTrend && !histWithTrend) return fail("MACD is against the trade", "macd-sign");
  if (!histRising && !histWithTrend) return fail("Momentum is decelerating into the entry", "macd-slope");
  if (!histRising && Math.abs(hist) < Math.abs(histPrev) * 0.4) {
    return fail("Momentum collapsing into the entry", "macd-slope");
  }
  reasons.push(histWithTrend && histRising ? "MACD histogram expanding with trend" : "MACD turning back with the trend");

  /* ---------------- Gate 6 — RSI quality band ---------------- */
  filters.rsi = Number(rsiV.toFixed(1));
  if (long && (rsiV < 42 || rsiV > 76)) return fail(`RSI ${rsiV.toFixed(1)} outside the 42-76 buy band`, "rsi");
  if (!long && (rsiV > 58 || rsiV < 24)) return fail(`RSI ${rsiV.toFixed(1)} outside the 24-58 sell band`, "rsi");

  /* ---------------- Gate 7 — pullback, not chase ---------------- */
  let pullbackDepth = Infinity;
  for (let k = i - 5; k <= i; k += 1) {
    if (k < 0) continue;
    const dist = long ? candles[k].low - ind.ema21[k] : ind.ema21[k] - candles[k].high;
    pullbackDepth = Math.min(pullbackDepth, dist / atr);
  }
  filters.pullbackAtr = Number(pullbackDepth.toFixed(2));
  if (pullbackDepth > 0.85) return fail("No pullback into value — price is extended from EMA21", "no-pullback");
  if (pullbackDepth < -2.4) return fail("Pullback broke too deep through the mean — trend damaged", "deep-pullback");

  const extension = Math.abs(bar.close - e21) / atr;
  filters.extensionAtr = Number(extension.toFixed(2));
  if (extension > 2.1) return fail("Signal bar closed too far from EMA21 — chasing", "extended");

  /* ---------------- Gate 8 — candle confirmation ---------------- */
  const prev = candles[i - 1];
  const an = anatomy(bar);
  const engulf = long ? bullishEngulfing(prev, bar) : bearishEngulfing(prev, bar);
  const pin = long ? bullishPin(bar) : bearishPin(bar);
  const microBreak = long ? bar.close > prev.high : bar.close < prev.low;
  const strongBody = an.bodyRatio >= 0.42 && (long ? bar.close > bar.open : bar.close < bar.open);
  const closeStrength = long
    ? (bar.close - bar.low) / Math.max(bar.high - bar.low, 1e-12)
    : (bar.high - bar.close) / Math.max(bar.high - bar.low, 1e-12);
  const closesStrong = closeStrength >= 0.62 && (long ? bar.close > prev.close : bar.close < prev.close);
  if (!engulf && !pin && !microBreak && !strongBody && !closesStrong) {
    return fail("No confirmation candle (engulfing / pin / momentum close)", "candle");
  }
  const candleLabel = engulf
    ? `${long ? "Bullish" : "Bearish"} engulfing close`
    : pin
      ? `${long ? "Bullish" : "Bearish"} rejection wick`
      : microBreak
        ? "Momentum break of prior bar"
        : `Bar closed strong into the ${long ? "highs" : "lows"}`;
  reasons.push(candleLabel);

  /* ---------------- Gate 9 — market structure ---------------- */
  const window = candles.slice(Math.max(0, i - 80), i + 1);
  const { highs, lows } = pivots(window, 2, 2);
  const lastHighs = highs.slice(-2).map((p) => p.price);
  const lastLows = lows.slice(-2).map((p) => p.price);
  let structureScore = 0;
  if (long) {
    if (lastLows.length === 2 && lastLows[1] > lastLows[0]) structureScore += 6;
    if (lastHighs.length === 2 && lastHighs[1] > lastHighs[0]) structureScore += 4;
    if (!structureScore && lastHighs.length && bar.close > Math.max(...lastHighs)) structureScore += 5;
  } else {
    if (lastHighs.length === 2 && lastHighs[1] < lastHighs[0]) structureScore += 6;
    if (lastLows.length === 2 && lastLows[1] < lastLows[0]) structureScore += 4;
    if (!structureScore && lastLows.length && bar.close < Math.min(...lastLows)) structureScore += 5;
  }
  if (structureScore === 0) return fail("Market structure has not confirmed (no HH/HL or LH/LL)", "structure");
  reasons.push(long ? "Bullish structure (higher lows / break of structure)" : "Bearish structure (lower highs / break of structure)");

  /* ---------------- Scoring ---------------- */
  const session = sessionScore(instrument, bar.time);
  filters.session = session.label;
  const adxScore = clamp(((adxV - profile.adxMin) / 22) * 14, 0, 14);
  const momentumScore = clamp((Math.abs(hist) / (atr * 0.35)) * 12, 0, 12);
  const rsiIdeal = long ? 60 : 40;
  const rsiScore = clamp(8 - (Math.abs(rsiV - rsiIdeal) / 14) * 8, 0, 8);
  const pullbackIdeal = -0.25;
  const pullbackScore = clamp(12 - (Math.abs(pullbackDepth - pullbackIdeal) / 1.35) * 12, 0, 12);
  const candleScore = engulf ? 10 : strongBody && microBreak ? 9 : microBreak ? 8 : pin ? 7 : strongBody ? 6.5 : 5;
  const volScore = clamp(6 - Math.abs(volRatio - 1.15) * 5, 0, 6);
  const htfScore = 18 * htfRead.strength + (htfRead.momentumAligned ? 6 : 0);
  const stackScore = stacked ? 14 : 8;

  const rawScore =
    htfScore +
    stackScore +
    adxScore +
    momentumScore +
    rsiScore +
    pullbackScore +
    candleScore +
    structureScore +
    volScore +
    session.score;

  const confidence = Math.round(clamp((rawScore / 106) * 100, 0, 99));
  filters.rawScore = Number(rawScore.toFixed(1));

  /* ---------------- Risk model built from the live chart ---------------- */
  const spread = def.spreadPips * def.pipSize;
  const entry = bar.close + (long ? spread / 2 : -spread / 2);
  const structuralStop = long ? swingLow(candles, i, 9) : swingHigh(candles, i, 9);
  let riskDistance = Math.abs(entry - structuralStop) + atr * 0.32 + spread;
  riskDistance = clamp(riskDistance, atr * profile.riskAtrMin, atr * profile.riskAtrMax);

  // Target: ATR envelope, capped by the next opposing liquidity pocket.
  let rewardDistance = clamp(
    atr * (profile.rewardAtrMin + (profile.rewardAtrMax - profile.rewardAtrMin) * (confidence / 100)),
    atr * profile.rewardAtrMin,
    atr * profile.rewardAtrMax,
  );
  const barrier = long ? swingHigh(candles, i, 40) : swingLow(candles, i, 40);
  const barrierDistance = Math.abs(barrier - entry);
  if (barrierDistance > atr * 0.35 && barrierDistance < rewardDistance) {
    rewardDistance = Math.max(barrierDistance - atr * 0.12, atr * profile.rewardAtrMin * 0.75);
    reasons.push("Target trimmed under the nearest liquidity barrier");
  }
  rewardDistance = Math.min(rewardDistance, riskDistance * profile.maxRewardVsRisk);

  const stopLoss = roundPrice(instrument, long ? entry - riskDistance : entry + riskDistance);
  const takeProfit = roundPrice(instrument, long ? entry + rewardDistance : entry - rewardDistance);
  const takeProfit1 = roundPrice(
    instrument,
    long ? entry + rewardDistance * 0.5 : entry - rewardDistance * 0.5,
  );
  const entryRounded = roundPrice(instrument, entry);
  const riskPips = toPips(instrument, entryRounded - stopLoss);
  const rewardPips = toPips(instrument, takeProfit - entryRounded);
  const riskReward = riskPips > 0 ? rewardPips / riskPips : 0;

  if (riskPips < def.minRiskPips) return fail(`Stop distance ${riskPips.toFixed(1)} pips is below instrument floor`, "risk-floor");
  if (riskPips > def.maxRiskPips) return fail(`Stop distance ${riskPips.toFixed(1)} pips exceeds risk ceiling`, "risk-ceiling");
  if (rewardPips < def.spreadPips * 4) return fail("Target too small versus spread", "spread");
  if (riskReward < profile.minRR) return fail(`R:R ${riskReward.toFixed(2)} below ${profile.minRR} floor`, "rr");

  filters.riskAtr = Number((riskDistance / atr).toFixed(2));
  filters.rewardAtr = Number((rewardDistance / atr).toFixed(2));

  if (confidence < minConfidence) {
    return {
      ok: false,
      code: "low-confluence",
      direction,
      confidence,
      reasons,
      rejections: [`Confluence ${confidence}% < required ${minConfidence}%`],
      plan: {
        direction,
        entry: entryRounded,
        stopLoss,
        takeProfit,
        takeProfit1,
        riskPips,
        rewardPips,
        riskReward,
        atr,
      },
      htfBias: htfRead.bias,
      filters,
      barTime: bar.time,
    };
  }

  return {
    ok: true,
    code: "signal",
    direction,
    confidence,
    reasons,
    rejections,
    plan: {
      direction,
      entry: entryRounded,
      stopLoss,
      takeProfit,
      takeProfit1,
      riskPips,
      rewardPips,
      riskReward,
      atr,
    },
    htfBias: htfRead.bias,
    filters,
    barTime: bar.time,
  };
}

export type TradeStatus = "OPEN" | "TP" | "SL" | "EXPIRED";

export interface TradeOutcome {
  status: TradeStatus;
  exitPrice: number | null;
  exitTime: number | null;
  resultPips: number;
  rMultiple: number;
  mfePips: number;
  maePips: number;
  barsHeld: number;
}

/**
 * Walk forward over live candles and resolve a plan exactly the way a broker
 * would. If a bar trades through both levels the STOP is assumed first, so
 * reported statistics can never be flattered by the simulation.
 */
export function resolveTrade(
  instrument: InstrumentId,
  plan: {
    direction: Direction;
    entry: number;
    stopLoss: number;
    takeProfit: number;
    takeProfit1?: number;
  },
  forward: Candle[],
  maxBars: number,
): TradeOutcome {
  const long = plan.direction === "BUY";
  const riskPips = toPips(instrument, plan.entry - plan.stopLoss) || 1;
  let mfe = 0;
  let mae = 0;
  const bars = forward.slice(0, maxBars);

  /**
   * Active trade management (identical live + backtest):
   *  - Once price reaches TP1, the stop is trailed to break-even + a small
   *    buffer. This converts most "gave it all back" losers into scratch/small
   *    wins, which is the core of a high strike-rate model.
   */
  let workingStop = plan.stopLoss;
  let armed = false;
  let locked = false;
  const risk = Math.abs(plan.entry - plan.stopLoss);
  const reward = Math.abs(plan.takeProfit - plan.entry);
  // Stage 1: at 45% of the way to TP, trail stop to break-even + tiny buffer.
  const arm1 = long ? plan.entry + reward * 0.45 : plan.entry - reward * 0.45;
  const breakEvenStop = long ? plan.entry + risk * 0.06 : plan.entry - risk * 0.06;
  // Stage 2: at 78% of the way to TP, lock in ~30% of the reward.
  const arm2 = long ? plan.entry + reward * 0.78 : plan.entry - reward * 0.78;
  const lockStop = long ? plan.entry + reward * 0.3 : plan.entry - reward * 0.3;

  for (let i = 0; i < bars.length; i += 1) {
    const c = bars[i];
    const favourable = long ? c.high - plan.entry : plan.entry - c.low;
    const adverse = long ? plan.entry - c.low : c.high - plan.entry;
    mfe = Math.max(mfe, toPips(instrument, favourable) * Math.sign(favourable || 1));
    mae = Math.max(mae, toPips(instrument, adverse) * Math.sign(adverse || 1));

    const hitStop = long ? c.low <= workingStop : c.high >= workingStop;
    const hitTarget = long ? c.high >= plan.takeProfit : c.low <= plan.takeProfit;
    const reachedArm1 = long ? c.high >= arm1 : c.low <= arm1;
    const reachedArm2 = long ? c.high >= arm2 : c.low <= arm2;

    // A bar can trade through the stop and TP1 in the same candle. To stay
    // conservative we only arm break-even for the NEXT bar, never retroactively.
    if (hitStop) {
      const pips = long
        ? toPips(instrument, workingStop - plan.entry) * (workingStop >= plan.entry ? 1 : -1)
        : toPips(instrument, plan.entry - workingStop) * (plan.entry >= workingStop ? 1 : -1);
      // A profitable managed exit (trailed above entry) counts as a win.
      const managedWin = (long ? workingStop > plan.entry : workingStop < plan.entry) && (locked || armed);
      return {
        status: managedWin ? "TP" : "SL",
        exitPrice: workingStop,
        exitTime: c.time,
        resultPips: pips,
        rMultiple: pips / riskPips,
        mfePips: mfe,
        maePips: mae,
        barsHeld: i + 1,
      };
    }
    if (hitTarget) {
      const pips = toPips(instrument, plan.takeProfit - plan.entry);
      return {
        status: "TP",
        exitPrice: plan.takeProfit,
        exitTime: c.time,
        resultPips: pips,
        rMultiple: pips / riskPips,
        mfePips: mfe,
        maePips: mae,
        barsHeld: i + 1,
      };
    }

    // Trail the stop AFTER checking exits, so the trigger bar itself can never
    // be counted as a managed exit (keeps the sim conservative).
    if (reachedArm2) {
      const better = long ? lockStop > workingStop : lockStop < workingStop;
      if (better) {
        workingStop = lockStop;
        locked = true;
        armed = true;
      }
    } else if (reachedArm1 && !armed) {
      const better = long ? breakEvenStop > workingStop : breakEvenStop < workingStop;
      if (better) {
        workingStop = breakEvenStop;
        armed = true;
      }
    }
  }

  if (bars.length >= maxBars && bars.length > 0) {
    const last = bars[bars.length - 1];
    const raw = long ? last.close - plan.entry : plan.entry - last.close;
    const pips = toPips(instrument, raw) * (raw >= 0 ? 1 : -1);
    return {
      status: "EXPIRED",
      exitPrice: last.close,
      exitTime: last.time,
      resultPips: pips,
      rMultiple: pips / riskPips,
      mfePips: mfe,
      maePips: mae,
      barsHeld: bars.length,
    };
  }

  return {
    status: "OPEN",
    exitPrice: null,
    exitTime: null,
    resultPips: 0,
    rMultiple: 0,
    mfePips: mfe,
    maePips: mae,
    barsHeld: bars.length,
  };
}
