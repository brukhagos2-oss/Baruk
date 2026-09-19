import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { signals } from "@/db/schema";
import { getSettings, getSnapshot } from "@/lib/engine";
import { getCandles } from "@/lib/market/candles";
import { isInstrument, isTimeframe, INSTRUMENTS, TIMEFRAMES } from "@/lib/market/instruments";
import { ema } from "@/lib/indicators";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const instrumentParam = url.searchParams.get("instrument") ?? "XAUUSD";
  const tfParam = url.searchParams.get("tf") ?? "M15";
  if (!isInstrument(instrumentParam) || !isTimeframe(tfParam)) {
    return Response.json({ error: "Unknown instrument or timeframe" }, { status: 400 });
  }

  try {
    const settings = await getSettings();
    const [series, snapshot] = await Promise.all([
      getCandles(instrumentParam, tfParam),
      getSnapshot(instrumentParam, tfParam, settings.mode, settings.minConfidence),
    ]);

    const closes = series.candles.map((c) => c.close);
    const e21 = ema(closes, 21);
    const e50 = ema(closes, 50);
    const e200 = ema(closes, 200);
    const view = series.candles.slice(-320);
    const offset = series.candles.length - view.length;

    const [active] = await db
      .select()
      .from(signals)
      .where(
        and(
          eq(signals.instrument, instrumentParam),
          eq(signals.timeframe, tfParam),
          eq(signals.status, "OPEN"),
        ),
      )
      .orderBy(desc(signals.createdAt))
      .limit(1);

    const [lastClosed] = await db
      .select()
      .from(signals)
      .where(
        and(
          eq(signals.instrument, instrumentParam),
          eq(signals.timeframe, tfParam),
          inArray(signals.status, ["TP", "SL", "EXPIRED"]),
        ),
      )
      .orderBy(desc(signals.signalBarTime))
      .limit(1);

    return Response.json({
      instrument: INSTRUMENTS[instrumentParam],
      timeframe: TIMEFRAMES[tfParam],
      candles: view,
      overlays: {
        ema21: view.map((c, i) => ({ time: c.time, value: e21[offset + i] })).filter((p) => Number.isFinite(p.value)),
        ema50: view.map((c, i) => ({ time: c.time, value: e50[offset + i] })).filter((p) => Number.isFinite(p.value)),
        ema200: view.map((c, i) => ({ time: c.time, value: e200[offset + i] })).filter((p) => Number.isFinite(p.value)),
      },
      snapshot,
      activeSignal: active ?? null,
      lastClosedSignal: lastClosed ?? null,
      feed: { source: series.source, provider: series.provider, fetchedAt: series.fetchedAt },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Market feed unavailable" },
      { status: 500 },
    );
  }
}
