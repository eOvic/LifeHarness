// What the desktop app should remind you of in the next 36 hours. The shell polls this and shows the
// notifications (electron/main.cjs); the rules are in src/core/reminders.ts.
import { reminderSettings, remindersFor } from "@/src/core/reminders";
import { addDays } from "@/src/core/time";
import { clock, scheduleDays } from "@/src/server/schedule";
import { getSettings, getTracking } from "@/src/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const settings = reminderSettings(getSettings().reminders);
  const { today } = clock();
  const { days, tz } = scheduleDays(2); // this week and next: today and tomorrow are always in it
  const window = days.filter((d) => d.date === today || d.date === addDays(today, 1));
  return Response.json({ items: remindersFor(window, getTracking(), settings, tz, new Date()), settings });
}
