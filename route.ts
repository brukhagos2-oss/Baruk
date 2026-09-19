import { desc, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { alerts } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 30), 100);
  const [rows, [unread]] = await Promise.all([
    db.select().from(alerts).orderBy(desc(alerts.createdAt)).limit(limit),
    db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(alerts)
      .where(isNull(alerts.readAt)),
  ]);
  return Response.json({ alerts: rows, unread: unread?.count ?? 0 });
}

export async function POST() {
  await db.update(alerts).set({ readAt: new Date() }).where(isNull(alerts.readAt));
  return Response.json({ ok: true });
}
