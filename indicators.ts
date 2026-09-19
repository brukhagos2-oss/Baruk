import type { Candle } from "./market/candles";

/** All helpers return arrays aligned 1:1 with the input (NaN during warm-up). */

export function sma(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i += 1) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder smoothing (used by RSI / ATR / ADX). */
function wilder(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i += 1) sum += values[i];
  let prev = sum / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i += 1) {
    prev = (prev * (period - 1) + values[i]) / period;
    out[i] = prev;
  }
  return out;
}

export function rsi(closes: number[], period = 14): number[] {
  const out = new Array<number>(closes.length).fill(NaN);
  if (closes.length <= period) return out;
  const gains: number[] = [0];
  const losses: number[] = [0];
  for (let i = 1; i < closes.length; i += 1) {
    const diff = closes[i] - closes[i - 1];
    gains.push(Math.max(diff, 0));
    losses.push(Math.max(-diff, 0));
  }
  const avgGain = wilder(gains.slice(1), period);
  const avgLoss = wilder(losses.slice(1), period);
  for (let i = 0; i < avgGain.length; i += 1) {
    if (Number.isNaN(avgGain[i])) continue;
    const loss = avgLoss[i];
    out[i + 1] = loss === 0 ? 100 : 100 - 100 / (1 + avgGain[i] / loss);
  }
  return out;
}

export function trueRange(candles: Candle[]): number[] {
  return candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prev = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - prev), Math.abs(c.low - prev));
  });
}

export function atr(candles: Candle[], period = 14): number[] {
  return wilder(trueRange(candles), period);
}

export interface MacdResult {
  macd: number[];
  signal: number[];
  histogram: number[];
}

export function macd(closes: number[], fast = 12, slow = 26, signalPeriod = 9): MacdResult {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const line = closes.map((_, i) =>
    Number.isNaN(emaFast[i]) || Number.isNaN(emaSlow[i]) ? NaN : emaFast[i] - emaSlow[i],
  );
  const firstValid = line.findIndex((v) => !Number.isNaN(v));
  const signal = new Array<number>(closes.length).fill(NaN);
  if (firstValid >= 0) {
    const sig = ema(line.slice(firstValid), signalPeriod);
    for (let i = 0; i < sig.length; i += 1) signal[firstValid + i] = sig[i];
  }
  const histogram = line.map((v, i) => (Number.isNaN(v) || Number.isNaN(signal[i]) ? NaN : v - signal[i]));
  return { macd: line, signal, histogram };
}

export interface AdxResult {
  adx: number[];
  plusDi: number[];
  minusDi: number[];
}

export function adx(candles: Candle[], period = 14): AdxResult {
  const len = candles.length;
  const plusDm: number[] = [0];
  const minusDm: number[] = [0];
  for (let i = 1; i < len; i += 1) {
    const up = candles[i].high - candles[i - 1].high;
    const down = candles[i - 1].low - candles[i].low;
    plusDm.push(up > down && up > 0 ? up : 0);
    minusDm.push(down > up && down > 0 ? down : 0);
  }
  const tr = trueRange(candles);
  const smTr = wilder(tr, period);
  const smPlus = wilder(plusDm, period);
  const smMinus = wilder(minusDm, period);

  const plusDi = new Array<number>(len).fill(NaN);
  const minusDi = new Array<number>(len).fill(NaN);
  const dx = new Array<number>(len).fill(NaN);
  for (let i = 0; i < len; i += 1) {
    if (Number.isNaN(smTr[i]) || smTr[i] === 0) continue;
    plusDi[i] = (100 * smPlus[i]) / smTr[i];
    minusDi[i] = (100 * smMinus[i]) / smTr[i];
    const sum = plusDi[i] + minusDi[i];
    dx[i] = sum === 0 ? 0 : (100 * Math.abs(plusDi[i] - minusDi[i])) / sum;
  }
  const valid = dx.filter((v) => !Number.isNaN(v));
  const adxVals = wilder(valid, period);
  const out = new Array<number>(len).fill(NaN);
  const offset = dx.findIndex((v) => !Number.isNaN(v));
  if (offset >= 0) for (let i = 0; i < adxVals.length; i += 1) out[offset + i] = adxVals[i];
  return { adx: out, plusDi, minusDi };
}

