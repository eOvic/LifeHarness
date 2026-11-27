"use client";
// Today's two side cards: daily tasks to tick (untimed, e.g. "Pray Duha") and upcoming deadlines with
// a countdown. Both live in the life map (profile.tasks / profile.deadlines); the coach can add them too.
import { Check, Plus, X } from "lucide-react";
import { useState } from "react";
import { cx, Label } from "@/components/ui";
import { countdown, taskKey, tasksFor, upcomingDeadlines } from "@/src/core/tasks";
import type { Deadline, Mark, Task } from "@/src/core/types";

const field = "h-8 min-w-0 rounded-lg border border-line bg-canvas px-2.5 text-[13.5px] text-ink outline-none transition placeholder:text-muted/60 focus:border-muted";

/** A readable id from a title: "Pray Duha" -> "pray-duha-k3f9". */
export const newId = (title: string) =>
  `${title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "item"}-${Math.random().toString(36).slice(2, 6)}`;

export function DailyTasks({
  tasks,
  date,
  today,
  marks,
  onTick,
  onAdd,
  onRemove,
}: {
  tasks: Task[];
  date: string;
  today: string;
  marks: Record<string, Mark>;
  onTick: (t: Task, done: boolean) => void;
  onAdd: (title: string) => void;
  onRemove: (t: Task) => void;
}) {
  const [title, setTitle] = useState("");
  const list = tasksFor(tasks, date);
  const canTick = date <= today;
  const done = list.filter((t) => marks[taskKey(t.id)]?.status === "done").length;
  const add = () => {
    if (title.trim()) onAdd(title.trim());
    setTitle("");
  };
  return (
    <section data-lh="tasks" className="rounded-2xl border border-line bg-panel px-5 py-4">
      <div className="flex items-center justify-between">
        <Label>Daily tasks</Label>
        {list.length > 0 && (
          <span className="lh-mono text-[11px] text-muted">
            {done}/{list.length}
          </span>
        )}
      </div>
      <ul className="mt-2 space-y-0.5">
        {list.map((t) => {
          const on = marks[taskKey(t.id)]?.status === "done";
          return (
            <li key={t.id} className="group flex items-center gap-2.5 rounded-lg px-1 py-1 hover:bg-hover">
              <button
                type="button"
                disabled={!canTick}
                onClick={() => onTick(t, !on)}
                title={canTick ? (on ? "Done: click to undo" : "Mark done") : "Can't tick a future day"}
                data-lh="task-tick"
                className={cx(
                  "grid h-5 w-5 shrink-0 place-items-center rounded-md border transition disabled:opacity-40",
                  on ? "border-ok bg-ok text-canvas" : "border-line text-transparent hover:border-muted",
                )}
              >
                <Check className="h-3.5 w-3.5" strokeWidth={3} />
              </button>
              <span className={cx("min-w-0 flex-1 truncate text-[14.5px]", on ? "text-muted line-through decoration-muted/60" : "text-ink")} title={t.note}>
                {t.title}
              </span>
              <button type="button" onClick={() => onRemove(t)} title="Remove this task" className="shrink-0 text-muted opacity-0 transition hover:text-danger group-hover:opacity-100">
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          );
        })}
        {!list.length && <li className="px-1 py-1 text-sm text-muted">Untimed things to tick each day, like a prayer, water or reading a page.</li>}
      </ul>
      <form
        className="mt-2 flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a daily task…" className={cx(field, "flex-1")} data-lh="task-new" />
        <button type="submit" disabled={!title.trim()} title="Add" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line text-muted transition hover:border-muted hover:text-ink disabled:opacity-40">
          <Plus className="h-4 w-4" />
        </button>
      </form>
    </section>
  );
}

export function Deadlines({
  deadlines,
  today,
  onAdd,
  onDone,
  onRemove,
}: {
  deadlines: Deadline[];
  today: string;
  onAdd: (d: { title: string; date: string; time?: string }) => void;
  onDone: (d: Deadline) => void;
  onRemove: (d: Deadline) => void;
}) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const list = upcomingDeadlines(deadlines, today);
  const later = (deadlines ?? []).filter((d) => !d.done).length - list.length;
  const add = () => {
    if (!title.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    onAdd({ title: title.trim(), date });
    setTitle("");
    setDate("");
  };
  return (
    <section data-lh="deadlines" className="rounded-2xl border border-line bg-panel px-5 py-4">
      <Label>Deadlines</Label>
      <ul className="mt-2 space-y-0.5">
        {list.map((d) => {
          const tone = d.left < 0 ? "text-danger" : d.left <= 1 ? "text-danger" : d.left <= 7 ? "text-warn" : "text-muted";
          const when = new Date(`${d.date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
          return (
            <li key={d.id} className="group flex items-center gap-2.5 rounded-lg px-1 py-1 hover:bg-hover">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14.5px] text-ink" title={d.note}>
                  {d.title}
                </div>
                <div className="lh-mono text-[11px] text-muted">
                  {when}
                  {d.time ? ` · ${d.time}` : ""} · <span className={tone}>{d.left < 0 ? `overdue, ${countdown(d.left)}` : countdown(d.left)}</span>
                </div>
              </div>
              <button type="button" onClick={() => onDone(d)} title="Done: handed in or over" data-lh="deadline-done" className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-line text-muted transition hover:border-ok hover:text-ok">
                <Check className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={() => onRemove(d)} title="Delete" className="shrink-0 text-muted opacity-0 transition hover:text-danger group-hover:opacity-100">
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          );
        })}
        {!list.length && <li className="px-1 py-1 text-sm text-muted">Exams, homework, applications: a countdown here, and reminders a week and a day before.</li>}
        {later > 0 && <li className="lh-mono px-1 pt-1 text-[11px] text-muted">+ {later} later</li>}
      </ul>
      <form
        className="mt-2 flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a deadline…" className={cx(field, "flex-1")} data-lh="deadline-new" />
        <input type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} className={cx(field, "w-[140px]")} aria-label="Due date" data-lh="deadline-date" />
        <button type="submit" disabled={!title.trim() || !date} title="Add" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line text-muted transition hover:border-muted hover:text-ink disabled:opacity-40">
          <Plus className="h-4 w-4" />
        </button>
      </form>
    </section>
  );
}
