"use client";
import { fmt } from "@/src/core/time";
import { CATEGORIES, type DaySchedule, type Mark, type ScheduledBlock } from "@/src/core/types";
import { cx } from "./ui";

const MARK_ICON = { done: "✓", half: "½", skip: "✗" } as const;

interface Props {
  days: DaySchedule[];
  compact?: boolean;
  today?: string;
  nowMin?: number;
  marks?: Record<string, Record<string, Mark>>;
  goalTitles?: Record<string, string>;
  selectedKey?: string;
  onSelect?: (day: DaySchedule, block: ScheduledBlock) => void;
}

export function visibleRange(days: DaySchedule[]): [number, number] {
  let lo = 6 * 60;
  let hi = 22 * 60;
  for (const d of days) {
    lo = Math.min(lo, d.wake);
    hi = Math.max(hi, Math.min(d.bed, 1440));
    for (const b of d.blocks) {
      if (b.source === "sleep") continue;
      lo = Math.min(lo, b.start);
      hi = Math.max(hi, b.end);
    }
  }
  return [Math.max(0, Math.floor(lo / 60) * 60), Math.min(1440, Math.ceil(hi / 60) * 60)];
}

/** A category tint: soft fill + strong edge, with the theme's own text on top. */
export function tint(color: string, strength = 20) {
  return { background: `color-mix(in oklab, ${color} ${strength}%, var(--bg))`, borderLeft: `3px solid ${color}` };
}

export default function WeekGrid({ days, compact = false, today, nowMin, marks, goalTitles, selectedKey, onSelect }: Props) {
  const [lo, hi] = visibleRange(days);
  const px = compact ? 0.62 : 1.1;
  const height = (hi - lo) * px;
  const hours: number[] = [];
  for (let h = lo; h <= hi; h += 60) hours.push(h);

  return (
    <div className="w-full select-none">
      <div className="flex">
        <div className={compact ? "w-9 shrink-0" : "w-12 shrink-0"} />
        {days.map((d) => {
          const isToday = d.date === today;
          const dt = new Date(`${d.date}T12:00:00Z`);
          const wd = dt.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
          return (
            <div key={d.date} className="flex flex-1 justify-center pb-2">
              <span
                className={cx(
                  "lh-mono inline-flex items-baseline gap-1.5 rounded-md px-2 py-0.5 uppercase tracking-[0.06em]",
                  compact ? "text-[10.5px]" : "text-[11.5px]",
                  isToday ? "bg-accent text-accent-ink" : "text-muted",
                )}
              >
                {wd}
                <span className={isToday ? "" : "text-ink"}>{dt.getUTCDate()}</span>
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex">
        <div className={cx("relative shrink-0", compact ? "w-9" : "w-12")} style={{ height }}>
          {hours.map((h) => (
            <div key={h} className="lh-mono absolute right-2 -translate-y-1.5 text-[10px] text-muted" style={{ top: (h - lo) * px }}>
              {fmt(h)}
            </div>
          ))}
        </div>
        {days.map((d) => (
          <div key={d.date} className={cx("relative flex-1 border-l border-line-soft", d.date === today && "bg-hover/40")} style={{ height }}>
            {hours.map((h) => (
              <div key={h} className="absolute inset-x-0 border-t border-line-soft" style={{ top: (h - lo) * px }} />
            ))}
            {d.blocks.map((b) => {
              const s = Math.max(b.start, lo);
              const e = Math.min(b.end, hi);
              if (e <= s) return null;
              const top = (s - lo) * px;
              const h = Math.max((e - s) * px - 2, 3);
              const color = CATEGORIES[b.category]?.color ?? "#888";
              const mark = marks?.[d.date]?.[b.key];
              const sleep = b.source === "sleep";
              const selected = selectedKey === `${d.date}|${b.key}`;
              const tip = [
                `${b.title}  ${fmt(b.start)}–${fmt(b.end)}`,
                b.core ? "★ non-negotiable" : "",
                b.goalId && goalTitles?.[b.goalId] ? `Goal: ${goalTitles[b.goalId]}` : "",
                b.note ?? "",
                b.ifThen ? `If-then: ${b.ifThen}` : "",
              ]
                .filter(Boolean)
                .join("\n");
              const roomy = h > (compact ? 24 : 34);
              const style = sleep
                ? {
                    background: "repeating-linear-gradient(135deg, color-mix(in oklab, var(--text) 7%, transparent) 0 5px, transparent 5px 10px)",
                    borderLeft: "3px solid color-mix(in oklab, var(--muted) 45%, transparent)",
                  }
                : tint(color, b.overlay ? 34 : 20);
              return (
                <button
                  type="button"
                  key={b.key + b.start}
                  title={tip}
                  onClick={onSelect ? () => onSelect(d, b) : undefined}
                  className={cx(
                    "absolute overflow-hidden rounded-[6px] text-left leading-tight transition hover:z-20 hover:brightness-110",
                    b.overlay && "z-10 shadow-sm ring-1 ring-canvas",
                    selected && "z-20 ring-2 ring-accent",
                    onSelect ? "cursor-pointer" : "cursor-default",
                  )}
                  style={{
                    top,
                    height: h,
                    left: b.overlay ? "50%" : 2,
                    right: 2,
                    opacity: mark?.status === "skip" ? 0.45 : 1,
                    padding: h > 14 ? (compact ? "1px 5px" : "3px 7px") : "0 5px",
                    ...style,
                  }}
                >
                  {h >= 11 && (
                    <span className={cx("block font-semibold", h > (compact ? 40 : 58) ? "line-clamp-2" : "truncate", sleep ? "text-muted" : "text-ink", compact ? "text-[10.5px]" : "text-[12px]")}>
                      {b.core && !sleep ? "★ " : ""}
                      {b.title}
                    </span>
                  )}
                  {roomy && <span className={cx("lh-mono block truncate text-muted", compact ? "text-[9.5px]" : "text-[10.5px]")}>{fmt(b.start)}–{fmt(b.end)}</span>}
                  {mark && <span className="lh-mono absolute right-1 top-0.5 rounded bg-canvas/80 px-1 text-[10px] font-bold text-ink">{MARK_ICON[mark.status]}</span>}
                </button>
              );
            })}
            {d.date === today && nowMin != null && nowMin >= lo && nowMin <= hi && (
              <div className="pointer-events-none absolute inset-x-0 z-30" style={{ top: (nowMin - lo) * px }}>
                <div className="h-[2px] bg-accent" />
                <div className="absolute -left-[4px] -top-[3px] h-2 w-2 rounded-full bg-accent" />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Legend({ days }: { days: DaySchedule[] }) {
  const used = new Set(days.flatMap((d) => d.blocks.map((b) => b.category)));
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
      {Object.entries(CATEGORIES)
        .filter(([k]) => used.has(k as never) && k !== "sleep")
        .map(([k, v]) => (
          <span key={k} className="lh-mono flex items-center gap-1.5 text-[11px] text-muted">
            <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: v.color }} />
            {v.label}
          </span>
        ))}
      <span className="lh-mono text-[11px] text-muted">★ non-negotiable</span>
    </div>
  );
}
