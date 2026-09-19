import {
  INSTRUMENTS,
  TIMEFRAMES,
  type InstrumentId,
  type TimeframeId,
} from "./instruments";

export interface Candle {
  time: number; // unix seconds, bar OPEN time (UTC)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type FeedSource = "live" | "fallback" | "simulated";

export interface CandleSeries {
  instrument: InstrumentId;
  timeframe: TimeframeId;
  candles: Candle[];
  /** Candles whose period has fully elapsed — the ONLY data the engine trades on. */
  closed: Candle[];
  livePrice: number;
  source: FeedSource;
  fetchedAt: number;
  provider: string;
}

interface YahooChartResponse {
  chart: {
    result?: Array<{
      meta?: { regularMarketPrice?: number };
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: (number | null)[];
          high?: (number | null)[];
          low?: (number | null)[];
          close?: (number | null)[];
          volume?: (number | null)[];
        }>;
      };
    }> | null;
    error?: unknown;
  };
}

const YAHOO_PLAN: Record<
  TimeframeId,
  { interval: string; range: string; aggregate: number }
> = {
  M1: { interval: "1m", range: "2d", aggregate: 1 },
  M5: { interval: "5m", range: "10d", aggregate: 1 },
  M15: { interval: "15m", range: "1mo", aggregate: 1 },
  M30: { interval: "30m", range: "1mo", aggregate: 1 },
  H1: { interval: "60m", range: "3mo", aggregate: 1 },
  H4: { interval: "60m", range: "6mo", aggregate: 4 },
};

/**
 * Bars only change when a candle closes, so cache aggressively. This keeps the
 * whole 4-pair x 6-timeframe scan inside a handful of upstream requests and
 * avoids provider rate limits.
 */
const CACHE_TTL_MS: Record<TimeframeId, number> = {
  M1: 20_000,
  M5: 70_000,
  M15: 200_000,
  M30: 260_000,
  H1: 300_000,
  H4: 420_000,
};

const MAX_BARS = 2000;

/** Per-host penalty box after a 429 / network failure. */
const hostCooldown = new Map<string, number>();

/* Upstream request scheduler: Yahoo throttles bursts hard, so every request is
 * serialised with a minimum gap. Combined with the bar-aware cache above this
 * keeps a full 4-pair x 6-timeframe sweep well inside the provider budget. */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const scheduler = globalThis as typeof globalThis & {
  __apexQueue?: Promise<unknown>;
  __apexLastCall?: number;
};
scheduler.__apexQueue ??= Promise.resolve();
scheduler.__apexLastCall ??= 0;

