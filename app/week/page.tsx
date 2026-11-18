"use client";
import { CalendarArrowDown, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { Button, IconButton, Label, Spinner } from "@/components/ui";
import WeekGrid, { Legend, tint } from "@/components/WeekGrid";
import { getJson } from "@/lib/api";
import { addDays, fmt, fmtDuration } from "@/src/core/time";
import { CATEGORIES, type DaySchedule, type Mark, type Plan, type ScheduledBlock, type WeekSchedule } from "@/src/core/types";

type Week = WeekSchedule & { today: string; nowMin: number; tz: string; marks: Record<string, Record<string, Mark>> };

export default function WeekPage() {
  const [week, setWeek] = useState<Week | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [sel, setSel] = useState<{ d: DaySchedule; b: ScheduledBlock } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback((start?: string) => {
    getJson<Week>(`/api/schedule${start ? `?start=${start}` : ""}`)
      .then(setWeek)
      .catch((e) => setErr(e.message));
  }, []);
  useEffect(() => {
    load();
    getJson<{ plan: Plan | null }>("/api/state").then((s) => setPlan(s.plan)).catch(() => {});
  }, [load]);

  if (!week) {
    return (
      <>
        <PageHeader title="Week" />
        <div className="grid flex-1 place-items-center text-muted">{err ?? <Spinner />}</div>
      </>
    );
  }
  const goals = Object.fromEntries((plan?.goals ?? []).map((g) => [g.id, g.title]));
  const isCurrent = week.days.some((d) => d.date === week.today);
  const title = new Date(`${week.start}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });

  return (
    <>
      <PageHeader
        title={`Week of ${title}`}
        meta={`${plan ? `plan v${plan.version}` : "anchors only"} · ${week.tz} · ${week.stats.freePct}% free`}
        right={
          <>
            <IconButton onClick={() => load(addDays(week.start, -7))} title="Previous week">
              <ChevronLeft />
            </IconButton>
            {!isCurrent && (
              <Button size="sm" onClick={() => load()}>
                This week
              </Button>
            )}
            <IconButton onClick={() => load(addDays(week.start, 7))} title="Next week">
              <ChevronRight />
            </IconButton>
            <a href="/api/calendar" title="8 weeks as an .ics file: import into Google, Apple or Outlook Calendar">
              <Button size="sm" variant="secondary" className="ml-1">
                <CalendarArrowDown className="h-3.5 w-3.5" /> Export .ics
              </Button>
            </a>
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex gap-5 px-5 pb-10 pt-5">
          <div className="min-w-0 flex-1">
            {week.unplaced.length > 0 && (
              <div className="mb-4 rounded-xl border border-warn/40 px-4 py-2.5 text-sm">
                <span className="text-warn">!</span> Not everything fits: {week.unplaced.map((u) => `${u.title} (${u.placed}/${u.wanted})`).join(", ")}.{" "}
                <Link href="/map" className="text-accent hover:underline">
                  Re-plan
                </Link>
              </div>
            )}
            <WeekGrid
              days={week.days}
              today={week.today}
              nowMin={week.nowMin}
              marks={week.marks}
              goalTitles={goals}
              selectedKey={sel ? `${sel.d.date}|${sel.b.key}` : undefined}
              onSelect={(d, b) => setSel({ d, b })}
            />
            <div className="mt-4 border-t border-line pt-3">
              <Legend days={week.days} />
            </div>
          </div>
          <aside className="hidden w-[280px] shrink-0 space-y-4 xl:block">
            <div className="rounded-xl border border-line p-4">
              {sel ? (
                <div>
                  <Label>
                    {sel.d.day} · {fmt(sel.b.start)}–{fmt(sel.b.end)}
                  </Label>
                  <div className="mt-2 rounded-lg px-3 py-2" style={tint(CATEGORIES[sel.b.category].color, 16)}>
                    <div className="text-[15px] font-semibold text-ink">
                      {sel.b.core && <span className="mr-1 text-accent">★</span>}
                      {sel.b.title}
                    </div>
                    <div className="lh-mono text-[11px] text-muted">{CATEGORIES[sel.b.category].label}</div>
                  </div>
                  {sel.b.goalId && goals[sel.b.goalId] && <p className="mt-3 text-sm text-ink">Serves: {goals[sel.b.goalId]}</p>}
                  {sel.b.ifThen && (
                    <p className="mt-2 text-sm text-ink">
                      <span className="lh-mono mr-1 text-[10.5px] uppercase tracking-[0.07em] text-muted">if-then</span>
                      {sel.b.ifThen}
                    </p>
                  )}
                  {sel.b.note && <p className="mt-2 text-sm text-muted">{sel.b.note}</p>}
                </div>
              ) : (
                <p className="text-sm text-muted">Click a block for details.</p>
              )}
            </div>
            <div className="rounded-xl border border-line p-4">
              <Label className="mb-3 block">Hours this week</Label>
              <ul className="space-y-2">
                {Object.entries(week.stats.byCategory)
                  .filter(([c]) => c !== "sleep")
                  .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
                  .map(([c, m]) => (
                    <li key={c} className="flex items-center gap-2.5 text-sm">
                      <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: CATEGORIES[c as keyof typeof CATEGORIES].color }} />
                      <span className="flex-1 text-ink">{CATEGORIES[c as keyof typeof CATEGORIES].label}</span>
                      <span className="lh-mono text-[11px] text-muted">{fmtDuration(m ?? 0)}</span>
                    </li>
                  ))}
              </ul>
              <div className="mt-3 flex items-center justify-between border-t border-line pt-3 text-sm">
                <span className="text-ink">Unplanned awake time</span>
                <span className="lh-mono text-[11px] text-accent">{fmtDuration(week.stats.freeMin)}</span>
              </div>
            </div>
            {!plan && (
              <Link href="/start" className="block">
                <Button variant="accent" className="w-full">
                  Build your plan →
                </Button>
              </Link>
            )}
          </aside>
        </div>
      </div>
    </>
  );
}
