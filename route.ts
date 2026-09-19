import { getCandles } from "@/lib/market/candles";
import { INSTRUMENTS, INSTRUMENT_IDS, TIMEFRAMES } from "@/lib/market/instruments";

export const dynamic = "force-dynamic";

export async function GET() {
  const results = await Promise.all(
    INSTRUMENT_IDS.map(async (id) => {
      try {
        const series = await getCandles(id, "M15");
        const closed = series.closed;
        const barsPerDay = Math.round(86400 / TIMEFRAMES.M15.seconds);
        const ref = closed[Math.max(0, closed.length - 1 - barsPerDay)]?.close ?? closed[0].close;
        const spark = closed.slice(-40).map((c) => c.close);
        return {
          id,
          label: INSTRUMENTS[id].label,
          short: INSTRUMENTS[id].short,
          accent: INSTRUMENTS[id].accent,
          digits: INSTRUMENTS[id].digits,
          price: series.livePrice,
          changePct: ((series.livePrice - ref) / ref) * 100,
          source: series.source,
          spark,
        };
      } catch {
        return {
          id,
          label: INSTRUMENTS[id].label,
          short: INSTRUMENTS[id].short,
          accent: INSTRUMENTS[id].accent,
          digits: INSTRUMENTS[id].digits,
          price: 0,
          changePct: 0,
          source: "offline",
          spark: [] as number[],
        };
      }
    }),
  );
  return Response.json({ tickers: results, at: new Date().toISOString() });
}
