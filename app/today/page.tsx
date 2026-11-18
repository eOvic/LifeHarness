"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getJson, postJson } from "@/lib/api";
import { addDays, fmt, fmtDuration } from "@/src/core/time";
import { CATEGORIES, type DaySchedule, type Mark, type MarkStatus, type Plan, type ScheduledBlock, type WeekSchedule } from "@/src/core/types";

type Week = WeekSchedule & { today: string; nowMin: number; tz: string; marks: Record<string, Record<string, Mark>> };

const BTN: { s: MarkStatus; label: string; on: string }[] = [
  { s: "done", label: "✓", on: "bg-emerald-500 text-white border-emerald-500" },
  { s: "half", label: "½", on: "bg-amber-400 text-white border-amber-400" },
  { s: "skip", label: "✗", on: "bg-rose-500 text-white border-rose-500" },
];

export default function Today() {
  const [week, setWeek] = useState<Week | null>(null);
  const [plan, setPlan] = useState<Plan | null | undefined>(undefined);
  const [date, setDate] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (start?: string) => {
    try {
      const w = await getJson<Week>(`/api/schedule${start ? `?start=${start}` : ""}`);
      setWeek(w);
      setDate((d) => d ?? w.today);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
    getJson<{ plan: Plan | null }>("/api/state").then((s) => setPlan(s.plan)).catch(() => setPlan(null));
    const t = setInterval(() => load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  const day = week?.days.find((d) => d.date === date);
  const goals = useMemo(() => Object.fromEntries((plan?.goals ?? []).map((g) => [g.id, g.title])), [plan]);

  const go = (delta: number) => {
    if (!date || !week) return;
    const next = addDays(date, delta);
    setDate(next);
    if (!week.days.some((d) => d.date === next)) load(addDays(week.start, delta > 0 ? 7 : -7));
  };

  const mark = async (b: ScheduledBlock, s: MarkStatus) => {
    if (!week || !day) return;
    const cur = week.marks[day.date]?.[b.key]?.status;
    const status = cur === s ? null : s;
    const marks = { ...week.marks, [day.date]: { ...(week.marks[day.date] ?? {}) } };
    if (status) marks[day.date][b.key] = { status, at: new Date().toISOString(), title: b.title, core: b.core, category: b.category };
    else delete marks[day.date][b.key];
    setWeek({ ...week, marks });
    try {
      await postJson("/api/track", { date: day.date, key: b.key, status });
    } catch (e) {
      setErr((e as Error).message);
      load(week.start);
    }
  };

  if (plan === null) {
    return (
      <div className="mx-auto max-w-xl px-6 py-20 text-center">
        <h1 className="text-2xl font-semibold">No plan yet</h1>
        <p className="mt-2 text-muted">Start with the interview; your Today view appears once you adopt a plan.</p>
        <Link href="/start" className="mt-6 inline-block rounded-xl bg-accent px-5 py-2.5 font-medium text-white">
          Start →
        </Link>
      </div>
    );
  }
  if (!week || !day) return <div className="p-10 text-center text-muted">{err ?? "Loading…"}</div>;

  const isToday = day.date === week.today;
  const isPast = day.date < week.today;
  const visible = day.blocks.filter((b) => b.source !== "sleep");
  const now = isToday ? week.nowMin : -1;
  const current = visible.filter((b) => b.start <= now && now < b.end).sort((a, b) => Number(!!a.overlay) - Number(!!b.overlay))[0];
  const next = visible.find((b) => b.start > now && !b.overlay);
  const dm = week.marks[day.date] ?? {};
  const tracked = visible.filter((b) => b.tracked);
  const counted = tracked.filter((b) => isPast || b.start <= now || dm[b.key]);
  const c = { done: 0, half: 0, skip: 0 };
  for (const b of counted) if (dm[b.key]) c[dm[b.key].status === "skip" ? "skip" : dm[b.key].status]++;
  const marked = c.done + c.half + c.skip;
  const score = marked ? Math.round(((c.done + c.half / 2) / marked) * 100) : null;
  const label = new Date(`${day.date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

  return (
    <div className="mx-auto max-w-3xl px-5 py-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{isToday ? "Today" : label}</h1>
          <p className="text-sm text-muted">
            {isToday ? `${label} · ${fmt(week.nowMin)}` : isPast ? "Past day: you can still mark it" : "Upcoming"}
            {day.planVersion ? ` · plan v${day.planVersion}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => go(-1)} className="rounded-lg border border-line bg-white px-3 py-1.5 text-sm hover:bg-gray-50">
            ←
          </button>
          {!isToday && (
            <button type="button" onClick={() => { setDate(week.today); if (!week.days.some((d) => d.date === week.today)) load(); }} className="rounded-lg border border-line bg-white px-3 py-1.5 text-sm hover:bg-gray-50">
              Today
            </button>
          )}
          <button type="button" onClick={() => go(1)} className="rounded-lg border border-line bg-white px-3 py-1.5 text-sm hover:bg-gray-50">
            →
          </button>
        </div>
      </div>

      {isToday && (
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <NowCard label="Now" block={current} goals={goals} nowMin={week.nowMin} />
          <NowCard label="Next" block={next} goals={goals} nowMin={week.nowMin} />
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-4 rounded-xl border border-line bg-white px-4 py-3 text-sm">
        <span>
          <b className="text-emerald-600">{c.done}</b> done · <b className="text-amber-500">{c.half}</b> half · <b className="text-rose-500">{c.skip}</b> skipped ·{" "}
          <b className="text-muted">{counted.length - marked}</b> to mark
        </span>
        {score != null && <span className="ml-auto font-semibold">{score}%</span>}
      </div>

      <ol className="mt-4 space-y-1.5">
        {visible.map((b) => {
          const m = dm[b.key];
          const active = b === current;
          const started = isPast || (isToday && b.start <= now);
          return (
            <li
              key={b.key + b.start}
              className={`flex items-center gap-3 rounded-xl border bg-white px-3 py-2 ${active ? "border-accent ring-2 ring-accent/20" : "border-line"} ${b.overlay ? "ml-8" : ""} ${
                m?.status === "skip" ? "opacity-60" : ""
              }`}
            >
              <div className="w-[92px] shrink-0 text-xs tabular-nums text-muted">
                {fmt(b.start)}–{fmt(b.end)}
              </div>
              <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: CATEGORIES[b.category].color }} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {b.core && <span title="non-negotiable">★ </span>}
                  {b.title}
                </div>
                <div className="truncate text-xs text-muted" title={[b.note, b.ifThen && `If-then: ${b.ifThen}`].filter(Boolean).join("\n")}>
                  {[b.goalId && goals[b.goalId], b.ifThen ? `If-then: ${b.ifThen}` : b.note].filter(Boolean).join(" · ") || CATEGORIES[b.category].label}
                </div>
              </div>
              {b.tracked && (isPast || isToday) && (
                <div className={`flex shrink-0 gap-1 ${started || m ? "" : "opacity-40"}`}>
                  {BTN.map((x) => (
                    <button
                      type="button"
                      key={x.s}
                      onClick={() => mark(b, x.s)}
                      title={x.s}
                      className={`h-8 w-8 rounded-lg border text-sm font-semibold transition ${m?.status === x.s ? x.on : "border-line text-muted hover:border-gray-400 hover:text-ink"}`}
                    >
                      {x.label}
                    </button>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <p className="mt-4 text-xs text-muted">
        Awake {fmt(day.wake)}–{fmt(day.bed)} · planned {fmtDuration(visible.filter((b) => !b.overlay).reduce((s, b) => s + b.end - b.start, 0))}. Marks feed the weekly review: honest marks
        beat perfect ones.
      </p>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
    </div>
  );
}

function NowCard({ label, block, goals, nowMin }: { label: string; block?: ScheduledBlock; goals: Record<string, string>; nowMin: number }) {
  if (!block) {
    return (
      <div className="rounded-2xl border border-dashed border-line bg-white/60 px-4 py-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</div>
        <div className="mt-1 text-sm text-muted">{label === "Now" ? "Free time" : "Nothing else today"}</div>
      </div>
    );
  }
  const color = CATEGORIES[block.category].color;
  const left = label === "Now" ? block.end - nowMin : block.start - nowMin;
  return (
    <div className="rounded-2xl border border-line bg-white px-4 py-3" style={{ borderLeft: `5px solid ${color}` }}>
      <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-muted">
        {label}
        <span className="normal-case tracking-normal">{label === "Now" ? `${fmtDuration(left)} left` : `in ${fmtDuration(left)}`}</span>
      </div>
      <div className="mt-1 font-semibold">
        {block.core && "★ "}
        {block.title}
      </div>
      <div className="text-xs text-muted">
        {fmt(block.start)}–{fmt(block.end)}
        {block.goalId && goals[block.goalId] ? ` · ${goals[block.goalId]}` : ""}
      </div>
      {block.ifThen && <div className="mt-1.5 rounded-lg bg-accent-soft px-2 py-1 text-xs text-accent">If-then: {block.ifThen}</div>}
      {!block.ifThen && block.note && <div className="mt-1.5 text-xs text-muted">{block.note}</div>}
    </div>
  );
}

export type { DaySchedule };
