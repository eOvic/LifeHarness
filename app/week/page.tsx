"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import WeekGrid, { Legend } from "@/components/WeekGrid";
import { getJson } from "@/lib/api";
import { addDays, fmt, fmtDuration } from "@/src/core/time";
import type { DaySchedule, Mark, Plan, ScheduledBlock, WeekSchedule } from "@/src/core/types";
import { CATEGORIES } from "@/src/core/types";

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

  if (!week) return <div className="p-10 text-center text-muted">{err ?? "Loading…"}</div>;
  const goals = Object.fromEntries((plan?.goals ?? []).map((g) => [g.id, g.title]));
  const isCurrent = week.days.some((d) => d.date === week.today);

  return (
    <div className="mx-auto max-w-[1500px] px-5 py-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Week of {new Date(`${week.start}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}</h1>
          <p className="text-sm text-muted">
            {plan ? `Plan v${plan.version}` : "No plan yet: showing your anchors"} · {week.tz} · free time {week.stats.freePct}% of awake hours ({fmtDuration(week.stats.freeMin)})
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => load(addDays(week.start, -7))} className="rounded-lg border border-line bg-white px-3 py-1.5 text-sm hover:bg-gray-50">
            ← Prev
          </button>
          {!isCurrent && (
            <button type="button" onClick={() => load()} className="rounded-lg border border-line bg-white px-3 py-1.5 text-sm hover:bg-gray-50">
              This week
            </button>
          )}
          <button type="button" onClick={() => load(addDays(week.start, 7))} className="rounded-lg border border-line bg-white px-3 py-1.5 text-sm hover:bg-gray-50">
            Next →
          </button>
          <a href="/api/calendar" className="ml-2 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:brightness-110" title="8 weeks as an .ics file: import into Google/Apple/Outlook Calendar">
            Export .ics
          </a>
        </div>
      </div>

      {week.unplaced.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Not everything fits: {week.unplaced.map((u) => `${u.title} (${u.placed}/${u.wanted})`).join(", ")}. Run a re-plan from the Life map page.
        </div>
      )}

      <div className="flex gap-5">
        <div className="min-w-0 flex-1 rounded-2xl border border-line bg-white p-3">
          <WeekGrid days={week.days} today={week.today} nowMin={week.nowMin} marks={week.marks} goalTitles={goals} onSelect={(d, b) => setSel({ d, b })} />
          <div className="mt-3 border-t border-line pt-2">
            <Legend days={week.days} />
          </div>
        </div>
        <aside className="hidden w-72 shrink-0 space-y-4 xl:block">
          <div className="rounded-2xl border border-line bg-white p-4">
            {sel ? (
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">{sel.d.day} · {fmt(sel.b.start)}–{fmt(sel.b.end)}</div>
                <div className="mt-1 font-semibold">
                  {sel.b.core && "★ "}
                  {sel.b.title}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                  <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: CATEGORIES[sel.b.category].color }} />
                  {CATEGORIES[sel.b.category].label}
                </div>
                {sel.b.goalId && goals[sel.b.goalId] && <p className="mt-2 text-sm">Goal: {goals[sel.b.goalId]}</p>}
                {sel.b.ifThen && <p className="mt-2 rounded-lg bg-accent-soft px-2 py-1 text-xs text-accent">If-then: {sel.b.ifThen}</p>}
                {sel.b.note && <p className="mt-2 text-xs text-muted">{sel.b.note}</p>}
              </div>
            ) : (
              <p className="text-sm text-muted">Click a block for details.</p>
            )}
          </div>
          <div className="rounded-2xl border border-line bg-white p-4">
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Hours this week</h3>
            <ul className="space-y-1 text-sm">
              {Object.entries(week.stats.byCategory)
                .filter(([c]) => c !== "sleep")
                .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
                .map(([c, m]) => (
                  <li key={c} className="flex items-center gap-2">
                    <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: CATEGORIES[c as keyof typeof CATEGORIES].color }} />
                    <span className="flex-1">{CATEGORIES[c as keyof typeof CATEGORIES].label}</span>
                    <span className="text-muted">{fmtDuration(m ?? 0)}</span>
                  </li>
                ))}
            </ul>
          </div>
          {!plan && (
            <Link href="/start" className="block rounded-2xl bg-accent px-4 py-3 text-center text-sm font-medium text-white">
              Build your plan →
            </Link>
          )}
        </aside>
      </div>
    </div>
  );
}
