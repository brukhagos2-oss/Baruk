import { getSettings, saveSettings, type EngineSettings } from "@/lib/engine";
import { isInstrument, isTimeframe } from "@/lib/market/instruments";
import { MODES, type EngineMode } from "@/lib/strategy";

export const dynamic = "force-dynamic";

export async function GET() {
  const settings = await getSettings();
  return Response.json({ settings, modes: MODES });
}

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<EngineSettings>;
  const patch: Partial<EngineSettings> = {};

  if (typeof body.minConfidence === "number") patch.minConfidence = body.minConfidence;
  if (typeof body.autoScan === "boolean") patch.autoScan = body.autoScan;
  if (typeof body.pushEnabled === "boolean") patch.pushEnabled = body.pushEnabled;
  if (typeof body.soundEnabled === "boolean") patch.soundEnabled = body.soundEnabled;
  if (typeof body.riskPerTrade === "number") patch.riskPerTrade = Math.max(0.1, Math.min(10, body.riskPerTrade));
  if (typeof body.accountSize === "number") patch.accountSize = Math.max(100, body.accountSize);
  if (typeof body.mode === "string" && body.mode in MODES) {
    const mode = body.mode as EngineMode;
    patch.mode = mode;
    if (typeof body.minConfidence !== "number") patch.minConfidence = MODES[mode].minConfidence;
  }
  if (Array.isArray(body.instruments)) patch.instruments = body.instruments.filter(isInstrument);
  if (Array.isArray(body.timeframes)) patch.timeframes = body.timeframes.filter(isTimeframe);

  const settings = await saveSettings(patch);
  return Response.json({ settings });
}
