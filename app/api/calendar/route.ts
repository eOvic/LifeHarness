// .ics export: the next 8 weeks. Import into Google/Apple/Outlook calendar.
import { toIcs } from "@/src/core/ics";
import { scheduleDays } from "@/src/server/schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { days, tz } = scheduleDays(8);
  return new Response(toIcs(days, tz), {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'attachment; filename="lifeharness.ics"' },
  });
}
