// Weekly tracking report.
// Score = done 1 · half 0.5 · skipped 0, over MARKED blocks only. Unmarked = started but never ticked.
import { isTaskKey, taskStats, type TaskStat } from "./tasks";
import type { Category, DaySchedule, Task, Tracking } from "./types";

export interface BlockStat {
  title: string;
  category: Category;
  core: boolean;
  done: number;
  half: number;
  skip: number;
  unmarked: number;
  score: number | null; // 0-100
}

export interface DayStat {
  date: string;
  done: number;
  half: number;
  skip: number;
  unmarked: number;
  score: number | null;
  coreScore: number | null;
}

export interface WeekReport {
  start: string;
  end: string;
  days: DayStat[];
  blocks: BlockStat[];
  score: number | null;
  coreScore: number | null;
  marked: number;
  unmarked: number;
  streaks: { title: string; days: number }[];
  weakest: BlockStat | null;
  /** "score" = lowest-scoring block; "unmarked" = everything marked scored 100%, so the most-unmarked block. */
  weakestReason: "score" | "unmarked" | null;
  /** Daily tasks: days done out of days due (separate from the block score). */
  tasks: TaskStat[];
}

const pct = (done: number, half: number, marked: number) => (marked ? Math.round(((done + 0.5 * half) / marked) * 100) : null);

/** `today`/`nowMin` decide which blocks have started (only those can be "unmarked"). */
export function weekReport(days: DaySchedule[], tracking: Tracking, today: string, nowMin: number, tasks: Task[] = []): WeekReport {
  const byTitle = new Map<string, BlockStat>();
  const dayStats: DayStat[] = [];
  let tot = { done: 0, half: 0, skip: 0, unmarked: 0 };
  let core = { done: 0, half: 0, marked: 0 };

  for (const d of days) {
    const marks = tracking[d.date] ?? {};
    const ds = { done: 0, half: 0, skip: 0, unmarked: 0 };
    // Before the first plan was adopted nothing was being tracked: don't count those days.
    if (d.planVersion == null && !Object.keys(marks).length) {
      dayStats.push({ date: d.date, ...ds, score: null, coreScore: null });
      continue;
    }
    const dc = { done: 0, half: 0, marked: 0 };
    const seen = new Set<string>();
    for (const b of d.blocks) {
      if (!b.tracked) continue;
      const started = d.date < today || (d.date === today && b.start <= nowMin);
      const m = marks[b.key];
      seen.add(b.key);
      if (!m && !started) continue;
      const st = byTitle.get(b.title) ?? { title: b.title, category: b.category, core: b.core, done: 0, half: 0, skip: 0, unmarked: 0, score: null };
      byTitle.set(b.title, st);
      if (!m) {
        st.unmarked++;
        ds.unmarked++;
        continue;
      }
      st[m.status === "skip" ? "skip" : m.status]++;
      ds[m.status === "skip" ? "skip" : m.status]++;
      if (b.core) {
        dc.marked++;
        if (m.status === "done") dc.done++;
        if (m.status === "half") dc.half++;
      }
    }
    // Marks whose block no longer exists in the plan still count (the plan may have changed).
    for (const [key, m] of Object.entries(marks)) {
      if (seen.has(key) || isTaskKey(key)) continue; // daily tasks have their own section
      const st = byTitle.get(m.title) ?? { title: m.title, category: m.category, core: m.core, done: 0, half: 0, skip: 0, unmarked: 0, score: null };
      byTitle.set(m.title, st);
      st[m.status === "skip" ? "skip" : m.status]++;
      ds[m.status === "skip" ? "skip" : m.status]++;
      if (m.core) {
        dc.marked++;
        if (m.status === "done") dc.done++;
        if (m.status === "half") dc.half++;
      }
    }
    const marked = ds.done + ds.half + ds.skip;
    dayStats.push({ date: d.date, ...ds, score: pct(ds.done, ds.half, marked), coreScore: pct(dc.done, dc.half, dc.marked) });
    tot = { done: tot.done + ds.done, half: tot.half + ds.half, skip: tot.skip + ds.skip, unmarked: tot.unmarked + ds.unmarked };
    core = { done: core.done + dc.done, half: core.half + dc.half, marked: core.marked + dc.marked };
  }

  const blocks = [...byTitle.values()].map((b) => ({ ...b, score: pct(b.done, b.half, b.done + b.half + b.skip) }));
  blocks.sort((a, b) => (a.score ?? 101) - (b.score ?? 101) || b.skip - a.skip || b.unmarked - a.unmarked);

  // Weakest: lowest score among marked blocks; if all perfect, the most-unmarked block (tracking is the habit to fix).
  const scored = blocks.filter((b) => b.score != null);
  let weakest: BlockStat | null = scored.find((b) => (b.score ?? 100) < 100) ?? null;
  let weakestReason: WeekReport["weakestReason"] = weakest ? "score" : null;
  if (!weakest) {
    weakest = [...blocks].sort((a, b) => b.unmarked - a.unmarked).find((b) => b.unmarked > 0) ?? null;
    if (weakest) weakestReason = "unmarked";
  }

  // Core streaks: consecutive days (most recent first, today excluded if unfinished) where every
  // occurrence of that core block was marked done.
  const streaks: { title: string; days: number }[] = [];
  const coreTitles = [...new Set(days.flatMap((d) => d.blocks.filter((b) => b.core && b.tracked).map((b) => b.title)))];
  const past = days.filter((d) => d.date <= today && (d.planVersion != null || tracking[d.date])).reverse();
  for (const title of coreTitles) {
    let n = 0;
    for (const d of past) {
      const occ = d.blocks.filter((b) => b.title === title && b.tracked);
      if (!occ.length) continue;
      const allDone = occ.every((b) => tracking[d.date]?.[b.key]?.status === "done");
      if (allDone) n++;
      else if (d.date === today) continue; // today may not be finished yet
      else break;
    }
    streaks.push({ title, days: n });
  }
  streaks.sort((a, b) => b.days - a.days);

  const marked = tot.done + tot.half + tot.skip;
  return {
    start: days[0]?.date ?? today,
    end: days[days.length - 1]?.date ?? today,
    days: dayStats,
    blocks,
    score: pct(tot.done, tot.half, marked),
    coreScore: pct(core.done, core.half, core.marked),
    marked,
    unmarked: tot.unmarked,
    streaks,
    weakest,
    weakestReason,
    tasks: taskStats(tasks, tracking, days.map((d) => d.date), today),
  };
}