function schedule<T>(fn: () => Promise<T>, minGapMs = 1300): Promise<T> {
  const run = async (): Promise<T> => {
    const wait = Math.max(0, (scheduler.__apexLastCall ?? 0) + minGapMs - Date.now());
    if (wait > 0) await sleep(wait);
    scheduler.__apexLastCall = Date.now();
    return fn();
  };
  const result = (scheduler.__apexQueue as Promise<unknown>).then(run, run);
  scheduler.__apexQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

type CacheEntry = { series: CandleSeries; expiresAt: number };
const globalCache = globalThis as typeof globalThis & {
  __apexCandleCache?: Map<string, CacheEntry>;
  __apexInflight?: Map<string, Promise<CandleSeries>>;
};
const cache = (globalCache.__apexCandleCache ??= new Map<string, CacheEntry>());
const inflight = (globalCache.__apexInflight ??= new Map<string, Promise<CandleSeries>>());

function key(instrument: InstrumentId, timeframe: TimeframeId) {
  return `${instrument}:${timeframe}`;
}

/** Group raw candles into higher timeframe buckets aligned to UTC. */
export function aggregate(candles: Candle[], bucketSeconds: number): Candle[] {
  const out: Candle[] = [];
  let current: Candle | null = null;
  let bucket = -1;
  for (const c of candles) {
    const b = Math.floor(c.time / bucketSeconds) * bucketSeconds;
    if (!current || b !== bucket) {
      if (current) out.push(current);
      bucket = b;
      current = { time: b, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume };
    } else {
      current.high = Math.max(current.high, c.high);
      current.low = Math.min(current.low, c.low);
      current.close = c.close;
      current.volume += c.volume;
    }
  }
  if (current) out.push(current);
  return out;
}

function sanitise(candles: Candle[]): Candle[] {
  const seen = new Map<number, Candle>();
  for (const c of candles) {
    if (
      !Number.isFinite(c.open) ||
      !Number.isFinite(c.high) ||
      !Number.isFinite(c.low) ||
      !Number.isFinite(c.close) ||
      c.high < c.low ||
      c.close <= 0
    ) {
      continue;
    }
    seen.set(c.time, c);
  }
  return [...seen.values()].sort((a, b) => a.time - b.time).slice(-MAX_BARS);
}

async function fetchYahoo(
  instrument: InstrumentId,
  timeframe: TimeframeId,
): Promise<{ candles: Candle[]; livePrice: number }> {
  const def = INSTRUMENTS[instrument];
  const plan = YAHOO_PLAN[timeframe];
  const now = Date.now();
  const allHosts = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
  const ready = allHosts.filter((h) => (hostCooldown.get(h) ?? 0) < now);
  const hosts = ready.length ? ready : allHosts;
  // Rotate so consecutive calls spread across both edge hosts.
  if (Math.random() > 0.5) hosts.reverse();
  let lastError: unknown = null;

  for (const host of hosts) {
    const url =
      `https://${host}/v8/finance/chart/${encodeURIComponent(def.yahoo)}` +
      `?interval=${plan.interval}&range=${plan.range}&includePrePost=false`;
    try {
      const res = await schedule(() =>
        fetch(url, {
          cache: "no-store",
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
            Accept: "application/json,text/plain,*/*",
            "Accept-Language": "en-US,en;q=0.9",
          },
          signal: AbortSignal.timeout(15_000),
        }),
      );
      if (!res.ok) {
        if (res.status === 429 || res.status >= 500) hostCooldown.set(host, Date.now() + 90_000);
        throw new Error(`yahoo ${res.status}`);
      }
      const json = (await res.json()) as YahooChartResponse;
      const result = json.chart.result?.[0];
      const quote = result?.indicators?.quote?.[0];
      const stamps = result?.timestamp;
      if (!result || !quote || !stamps?.length) throw new Error("yahoo empty payload");

      const raw: Candle[] = [];
      for (let i = 0; i < stamps.length; i += 1) {
        const o = quote.open?.[i];
        const h = quote.high?.[i];
        const l = quote.low?.[i];
        const c = quote.close?.[i];
        if (o == null || h == null || l == null || c == null) continue;
        raw.push({ time: stamps[i], open: o, high: h, low: l, close: c, volume: quote.volume?.[i] ?? 0 });
      }
      if (raw.length < 60) throw new Error("yahoo insufficient bars");

      const bucket = TIMEFRAMES[timeframe].seconds;
      const candles = sanitise(plan.aggregate > 1 ? aggregate(raw, bucket) : raw);
      const livePrice = result.meta?.regularMarketPrice ?? candles[candles.length - 1].close;
      return { candles, livePrice };
    } catch (error) {
      lastError = error;
      console.warn(
        `[apex-feed] ${def.yahoo} ${plan.interval} via ${host} failed:`,
        error instanceof Error ? `${error.name}: ${error.message}` : error,
      );
    }
  }
  throw lastError ?? new Error("yahoo unavailable");
}

async function fetchCoinbase(
  instrument: InstrumentId,
  timeframe: TimeframeId,
): Promise<{ candles: Candle[]; livePrice: number }> {
  const def = INSTRUMENTS[instrument];
  if (!def.coinbase) throw new Error("no coinbase product");
  const tfSeconds = TIMEFRAMES[timeframe].seconds;
  const supported = [60, 300, 900, 3600, 21600, 86400];
  const granularity = supported.includes(tfSeconds)
    ? tfSeconds
    : supported.filter((g) => tfSeconds % g === 0).pop() ?? 3600;

  const pages = granularity < tfSeconds ? 3 : 2;
  const collected: Candle[] = [];
  const now = Math.floor(Date.now() / 1000);
  for (let p = 0; p < pages; p += 1) {
    const end = now - p * 300 * granularity;
    const start = end - 299 * granularity;
    const url =
      `https://api.exchange.coinbase.com/products/${def.coinbase}/candles` +
      `?granularity=${granularity}&start=${new Date(start * 1000).toISOString()}&end=${new Date(end * 1000).toISOString()}`;
    const res = await schedule(
      () =>
        fetch(url, {
          cache: "no-store",
          headers: { "User-Agent": "apex-signal-engine/3.0", Accept: "application/json" },
          signal: AbortSignal.timeout(12_000),
        }),
      350,
    );
    if (!res.ok) throw new Error(`coinbase ${res.status}`);
    const rows = (await res.json()) as number[][];
    for (const r of rows) {
      collected.push({ time: r[0], open: r[3], high: r[2], low: r[1], close: r[4], volume: r[5] });
    }
  }
  if (collected.length < 60) throw new Error("coinbase insufficient bars");
  const ordered = sanitise(collected);
  const candles = granularity < tfSeconds ? aggregate(ordered, tfSeconds) : ordered;
  return { candles, livePrice: candles[candles.length - 1].close };
}

/* ------------------------------------------------------------------ *
 * Deterministic offline generator. Used only when every live feed is
 * unreachable so the dashboard and engine stay fully functional.
 * Price is a pure function of the absolute bar index => stable series.
 * ------------------------------------------------------------------ */
