"use client";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { DailyTasks, Deadlines, newId } from "@/components/TasksAndDeadlines";
import { refreshSidebar } from "@/components/Shell";
import { Button, cx, Empty, IconButton, Label, Spinner } from "@/components/ui";
import { tint } from "@/components/WeekGrid";
import { getJson, postJson } from "@/lib/api";
import { addDays, fmt, fmtDuration } from "@/src/core/time";
import { taskKey } from "@/src/core/tasks";
import { CATEGORIES, type Deadline, type Mark, type MarkStatus, type Plan, type Profile, type ScheduledBlock, type Task, type WeekSchedule } from "@/src/core/types";

type Week = WeekSchedule & { today: string; nowMin: number; tz: string; marks: Record<string, Record<string, Mark>> };

const BTN: { s: MarkStatus; label: string; on: string; title: string }[] = [
  { s: "done", label: "✓", on: "border-ok bg-ok text-canvas", title: "Done" },
  { s: "half", label: "½", on: "border-warn bg-warn text-canvas", title: "Half" },
  { s: "skip", label: "✗", on: "border-danger bg-danger text-canvas", title: "Skipped" },
];

export default function Today() {
  const [week, setWeek] = useState<Week | null>(null);
  const [plan, setPlan] = useState<Plan | null | undefined>(undefined);
  const [date, setDate] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  const loadProfile = useCallback(() => getJson<{ profile: Profile }>("/api/profile").then((r) => setProfile(r.profile)).catch(() => {}), []);
  /** Tasks and deadlines live in the life map: edit them with a profile patch. */
  const patchProfile = async (patch: object) => {
    try {
      const r = await postJson<{ profile: Profile }>("/api/profile", patch);
      setProfile(r.profile);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

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
    loadProfile();
    getJson<{ plan: Plan | null }>("/api/state").then((s) => setPlan(s.plan)).catch(() => setPlan(null));
    const t = setInterval(() => load(), 60_000);
    return () => clearInterval(t);
  }, [load, loadProfile]);

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
      refreshSidebar();
    } catch (e) {
      setErr((e as Error).message);
      load(week.start);
    }
  };

  const tickTask = async (t: Task, done: boolean) => {
    if (!week || !day) return;
    const key = taskKey(t.id);
    const marks = { ...week.marks, [day.date]: { ...(week.marks[day.date] ?? {}) } };
    if (done) marks[day.date][key] = { status: "done", at: new Date().toISOString(), title: t.title, core: false, category: "routine" };
    else delete marks[day.date][key];
    setWeek({ ...week, marks });
    try {
      await postJson("/api/track", { date: day.date, key, status: done ? "done" : null });
    } catch (e) {
      setErr((e as Error).message);
      load(week.start);
    }
  };

  if (plan === null) {
    return (
      <>
        <PageHeader title="Today" />
        <Empty
          title="No plan yet"
          action={
            <Link href="/start">
              <Button variant="accent" size="lg">
                Start the interview →
              </Button>
            </Link>
          }
        >
          Your day appears here once you&apos;ve adopted a plan.
        </Empty>
      </>
    );
  }
  if (!week || !day) {
    return (
      <>
        <PageHeader title="Today" />
        <div className="grid flex-1 place-items-center text-muted">{err ?? <Spinner />}</div>
      </>
    );
  }

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
    <>
      <PageHeader
        title={isToday ? "Today" : label}
        meta={isToday ? `${label} · ${fmt(week.nowMin)}` : isPast ? "past day · still markable" : "upcoming"}
        right={
          <>
            <IconButton onClick={() => go(-1)} title="Previous day">
              <ChevronLeft />
            </IconButton>
            {!isToday && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setDate(week.today);
                  if (!week.days.some((d) => d.date === week.today)) load();
                }}
              >
                Today
              </Button>
            )}
            <IconButton onClick={() => go(1)} title="Next day">
              <ChevronRight />
            </IconButton>
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[860px] px-6 pb-12 pt-6">
          {isToday && (
            <div className="grid gap-3 sm:grid-cols-2">
              <NowCard label="Now" block={current} goals={goals} nowMin={week.nowMin} />
              <NowCard label="Next" block={next} goals={goals} nowMin={week.nowMin} />
            </div>
          )}

          {profile && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <DailyTasks
                tasks={profile.tasks ?? []}
                date={day.date}
                today={week.today}
                marks={dm}
                onTick={tickTask}
                onAdd={(title) => patchProfile({ tasks: [{ id: newId(title), title }] })}
                onRemove={(t) => patchProfile({ remove: { tasks: [t.id] } })}
              />
              <Deadlines
                deadlines={profile.deadlines ?? []}
                today={week.today}
                onAdd={(d) => patchProfile({ deadlines: [{ id: newId(d.title), ...d }] })}
                onDone={(d: Deadline) => patchProfile({ deadlines: [{ id: d.id, done: true }] })}
                onRemove={(d: Deadline) => patchProfile({ remove: { deadlines: [d.id] } })}
              />
            </div>
          )}

          <div className="mt-6 flex items-center gap-4 border-b border-line pb-3">
            <Label>
              <span className="text-ok">{c.done} done</span> · <span className="text-warn">{c.half} half</span> · <span className="text-danger">{c.skip} skipped</span> · {counted.length - marked} to mark
            </Label>
            {score != null && <span className="lh-title ml-auto text-xl">{score}%</span>}
          </div>

          <ol className="mt-3 space-y-1">
            {visible.map((b) => {
              const m = dm[b.key];
              const active = b === current;
              const started = isPast || (isToday && b.start <= now);
              const color = CATEGORIES[b.category].color;
              return (
                <li
                  key={b.key + b.start}
                  className={cx(
                    "group flex items-center gap-4 rounded-xl px-3 py-2.5 transition",
                    active ? "bg-selected ring-1 ring-accent/50" : "hover:bg-hover",
                    b.overlay && "ml-10",
                    m?.status === "skip" && "opacity-55",
                  )}
                >
                  <div className="lh-mono w-[88px] shrink-0 text-[12px] text-muted">
                    {fmt(b.start)}–{fmt(b.end)}
                  </div>
                  <span className="h-9 w-[3px] shrink-0 rounded-full" style={{ background: color }} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] text-ink">
                      {b.core && <span className="mr-1 text-accent">★</span>}
                      {b.title}
                    </div>
                    <div className="truncate text-sm text-muted" title={[b.note, b.ifThen && `If-then: ${b.ifThen}`].filter(Boolean).join("\n")}>
                      {[b.goalId && goals[b.goalId], b.ifThen ? `If-then: ${b.ifThen}` : b.note].filter(Boolean).join(" · ") || CATEGORIES[b.category].label}
                    </div>
                  </div>
                  {b.tracked && (isPast || isToday) && (
                    <div className={cx("flex shrink-0 gap-1", !started && !m && "opacity-35 group-hover:opacity-80")}>
                      {BTN.map((x) => (
                        <button
                          type="button"
                          key={x.s}
                          onClick={() => mark(b, x.s)}
                          title={x.title}
                          className={cx("lh-mono h-8 w-8 rounded-lg border text-[13px] font-semibold transition", m?.status === x.s ? x.on : "border-line text-muted hover:border-muted hover:text-ink")}
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
          <p className="lh-mono mt-6 text-[11px] text-muted">
            Awake {fmt(day.wake)}–{fmt(day.bed)} · planned {fmtDuration(visible.filter((b) => !b.overlay).reduce((s, b) => s + b.end - b.start, 0))} · honest marks beat perfect ones
          </p>
          {err && <p className="mt-2 text-sm text-danger">{err}</p>}
        </div>
      </div>
    </>
  );
}

function NowCard({ label, block, goals, nowMin }: { label: string; block?: ScheduledBlock; goals: Record<string, string>; nowMin: number }) {
  if (!block) {
    return (
      <div className="rounded-2xl border border-dashed border-line px-5 py-4">
        <Label>{label}</Label>
        <div className="mt-1.5 text-[15px] text-muted">{label === "Now" ? "Free time" : "Nothing else today"}</div>
      </div>
    );
  }
  const color = CATEGORIES[block.category].color;
  const isNow = label === "Now";
  const left = isNow ? block.end - nowMin : block.start - nowMin;
  return (
    <div className="rounded-2xl border border-line bg-panel px-5 py-4">
      <div className="flex items-center justify-between">
        <Label className={isNow ? "text-accent" : ""}>{label}</Label>
        <span className="lh-mono text-[11px] text-muted">{isNow ? `${fmtDuration(left)} left` : `in ${fmtDuration(left)}`}</span>
      </div>
      <div className="mt-2 flex items-center gap-2.5">
        <span className="h-5 w-[3px] shrink-0 rounded-full" style={{ background: color }} />
        <span className="truncate text-lg font-semibold text-ink">
          {block.core && <span className="mr-1 text-accent">★</span>}
          {block.title}
        </span>
      </div>
      <div className="lh-mono mt-1 text-[11.5px] text-muted">
        {fmt(block.start)}–{fmt(block.end)}
        {block.goalId && goals[block.goalId] ? ` · ${goals[block.goalId]}` : ""}
      </div>
      {isNow && (
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-hover">
          <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(((nowMin - block.start) / (block.end - block.start)) * 100)}%` }} />
        </div>
      )}
      {block.ifThen && (
        <div className="mt-3 rounded-lg px-3 py-2 text-sm text-ink" style={tint(color, 14)}>
          <span className="lh-mono mr-1 text-[10.5px] uppercase tracking-[0.07em] text-muted">if-then</span>
          {block.ifThen}
        </div>
      )}
      {!block.ifThen && block.note && <div className="mt-2 text-sm text-muted">{block.note}</div>}
    </div>
  );
}
