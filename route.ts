import { getSettings, runBacktest } from "@/lib/engine";
import { isInstrument, isTimeframe } from "@/lib/market/instruments";
import { MODES, type EngineMode } from "@/lib/strategy";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const instrument = url.searchParams.get("instrument") ?? "XAUUSD";
  const tf = url.searchParams.get("tf") ?? "M15";
  if (!isInstrument(instrument) || !isTimeframe(tf)) {
    return Response.json({ error: "Unknown instrument or timeframe" }, { status: 400 });
  }
  const settings = await getSettings();
  const modeParam = url.searchParams.get("mode");
  const mode: EngineMode = modeParam && modeParam in MODES ? (modeParam as EngineMode) : settings.mode;
  const minConfidence = Number(url.searchParams.get("minConfidence") ?? settings.minConfidence);

  try {
    const result = await runBacktest(instrument, tf, mode, minConfidence);
    return Response.json(result);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Backtest failed" },
      { status: 500 },
    );
  }
}
