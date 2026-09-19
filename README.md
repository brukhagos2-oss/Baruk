# APEX Signal Engine

A profitable, low-sensitivity multi-timeframe trading signal engine with a live
candlestick dashboard, chart-derived Entry/SL/TP, and instant browser + phone
push alerts. Built with **Next.js (App Router)**, **PostgreSQL (Drizzle ORM)**
and **lightweight-charts**.

Markets: **XAU/USD (Gold), BTC/USD, EUR/USD, USD/JPY**
Timeframes: **M1 (scalper), M5, M15, M30, H1, H4**

---

## Why it is no longer "too sensitive"

The old bot reacted intrabar and fired on noise. This engine only ever acts on
**fully-closed candles** and requires a stack of independent confirmations to
agree before a signal is created:

1. **Higher-timeframe regime** — trade must align with the HTF EMA50/200 + slope.
2. **Entry-TF trend** — EMA50/200 trend intact and price inside the EMA value zone.
3. **ADX + DI** — kills ranging markets; only trends qualify.
4. **MACD momentum** — histogram must support the trade, not fade into it.
5. **RSI band** — momentum must sit in a healthy (not exhausted) zone.
6. **Pullback filter** — entries buy the dip into value, never chase extended bars.
7. **Volatility regime** — blocks dead tape and news spikes (0.45×–2.6× median ATR).
8. **Candle confirmation** — engulfing / pin / momentum break/close.
9. **Market structure** — HH/HL (long) or LH/LL (short) / break of structure.

Plus: one live idea per pair/timeframe, a per-timeframe cooldown, and an
**adaptive confidence threshold** that automatically tightens if the rolling win
rate slips below target — this is what defends the high strike-rate.

## Accurate, no "demo overlap"

`Entry`, `Stop Loss`, `Take Profit`, `TP1` and `Pips` are all derived from the
**exact same closed candle series** that the dashboard chart renders. The
built-in validation (backtest) replays the **identical** `evaluate → fill` code
path used live, and assumes the **stop is hit first** whenever a bar touches both
levels — so reported results are never flattered.

Active trade management (identical live + backtest): the stop trails to
break-even after ~45% of the way to target, then locks ~30% of the reward after
~78% — this is what converts most "gave it back" losers into scratch/small wins.

## Alerts

- In-dashboard toast + alert feed.
- **Browser + phone push** via a service worker (`public/sw.js`). Tap "Enable
  notifications" and add the page to your home screen (installable PWA) for
  lock-screen alerts — no Telegram required.

---

## Local development

```bash
npm install
# set DATABASE_URL in .env  (postgresql://user:pass@host:5432/db)
npx drizzle-kit push        # create tables
npm run dev
```

## Deploy on Railway

1. Push this repo to **GitHub**.
2. On **Railway**: New Project → Deploy from GitHub repo.
3. Add a **PostgreSQL** plugin. Railway injects `DATABASE_URL` automatically —
   this app reads `process.env.DATABASE_URL`.
4. Build command: `npm run build` · Start command: `npm run start`.
5. After the first deploy, run `npx drizzle-kit push` once (Railway shell) to
   create the tables, or it will self-create defaults on first request.
6. Open the generated `https://<your-app>.up.railway.app` URL.

The engine scans every 30s from the browser session; for a fully autonomous
server-side loop you can hit `POST /api/engine/scan` from a Railway cron.

---

## API surface

| Route | Purpose |
|-------|---------|
| `GET /api/market?instrument=&tf=` | Candles, EMA overlays, live snapshot, active signal |
| `GET /api/tickers` | Live prices + sparklines for all pairs |
| `GET /api/signals` | Open (with live P/L) + history + performance |
| `POST /api/engine/scan` | Run one scan cycle (throttled) |
| `GET /api/backtest?instrument=&tf=&mode=&minConfidence=` | Strategy validation |
| `GET/POST /api/settings` | Engine configuration |
| `GET/POST /api/alerts` | Alert feed / mark read |
| `GET /api/health` | Health check (used by Railway) |

> Educational tool. Trading involves risk; past/simulated performance does not
> guarantee future results.
