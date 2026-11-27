import { scheduleWeek } from "@/src/server/schedule";
import { getTracking, saveTracking } from "@/src/server/store";
import { taskApplies } from "@/src/core/tasks";
import { weekStartOf } from "@/src/core/time";
import { getProfile } from "@/src/server/store";
import { TASK_PREFIX, type Mark, type MarkStatus } from "@/src/core/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Marks a plan block (done / half / skip), or ticks a daily task ("task:<id>", done only).
// status null removes the mark.
export async function POST(req: Request) {
  const { date, key, status } = (await req.json().catch(() => ({}))) as { date?: string; key?: string; status?: MarkStatus | null };
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !key) return Response.json({ error: "date and key required" }, { status: 400 });
  if (status != null && !["done", "half", "skip"].includes(status)) return Response.json({ error: "bad status" }, { status: 400 });
  const profile = getProfile();
  const week = scheduleWeek(weekStartOf(date, profile.weekStart ?? "mon"));
  if (date > week.today) return Response.json({ error: "Can't mark a future day" }, { status: 400 });

  let mark: Omit<Mark, "status" | "at">;
  if (key.startsWith(TASK_PREFIX)) {
    const task = profile.tasks?.find((t) => key === TASK_PREFIX + t.id);
    if (!task || !taskApplies(task, date)) return Response.json({ error: "No such task that day" }, { status: 404 });
    if (status != null && status !== "done") return Response.json({ error: "A task is done or not done" }, { status: 400 });
    mark = { title: task.title, core: false, category: "routine" };
  } else {
    const block = week.days.find((d) => d.date === date)?.blocks.find((b) => b.key === key);
    if (!block) return Response.json({ error: "No such block that day" }, { status: 404 });
    mark = { title: block.title, core: block.core, category: block.category };
  }
  const t = getTracking();
  t[date] = { ...(t[date] ?? {}) };
  if (status == null) delete t[date][key];
  else t[date][key] = { status, at: new Date().toISOString(), ...mark };
  saveTracking(t);
  return Response.json({ ok: true, marks: t[date] });
}