export function stdev(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  const means = sma(values, period);
  for (let i = period - 1; i < values.length; i += 1) {
    let acc = 0;
    for (let j = i - period + 1; j <= i; j += 1) acc += (values[j] - means[i]) ** 2;
    out[i] = Math.sqrt(acc / period);
  }
  return out;
}

export interface Bollinger {
  upper: number[];
  middle: number[];
  lower: number[];
  width: number[];
}

export function bollinger(closes: number[], period = 20, mult = 2): Bollinger {
  const middle = sma(closes, period);
  const sd = stdev(closes, period);
  const upper = middle.map((m, i) => (Number.isNaN(m) ? NaN : m + mult * sd[i]));
  const lower = middle.map((m, i) => (Number.isNaN(m) ? NaN : m - mult * sd[i]));
  const width = middle.map((m, i) => (Number.isNaN(m) || m === 0 ? NaN : (upper[i] - lower[i]) / m));
  return { upper, middle, lower, width };
}

/** Highest high / lowest low over the last `lookback` closed bars ending at index. */
export function swingHigh(candles: Candle[], index: number, lookback: number): number {
  let hi = -Infinity;
  for (let i = Math.max(0, index - lookback + 1); i <= index; i += 1) hi = Math.max(hi, candles[i].high);
  return hi;
}

export function swingLow(candles: Candle[], index: number, lookback: number): number {
  let lo = Infinity;
  for (let i = Math.max(0, index - lookback + 1); i <= index; i += 1) lo = Math.min(lo, candles[i].low);
  return lo;
}

/** Fractal pivots used for market-structure (HH/HL vs LH/LL) detection. */
export function pivots(candles: Candle[], left = 2, right = 2) {
  const highs: Array<{ index: number; price: number }> = [];
  const lows: Array<{ index: number; price: number }> = [];
  for (let i = left; i < candles.length - right; i += 1) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - left; j <= i + right; j += 1) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isHigh = false;
      if (candles[j].low <= candles[i].low) isLow = false;
    }
    if (isHigh) highs.push({ index: i, price: candles[i].high });
    if (isLow) lows.push({ index: i, price: candles[i].low });
  }
  return { highs, lows };
}

export function slope(values: number[], index: number, lookback: number): number {
  const start = Math.max(0, index - lookback + 1);
  const n = index - start + 1;
  if (n < 3) return 0;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i += 1) {
    const x = i;
    const y = values[start + i];
    if (Number.isNaN(y)) return 0;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

export function median(values: number[]): number {
  const clean = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!clean.length) return NaN;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
}

export interface CandleAnatomy {
  body: number;
  range: number;
  bodyRatio: number;
  upperWick: number;
  lowerWick: number;
  bullish: boolean;
}

export function anatomy(c: Candle): CandleAnatomy {
  const range = Math.max(c.high - c.low, 1e-12);
  const body = Math.abs(c.close - c.open);
  return {
    body,
    range,
    bodyRatio: body / range,
    upperWick: c.high - Math.max(c.open, c.close),
    lowerWick: Math.min(c.open, c.close) - c.low,
    bullish: c.close >= c.open,
  };
}

export function bullishEngulfing(prev: Candle, cur: Candle): boolean {
  return cur.close > cur.open && prev.close < prev.open && cur.close >= prev.open && cur.open <= prev.close;
}

export function bearishEngulfing(prev: Candle, cur: Candle): boolean {
  return cur.close < cur.open && prev.close > prev.open && cur.close <= prev.open && cur.open >= prev.close;
}

export function bullishPin(c: Candle): boolean {
  const a = anatomy(c);
  return a.lowerWick > a.body * 1.8 && a.lowerWick > a.upperWick * 1.8 && c.close > c.low + a.range * 0.55;
}

export function bearishPin(c: Candle): boolean {
  const a = anatomy(c);
  return a.upperWick > a.body * 1.8 && a.upperWick > a.lowerWick * 1.8 && c.close < c.high - a.range * 0.55;
}
