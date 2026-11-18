import { scheduleWeek } from "@/src/server/schedule";
import { getTracking, saveTracking } from "@/src/server/store";
import { weekStartOf } from "@/src/core/time";
import { getProfile } from "@/src/server/store";
import type { MarkStatus } from "@/src/core/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { date, key, status } = (await req.json().catch(() => ({}))) as { date?: string; key?: string; status?: MarkStatus | null };
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !key) return Response.json({ error: "date and key required" }, { status: 400 });
  if (status != null && !["done", "half", "skip"].includes(status)) return Response.json({ error: "bad status" }, { status: 400 });
  const week = scheduleWeek(weekStartOf(date, getProfile().weekStart ?? "mon"));
  const block = week.days.find((d) => d.date === date)?.blocks.find((b) => b.key === key);
  if (!block) return Response.json({ error: "No such block that day" }, { status: 404 });
  if (date > week.today) return Response.json({ error: "Can't mark a future day" }, { status: 400 });
  const t = getTracking();
  t[date] = { ...(t[date] ?? {}) };
  if (status == null) delete t[date][key];
  else t[date][key] = { status, at: new Date().toISOString(), title: block.title, core: block.core, category: block.category };
  saveTracking(t);
  return Response.json({ ok: true, marks: t[date] });
}
