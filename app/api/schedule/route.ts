import { scheduleWeek } from "@/src/server/schedule";
import { getTracking } from "@/src/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const start = new URL(req.url).searchParams.get("start") ?? undefined;
  if (start && !/^\d{4}-\d{2}-\d{2}$/.test(start)) return Response.json({ error: "start must be YYYY-MM-DD" }, { status: 400 });
  const week = scheduleWeek(start);
  const t = getTracking();
  const marks = Object.fromEntries(week.days.map((d) => [d.date, t[d.date] ?? {}]));
  return Response.json({ ...week, marks });
}
