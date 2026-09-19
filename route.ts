import { desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { signals } from "@/db/schema";
import { getPerformance } from "@/lib/engine";
import { getCandles } from "@/lib/market/candles";
import { isInstrument, isTimeframe, toPips } from "@/lib/market/instruments";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 40), 200);

  const [open, history, performance] = await Promise.all([
    db.select().from(signals).where(eq(signals.status, "OPEN")).orderBy(desc(signals.createdAt)),
    db
      .select()
      .from(signals)
      .where(inArray(signals.status, ["TP", "SL", "EXPIRED"]))
      .orderBy(desc(signals.closedAt))
      .limit(limit),
    getPerformance(),
  ]);

  // Live floating P/L for every open idea, priced off the same feed as the chart.
  const live = await Promise.all(
    open.map(async (sig) => {
      if (!isInstrument(sig.instrument) || !isTimeframe(sig.timeframe)) {
        return { ...sig, livePrice: sig.entry, floatingPips: 0, progress: 0 };
      }
      try {
        const series = await getCandles(sig.instrument, sig.timeframe);
        const price = series.livePrice;
        const long = sig.direction === "BUY";
        const raw = long ? price - sig.entry : sig.entry - price;
        const floatingPips = toPips(sig.instrument, raw) * (raw >= 0 ? 1 : -1);
        const span = long ? sig.takeProfit - sig.stopLoss : sig.stopLoss - sig.takeProfit;
        const travelled = long ? price - sig.stopLoss : sig.stopLoss - price;
        const progress = span > 0 ? Math.max(0, Math.min(1, travelled / span)) : 0;
        return { ...sig, livePrice: price, floatingPips, progress };
      } catch {
        return { ...sig, livePrice: sig.entry, floatingPips: 0, progress: 0 };
      }
    }),
  );

  return Response.json({ open: live, history, performance });
}
