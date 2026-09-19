export type InstrumentId = "XAUUSD" | "EURUSD" | "USDJPY" | "BTCUSD";
export type TimeframeId = "M1" | "M5" | "M15" | "M30" | "H1" | "H4";

export interface InstrumentDef {
  id: InstrumentId;
  label: string;
  short: string;
  kind: "metal" | "forex" | "crypto";
  /** Yahoo chart symbol used as the primary OHLC feed. */
  yahoo: string;
  /** Coinbase product id used as a crypto fallback / tick source. */
  coinbase?: string;
  /** Value of 1 pip (or point) in quote-currency terms. */
  pipSize: number;
  /** Price decimals to render. */
  digits: number;
  pipLabel: string;
  /** Approximate USD value of 1 pip on 1 standard lot (used for $ projections). */
  pipValuePerLot: number;
  /** Sanity bounds so a broken feed can never create an absurd SL distance. */
  minRiskPips: number;
  maxRiskPips: number;
  /** Typical spread in pips, subtracted from reported edge. */
  spreadPips: number;
  accent: string;
  basePrice: number;
  dailyVol: number;
}

export const INSTRUMENTS: Record<InstrumentId, InstrumentDef> = {
  XAUUSD: {
    id: "XAUUSD",
    label: "XAU / USD",
    short: "GOLD",
    kind: "metal",
    yahoo: "GC=F",
    pipSize: 0.1,
    digits: 2,
    pipLabel: "pips",
    pipValuePerLot: 10,
    minRiskPips: 15,
    maxRiskPips: 900,
    spreadPips: 2.5,
    accent: "#f5b942",
    basePrice: 4425,
    dailyVol: 0.011,
  },
  EURUSD: {
    id: "EURUSD",
    label: "EUR / USD",
    short: "FIBER",
    kind: "forex",
    yahoo: "EURUSD=X",
    pipSize: 0.0001,
    digits: 5,
    pipLabel: "pips",
    pipValuePerLot: 10,
    minRiskPips: 6,
    maxRiskPips: 140,
    spreadPips: 0.6,
    accent: "#5b8cff",
    basePrice: 1.149,
    dailyVol: 0.0045,
  },
  USDJPY: {
    id: "USDJPY",
    label: "USD / JPY",
    short: "YEN",
    kind: "forex",
    yahoo: "JPY=X",
    pipSize: 0.01,
    digits: 3,
    pipLabel: "pips",
    pipValuePerLot: 9.2,
    minRiskPips: 6,
    maxRiskPips: 140,
    spreadPips: 0.8,
    accent: "#ff7ab8",
    basePrice: 156.8,
    dailyVol: 0.005,
  },
  BTCUSD: {
    id: "BTCUSD",
    label: "BTC / USD",
    short: "BITCOIN",
    kind: "crypto",
    yahoo: "BTC-USD",
    coinbase: "BTC-USD",
    pipSize: 1,
    digits: 2,
    pipLabel: "pts",
    pipValuePerLot: 1,
    minRiskPips: 60,
    maxRiskPips: 6000,
    spreadPips: 8,
    accent: "#ff9f43",
    basePrice: 81800,
    dailyVol: 0.028,
  },
};

export const INSTRUMENT_IDS = Object.keys(INSTRUMENTS) as InstrumentId[];

export interface TimeframeDef {
  id: TimeframeId;
  label: string;
  seconds: number;
  /** Higher timeframe used for directional bias confirmation. */
  htf: TimeframeId;
  /** Bars an idea is allowed to stay open before it is force-closed at market. */
  maxBars: number;
  /** Minimum bars between two signals on the same instrument+timeframe. */
  cooldownBars: number;
  scalper: boolean;
}

export const TIMEFRAMES: Record<TimeframeId, TimeframeDef> = {
  M1: { id: "M1", label: "M1 · Scalper", seconds: 60, htf: "M15", maxBars: 60, cooldownBars: 10, scalper: true },
  M5: { id: "M5", label: "M5", seconds: 300, htf: "H1", maxBars: 54, cooldownBars: 6, scalper: true },
  M15: { id: "M15", label: "M15", seconds: 900, htf: "H1", maxBars: 48, cooldownBars: 5, scalper: false },
  M30: { id: "M30", label: "M30", seconds: 1800, htf: "H4", maxBars: 42, cooldownBars: 4, scalper: false },
  H1: { id: "H1", label: "H1", seconds: 3600, htf: "H4", maxBars: 36, cooldownBars: 3, scalper: false },
  H4: { id: "H4", label: "H4", seconds: 14400, htf: "H4", maxBars: 30, cooldownBars: 2, scalper: false },
};

export const TIMEFRAME_IDS = Object.keys(TIMEFRAMES) as TimeframeId[];

export function isInstrument(value: string): value is InstrumentId {
  return value in INSTRUMENTS;
}

export function isTimeframe(value: string): value is TimeframeId {
  return value in TIMEFRAMES;
}

/** Convert a raw price distance into pips for the given instrument. */
export function toPips(instrument: InstrumentId, priceDistance: number): number {
  return Math.abs(priceDistance) / INSTRUMENTS[instrument].pipSize;
}

/** Convert pips back into a raw price distance. */
export function fromPips(instrument: InstrumentId, pips: number): number {
  return pips * INSTRUMENTS[instrument].pipSize;
}

export function formatPrice(instrument: InstrumentId, price: number): string {
  const { digits } = INSTRUMENTS[instrument];
  return price.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function roundPrice(instrument: InstrumentId, price: number): number {
  const factor = 10 ** INSTRUMENTS[instrument].digits;
  return Math.round(price * factor) / factor;
}
