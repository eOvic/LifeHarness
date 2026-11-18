"use client";
import { fmt } from "@/src/core/time";
import { CATEGORIES, type DaySchedule, type Mark, type ScheduledBlock } from "@/src/core/types";

const MARK_ICON = { done: "✓", half: "½", skip: "✗" } as const;

interface Props {
  days: DaySchedule[];
  compact?: boolean;
  today?: string;
  nowMin?: number;
  marks?: Record<string, Record<string, Mark>>;
  goalTitles?: Record<string, string>;
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

export default function WeekGrid({ days, compact = false, today, nowMin, marks, goalTitles, onSelect }: Props) {
  const [lo, hi] = visibleRange(days);
  const px = compact ? 0.6 : 1.05;
  const height = (hi - lo) * px;
  const hours: number[] = [];
  for (let h = lo; h <= hi; h += 60) hours.push(h);

  return (
    <div className="w-full">
      <div className="flex">
        <div className="w-11 shrink-0" />
        {days.map((d) => {
          const isToday = d.date === today;
          const label = new Date(`${d.date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
          return (
            <div key={d.date} className={`flex-1 px-0.5 pb-1.5 text-center ${compact ? "text-[11px]" : "text-xs"}`}>
              <span className={`inline-block rounded-md px-2 py-0.5 font-semibold ${isToday ? "bg-accent text-white" : "text-ink"}`}>{label}</span>
            </div>
          );
        })}
      </div>
      <div className="flex">
        <div className="relative w-11 shrink-0" style={{ height }}>
          {hours.map((h) => (
            <div key={h} className="absolute right-1.5 -translate-y-2 text-[10px] text-muted" style={{ top: (h - lo) * px }}>
              {fmt(h)}
            </div>
          ))}
        </div>
        {days.map((d) => (
          <div key={d.date} className="relative flex-1 border-l border-line first:border-l-0" style={{ height }}>
            {hours.map((h) => (
              <div key={h} className="absolute inset-x-0 border-t border-line/70" style={{ top: (h - lo) * px }} />
            ))}
            {d.blocks.map((b) => {
              const s = Math.max(b.start, lo);
              const e = Math.min(b.end, hi);
              if (e <= s) return null;
              const top = (s - lo) * px;
              const h = Math.max((e - s) * px - 1.5, 3);
              const color = CATEGORIES[b.category]?.color ?? "#999";
              const mark = marks?.[d.date]?.[b.key];
              const sleep = b.source === "sleep";
              const tip = [
                `${b.title} ${fmt(b.start)}–${fmt(b.end)}`,
                b.core ? "★ non-negotiable" : "",
                b.goalId && goalTitles?.[b.goalId] ? `Goal: ${goalTitles[b.goalId]}` : "",
                b.note ?? "",
                b.ifThen ? `If-then: ${b.ifThen}` : "",
              ]
                .filter(Boolean)
                .join("\n");
              const showTime = h > (compact ? 26 : 32);
              return (
                <button
                  type="button"
                  key={b.key + b.start}
                  title={tip}
                  onClick={onSelect ? () => onSelect(d, b) : undefined}
                  className={`absolute overflow-hidden rounded-[5px] text-left leading-tight text-white transition hover:z-20 hover:brightness-110 ${
                    b.overlay ? "z-10 border border-white/80 shadow-sm" : ""
                  } ${onSelect ? "cursor-pointer" : "cursor-default"}`}
                  style={{
                    top,
                    height: h,
                    left: b.overlay ? "52%" : 2,
                    right: 2,
                    background: sleep ? "repeating-linear-gradient(135deg,#3b4252 0 6px,#434c5e 6px 12px)" : color,
                    opacity: mark?.status === "skip" ? 0.45 : 1,
                    padding: h > 14 ? (compact ? "1px 4px" : "2px 6px") : "0 4px",
                  }}
                >
                  {h >= 11 && (
                    <span className={`block truncate font-semibold ${compact ? "text-[10px]" : "text-[11px]"}`}>
                      {b.core && !sleep ? "★ " : ""}
                      {b.title}
                    </span>
                  )}
                  {showTime && <span className={`block truncate opacity-85 ${compact ? "text-[9.5px]" : "text-[10px]"}`}>{fmt(b.start)}–{fmt(b.end)}</span>}
                  {mark && (
                    <span className="absolute right-1 top-0.5 rounded bg-white/90 px-1 text-[10px] font-bold text-ink">{MARK_ICON[mark.status]}</span>
                  )}
                </button>
              );
            })}
            {d.date === today && nowMin != null && nowMin >= lo && nowMin <= hi && (
              <div className="pointer-events-none absolute inset-x-0 z-20" style={{ top: (nowMin - lo) * px }}>
                <div className="h-[2px] bg-red-500" />
                <div className="absolute -left-1 -top-[3px] h-2 w-2 rounded-full bg-red-500" />
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
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {Object.entries(CATEGORIES)
        .filter(([k]) => used.has(k as never))
        .map(([k, v]) => (
          <span key={k} className="flex items-center gap-1.5">
            <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: v.color }} />
            {v.label}
          </span>
        ))}
      <span className="flex items-center gap-1.5">★ non-negotiable</span>
    </div>
  );
}
