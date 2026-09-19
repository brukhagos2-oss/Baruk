import type { InstrumentDef, InstrumentId, TimeframeDef, TimeframeId } from "@/lib/market/instruments";
import type { EngineMode, ModeProfile } from "@/lib/strategy";

export type { InstrumentId, TimeframeId, EngineMode };

export interface SignalDTO {
  id: number;
  instrument: InstrumentId;
  timeframe: TimeframeId;
  direction: "BUY" | "SELL";
  mode: string;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  takeProfit1: number;
  riskPips: number;
  rewardPips: number;
  riskReward: number;
  confidence: number;
  atr: number;
  htfBias: string;
  reasons: string[];
  filters: Record<string, string | number | boolean>;
  status: "OPEN" | "TP" | "SL" | "EXPIRED";
  exitPrice: number | null;
  resultPips: number | null;
  rMultiple: number | null;
  mfePips: number | null;
  maePips: number | null;
  barsHeld: number | null;
  signalBarTime: number;
  dataSource: string;
  engineVersion: string;
  createdAt: string;
  closedAt: string | null;
}

export interface LiveSignalDTO extends SignalDTO {
  livePrice: number;
  floatingPips: number;
  progress: number;
}

export interface CandleDTO {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SnapshotDTO {
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

export interface MarketResponse {
  instrument: InstrumentDef;
  timeframe: TimeframeDef;
  candles: CandleDTO[];
  overlays: {
    ema21: { time: number; value: number }[];
    ema50: { time: number; value: number }[];
    ema200: { time: number; value: number }[];
  };
  snapshot: SnapshotDTO;
  activeSignal: SignalDTO | null;
  lastClosedSignal: SignalDTO | null;
  feed: { source: string; provider: string; fetchedAt: number };
}

export interface TickerDTO {
  id: InstrumentId;
  label: string;
  short: string;
  accent: string;
  digits: number;
  price: number;
  changePct: number;
  source: string;
  spark: number[];
}

export interface PerformanceDTO {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  netPips: number;
  profitFactor: number;
  expectancyR: number;
  openCount: number;
  byInstrument: { instrument: string; trades: number; winRate: number; pips: number }[];
  equity: number[];
  modes: Record<EngineMode, ModeProfile>;
}

export interface SignalsResponse {
  open: LiveSignalDTO[];
  history: SignalDTO[];
  performance: PerformanceDTO;
}

export interface AlertDTO {
  id: number;
  signalId: number | null;
  kind: "NEW_SIGNAL" | "TP_HIT" | "SL_HIT" | "EXPIRED" | "SYSTEM";
  title: string;
  body: string;
  instrument: string | null;
  timeframe: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface SettingsDTO {
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

export interface BacktestDTO {
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
  sample: {
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
  }[];
  source: string;
}

export interface ScanResponse {
  throttled: boolean;
  summary?: {
    scanned: number;
    created: number;
    resolved: number;
    rejected: number;
    durationMs: number;
    source: string;
    createdSignals: SignalDTO[];
    at: string;
  };
  alerts?: AlertDTO[];
}