function noise(seed: number, i: number): number {
  let x = (seed * 2654435761 + i * 40503) >>> 0;
  x ^= x << 13;
  x >>>= 0;
  x ^= x >> 17;
  x ^= x << 5;
  x >>>= 0;
  return x / 4294967296;
}

function syntheticSeries(instrument: InstrumentId, timeframe: TimeframeId): { candles: Candle[]; livePrice: number } {
  const def = INSTRUMENTS[instrument];
  const tf = TIMEFRAMES[timeframe];
  const seed = [...instrument].reduce((acc, ch) => acc + ch.charCodeAt(0), 7);
  const now = Math.floor(Date.now() / 1000);
  const lastIndex = Math.floor(now / tf.seconds);
  const barVol = def.dailyVol * Math.sqrt(tf.seconds / 86400);
  const candles: Candle[] = [];

  const priceAt = (i: number) => {
    const wave =
      0.055 * Math.sin(i / 277 + seed) +
      0.03 * Math.sin(i / 91 + seed * 0.7) +
      0.012 * Math.sin(i / 29 + seed * 1.9) +
      0.05 * (def.dailyVol / 0.01) * 0.02 * Math.sin(i / 613 + seed * 0.3);
    const jitter = (noise(seed, i) - 0.5) * barVol * 2.4;
    return def.basePrice * (1 + wave * (def.dailyVol / 0.012) * 0.5 + jitter);
  };

  for (let k = 400; k >= 0; k -= 1) {
    const i = lastIndex - k;
    const open = priceAt(i);
    const close = priceAt(i + 1);
    const spread = Math.abs(close - open) + def.basePrice * barVol * (0.3 + noise(seed + 11, i) * 0.9);
    const high = Math.max(open, close) + spread * noise(seed + 23, i) * 0.6;
    const low = Math.min(open, close) - spread * noise(seed + 37, i) * 0.6;
    candles.push({
      time: i * tf.seconds,
      open,
      high,
      low,
      close,
      volume: 500 + noise(seed + 51, i) * 1500,
    });
  }
  return { candles, livePrice: candles[candles.length - 1].close };
}

function splitClosed(candles: Candle[], tfSeconds: number): { closed: Candle[]; all: Candle[] } {
  const now = Math.floor(Date.now() / 1000);
  const closed = candles.filter((c) => c.time + tfSeconds <= now);
  return { closed, all: candles };
}

async function load(instrument: InstrumentId, timeframe: TimeframeId): Promise<CandleSeries> {
  const def = INSTRUMENTS[instrument];
  const tfSeconds = TIMEFRAMES[timeframe].seconds;
  const providers: Array<{ name: string; run: () => Promise<{ candles: Candle[]; livePrice: number }> }> =
    def.kind === "crypto"
      ? [
          { name: "coinbase", run: () => fetchCoinbase(instrument, timeframe) },
          { name: "yahoo", run: () => fetchYahoo(instrument, timeframe) },
        ]
      : [
          { name: "yahoo", run: () => fetchYahoo(instrument, timeframe) },
        ];

  for (let i = 0; i < providers.length; i += 1) {
    const provider = providers[i];
    try {
      const { candles, livePrice } = await provider.run();
      const { closed, all } = splitClosed(candles, tfSeconds);
      if (closed.length < 60) throw new Error("not enough closed bars");
      return {
        instrument,
        timeframe,
        candles: all,
        closed,
        livePrice,
        source: i === 0 ? "live" : "fallback",
        fetchedAt: Date.now(),
        provider: provider.name,
      };
    } catch {
      // try next provider
    }
  }

  const stale = cache.get(key(instrument, timeframe));
  if (stale) return { ...stale.series, fetchedAt: Date.now() };

  const { candles, livePrice } = syntheticSeries(instrument, timeframe);
  const { closed, all } = splitClosed(candles, tfSeconds);
  return {
    instrument,
    timeframe,
    candles: all,
    closed,
    livePrice,
    source: "simulated",
    fetchedAt: Date.now(),
    provider: "offline-model",
  };
}

export async function getCandles(
  instrument: InstrumentId,
  timeframe: TimeframeId,
  opts: { force?: boolean } = {},
): Promise<CandleSeries> {
  const k = key(instrument, timeframe);
  const hit = cache.get(k);
  if (!opts.force && hit && hit.expiresAt > Date.now()) return hit.series;

  const pending = inflight.get(k);
  if (pending) return pending;

  const task = load(instrument, timeframe)
    .then((series) => {
      // Degraded data is retried quickly; good data is held for the bar window.
      const ttl = series.source === "live" ? CACHE_TTL_MS[timeframe] : 25_000;
      cache.set(k, { series, expiresAt: Date.now() + ttl });
      return series;
    })
    .finally(() => {
      inflight.delete(k);
    });

  inflight.set(k, task);
  return task;
}
