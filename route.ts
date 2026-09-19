import { desc, gt } from "drizzle-orm";

import { db } from "@/db";
import { alerts, scanRuns } from "@/db/schema";
import { runScan } from "@/lib/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const globalGuard = globalThis as typeof globalThis & { __apexLastScan?: number; __apexScanning?: boolean };
const MIN_GAP_MS = 8_000;

export async function POST() {
  const now = Date.now();
  if (globalGuard.__apexScanning || (globalGuard.__apexLastScan && now - globalGuard.__apexLastScan < MIN_GAP_MS)) {
    const [last] = await db.select().from(scanRuns).orderBy(desc(scanRuns.createdAt)).limit(1);
    return Response.json({ throttled: true, lastRun: last ?? null });
  }

  globalGuard.__apexScanning = true;
  const since = new Date(now - 60_000);
  try {
    const summary = await runScan();
    const fresh = await db
      .select()
      .from(alerts)
      .where(gt(alerts.createdAt, since))
      .orderBy(desc(alerts.createdAt))
      .limit(20);
    globalGuard.__apexLastScan = Date.now();
    return Response.json({ throttled: false, summary, alerts: fresh });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Scan failed" },
      { status: 500 },
    );
  } finally {
    globalGuard.__apexScanning = false;
  }
}

export async function GET() {
  const [last] = await db.select().from(scanRuns).orderBy(desc(scanRuns.createdAt)).limit(1);
  return Response.json({ lastRun: last ?? null });
}