export function reportText(r: WeekReport): string {
  const lines = [
    `Week ${r.start} to ${r.end}: score ${r.score ?? "-"}% · core ${r.coreScore ?? "-"}% · marked ${r.marked} · unmarked ${r.unmarked}`,
    "By day: " + r.days.map((d) => `${d.date.slice(5)} ${d.score ?? "-"}%${d.unmarked ? ` (${d.unmarked} unmarked)` : ""}`).join(" · "),
    "By block (worst first):",
    ...r.blocks.map((b) => `- ${b.core ? "★ " : ""}${b.title}: ${b.score ?? "-"}% (done ${b.done}, half ${b.half}, skipped ${b.skip}, unmarked ${b.unmarked})`),
    "Core streaks: " + (r.streaks.map((s) => `${s.title} ${s.days}d`).join(", ") || "-"),
    ...(r.tasks.length ? ["Daily tasks: " + r.tasks.map((t) => `${t.title} ${t.done}/${t.due} days`).join(", ")] : []),
    r.weakestReason === "unmarked"
      ? `Everything marked scored 100%. Most-unmarked block: ${r.weakest!.title} (${r.weakest!.unmarked} unmarked): tracking is the habit to fix.`
      : `Weakest block: ${r.weakest ? `${r.weakest.title} (${r.weakest.score ?? "-"}%)` : "none"}`,
  ];
  return lines.join("\n");
}
