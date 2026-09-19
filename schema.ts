import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Every signal ever produced by the Apex Confluence Engine.
 * Entry / SL / TP / pips are always derived from the exact same closed candle
 * series that the dashboard chart renders, so live and reported results
 * can never diverge ("no demo overlap").
 */
export const signals = pgTable(
  "signals",
  {
    id: serial("id").primaryKey(),
    instrument: text("instrument").notNull(), // XAUUSD | EURUSD | USDJPY | BTCUSD
    timeframe: text("timeframe").notNull(), // M1 | M5 | M15 | M30 | H1 | H4
    direction: text("direction").notNull(), // BUY | SELL
    mode: text("mode").notNull().default("precision"), // precision | balanced | runner

    // Prices taken straight from the signal candle (close of confirmed bar)
    entry: doublePrecision("entry").notNull(),
    stopLoss: doublePrecision("stop_loss").notNull(),
    takeProfit: doublePrecision("take_profit").notNull(),
    takeProfit1: doublePrecision("take_profit_1").notNull(),

    riskPips: doublePrecision("risk_pips").notNull(),
    rewardPips: doublePrecision("reward_pips").notNull(),
    riskReward: doublePrecision("risk_reward").notNull(),

    confidence: integer("confidence").notNull(), // 0-100 confluence score
    atr: doublePrecision("atr").notNull(),
    htfBias: text("htf_bias").notNull(),
    reasons: jsonb("reasons").$type<string[]>().notNull().default([]),
    filters: jsonb("filters").$type<Record<string, number | string | boolean>>()
      .notNull()
      .default({}),

    // Lifecycle
    status: text("status").notNull().default("OPEN"), // OPEN | TP | SL | EXPIRED
    exitPrice: doublePrecision("exit_price"),
    resultPips: doublePrecision("result_pips"),
    rMultiple: doublePrecision("r_multiple"),
    mfePips: doublePrecision("mfe_pips").default(0),
    maePips: doublePrecision("mae_pips").default(0),
    barsHeld: integer("bars_held").default(0),

    signalBarTime: integer("signal_bar_time").notNull(), // unix seconds of the confirmed candle
    dataSource: text("data_source").notNull().default("live"),
    engineVersion: text("engine_version").notNull().default("apex-3.0"),
    notified: boolean("notified").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("signals_unique_bar").on(
      table.instrument,
      table.timeframe,
      table.signalBarTime,
      table.direction,
    ),
    index("signals_status_idx").on(table.status),
    index("signals_created_idx").on(table.createdAt),
  ],
);

/** Dashboard notification feed (also mirrored to browser / phone push). */
export const alerts = pgTable(
  "alerts",
  {
    id: serial("id").primaryKey(),
    signalId: integer("signal_id"),
    kind: text("kind").notNull(), // NEW_SIGNAL | TP_HIT | SL_HIT | EXPIRED | SYSTEM
    title: text("title").notNull(),
    body: text("body").notNull(),
    instrument: text("instrument"),
    timeframe: text("timeframe"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("alerts_created_idx").on(table.createdAt)],
);

/** Single-row engine configuration controlled from the dashboard. */
export const botSettings = pgTable("bot_settings", {
  id: integer("id").primaryKey().default(1),
  minConfidence: integer("min_confidence").notNull().default(84),
  mode: text("mode").notNull().default("precision"),
  autoScan: boolean("auto_scan").notNull().default(true),
  pushEnabled: boolean("push_enabled").notNull().default(true),
  soundEnabled: boolean("sound_enabled").notNull().default(true),
  instruments: jsonb("instruments")
    .$type<string[]>()
    .notNull()
    .default(["XAUUSD", "EURUSD", "USDJPY", "BTCUSD"]),
  timeframes: jsonb("timeframes")
    .$type<string[]>()
    .notNull()
    .default(["M5", "M15", "M30", "H1", "H4"]),
  riskPerTrade: doublePrecision("risk_per_trade").notNull().default(1),
  accountSize: doublePrecision("account_size").notNull().default(10000),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Audit of every engine scan so the dashboard can prove it is alive. */
export const scanRuns = pgTable("scan_runs", {
  id: serial("id").primaryKey(),
  scanned: integer("scanned").notNull().default(0),
  created: integer("created").notNull().default(0),
  resolved: integer("resolved").notNull().default(0),
  rejected: integer("rejected").notNull().default(0),
  durationMs: integer("duration_ms").notNull().default(0),
  source: text("source").notNull().default("live"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Signal = typeof signals.$inferSelect;
export type NewSignal = typeof signals.$inferInsert;
export type Alert = typeof alerts.$inferSelect;
export type BotSettings = typeof botSettings.$inferSelect;
