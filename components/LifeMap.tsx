"use client";
import type { Strand } from "@/src/core/profile";
import { DAYS, type Goal, type Horizon, type Profile, type TimeRule } from "@/src/core/types";
import { cx, Label } from "./ui";

const HORIZON_STYLE: Record<Horizon, string> = {
  life: "border-ink/60 text-ink",
  year: "border-accent bg-accent text-accent-ink",
  quarter: "border-accent/60 text-accent",
  month: "border-accent/60 text-accent",
  week: "border-line text-muted",
};
const ORDER: Horizon[] = ["life", "year", "quarter", "month", "week"];

export function ruleText(r?: TimeRule): string {
  if (r == null) return "—";
  if (typeof r === "string") return r;
  const sign = r.offsetMin >= 0 ? "+" : "−";
  return `${r.anchor[0].toUpperCase()}${r.anchor.slice(1)} ${sign}${Math.abs(r.offsetMin)}m`;
}

export function GoalTree({ goals, compact = false }: { goals: Goal[]; compact?: boolean }) {
  const active = goals.filter((g) => (g.status ?? "active") !== "dropped");
  const ids = new Set(active.map((g) => g.id));
  const parked = (g: Goal) => g.status === "paused";
  const byHorizon = (a: Goal, b: Goal) => Number(parked(a)) - Number(parked(b)) || ORDER.indexOf(a.horizon) - ORDER.indexOf(b.horizon);
  const children = (id: string) => active.filter((g) => g.parentId === id).sort(byHorizon);
  const roots = active.filter((g) => !g.parentId || !ids.has(g.parentId)).sort(byHorizon);
  if (!active.length) return <p className="text-sm text-muted">No goals yet.</p>;
  const node = (g: Goal, depth: number): React.ReactNode => (
    <li key={g.id} className={depth ? "mt-2 border-l border-line pl-3.5" : "mt-3 first:mt-0"}>
      <div className="flex items-start gap-2.5">
        <span className={cx("lh-mono mt-[3px] shrink-0 rounded-[5px] border px-1.5 text-[10px] uppercase leading-[16px] tracking-[0.06em]", parked(g) ? "border-line text-muted" : HORIZON_STYLE[g.horizon])}>{g.horizon}</span>
        <div className="min-w-0">
          <div className={cx("leading-snug", parked(g) ? "text-muted" : "text-ink", compact ? "text-[14px]" : "text-[15px]", g.status === "done" && "text-muted line-through")}>
            {g.title}
            {parked(g) && <span className="lh-mono ml-2 rounded border border-line px-1 align-middle text-[9.5px] uppercase tracking-[0.06em] text-muted">parked</span>}
          </div>
          {(g.measure || g.deadline) && (
            <div className="mt-0.5 text-sm leading-snug text-muted">
              {g.measure}
              {g.measure && g.deadline ? " · " : ""}
              {g.deadline && <span className="lh-mono text-[11px]">by {g.deadline}</span>}
            </div>
          )}
          {!compact && g.why && <div className="mt-0.5 text-sm italic text-muted">“{g.why}”</div>}
          {g.confidence != null && (
            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-1 w-20 overflow-hidden rounded-full bg-hover">
                <div className="h-full rounded-full" style={{ width: `${g.confidence}%`, background: g.confidence < 60 ? "var(--warning)" : "var(--accent)" }} />
              </div>
              <span className="lh-mono text-[10.5px] text-muted">{g.confidence}% sure</span>
            </div>
          )}
        </div>
      </div>
      {children(g.id).length > 0 && <ul>{children(g.id).map((c) => node(c, depth + 1))}</ul>}
    </li>
  );
  return <ul>{roots.map((g) => node(g, 0))}</ul>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line py-4 first:border-t-0 first:pt-0">
      <Label className="mb-2.5 block">{title}</Label>
      {children}
    </section>
  );
}

function Bullets({ items, warn = [] }: { items?: string[]; warn?: string[] }) {
  if (!items?.length && !warn.length) return <p className="text-sm text-muted">—</p>;
  return (
    <ul className="space-y-1.5 text-[14px] leading-snug">
      {items?.map((s, i) => (
        <li key={`i${i}`} className="flex gap-2">
          <span className="text-muted">·</span>
          {s}
        </li>
      ))}
      {warn.map((s, i) => (
        <li key={`w${i}`} className="flex gap-2">
          <span className="text-warn">!</span>
          {s}
        </li>
      ))}
    </ul>
  );
}

export function Coverage({ strands }: { strands: Strand[] }) {
  const done = strands.filter((s) => s.done).length;
  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-hover">
          <div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${(done / strands.length) * 100}%` }} />
        </div>
        <span className="lh-mono text-[11px] text-muted">
          {done}/{strands.length}
        </span>
      </div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        {strands.map((s) => (
          <li key={s.id} className={cx("flex items-start gap-2 text-[13px] leading-snug", s.done ? "text-ink" : "text-muted")} title={s.done ? "" : s.hint}>
            <span
              className={cx(
                "mt-[2px] grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full text-[9px] font-bold",
                s.done ? "bg-accent text-accent-ink" : s.critical ? "border border-warn/70" : "border border-line",
              )}
            >
              {s.done ? "✓" : ""}
            </span>
            {s.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function LifeMap({ profile, strands, compact = false }: { profile: Profile; strands?: Strand[]; compact?: boolean }) {
  const p = profile;
  const empty = !p.values?.length && !p.goals?.length && !p.fixed?.length && !p.sleep;
  const dl = "grid grid-cols-[92px_1fr] gap-x-3 gap-y-1.5 text-[14px] leading-snug";
  return (
    <div>
      {strands && (
        <Section title="What we know so far">
          <Coverage strands={strands} />
        </Section>
      )}
      {empty && <p className="py-2 text-[14px] text-muted">Your life map fills in as you answer.</p>}
      {(p.about || p.values?.length || p.vision) && (
        <Section title="Direction">
          {p.about && <p className="mb-2.5 text-[15px] leading-snug text-ink">{p.about}</p>}
          {!!p.values?.length && (
            <div className="mb-2.5 flex flex-wrap gap-1.5">
              {p.values.map((v) => (
                <span key={v.name} title={v.why} className="rounded-full border border-line px-2.5 py-0.5 text-[13px] text-ink">
                  {v.name}
                </span>
              ))}
            </div>
          )}
          {p.vision && <blockquote className="lh-title border-l-2 border-accent/60 pl-3 text-[15px] font-normal italic leading-snug text-ink/90">{p.vision}</blockquote>}
        </Section>
      )}
      {!!p.goals?.length && (
        <Section title="Goals">
          <GoalTree goals={p.goals} compact={compact} />
        </Section>
      )}
      {(p.sleep || p.fixed?.length || p.faith || p.weekStart) && (
        <Section title="Anchors">
          <dl className={dl}>
            {p.sleep && (
              <>
                <dt className="lh-mono pt-0.5 text-[11px] uppercase tracking-[0.06em] text-muted">Sleep</dt>
                <dd>
                  bed {ruleText(p.sleep.bed)} · {p.sleep.wake != null ? `wake ${ruleText(p.sleep.wake)}` : `${p.sleep.hours} h`}
                  {p.sleep.override && <span className="text-muted"> · {p.sleep.override.days.join("/")} differ</span>}
                </dd>
              </>
            )}
            {p.weekStart && (
              <>
                <dt className="lh-mono pt-0.5 text-[11px] uppercase tracking-[0.06em] text-muted">Week</dt>
                <dd>starts {p.weekStart[0].toUpperCase() + p.weekStart.slice(1)}</dd>
              </>
            )}
            {p.faith && (
              <>
                <dt className="lh-mono pt-0.5 text-[11px] uppercase tracking-[0.06em] text-muted">Prayer</dt>
                <dd>
                  {p.faith.enabled ? (
                    <>
                      on · {p.faith.prayers?.method ?? "MuslimWorldLeague"}
                      {p.location?.city && ` · ${p.location.city}`}
                      {p.location?.lat == null && <span className="text-warn"> · location needed</span>}
                    </>
                  ) : (
                    <span className="text-muted">off</span>
                  )}
                </dd>
              </>
            )}
            {p.fixed?.map((f) => (
              <span key={f.id} className="contents">
                <dt className="lh-mono truncate pt-0.5 text-[11px] uppercase tracking-[0.06em] text-muted" title={f.title}>
                  {f.title}
                </dt>
                <dd>
                  <span className="lh-mono text-[12px]">
                    {[...f.days].sort((a, b) => DAYS.indexOf(a) - DAYS.indexOf(b)).join(" ")} {f.start}–{f.end}
                  </span>
                  {f.travelMin ? <span className="text-muted"> · +{f.travelMin}m travel</span> : null}
                </dd>
              </span>
            ))}
          </dl>
        </Section>
      )}
      {p.energy && (p.energy.peak || p.energy.notes || p.energy.chronotype) && (
        <Section title="Energy">
          <p className="text-[14px]">
            {p.energy.peak && (
              <>
                Peak{" "}
                <span className="lh-mono text-[12.5px] text-accent">
                  {p.energy.peak.start}–{p.energy.peak.end}
                </span>
              </>
            )}
            {p.energy.chronotype && <span className="text-muted"> · {p.energy.chronotype} type</span>}
            {p.energy.focusMaxMin && <span className="text-muted"> · focus {p.energy.focusMaxMin}m</span>}
          </p>
          {p.energy.notes && <p className={cx("mt-1 text-sm text-muted", compact && "line-clamp-2")}>{p.energy.notes}</p>}
        </Section>
      )}
      {(!!p.history?.length || !!p.obstacles?.length) && (
        <Section title="Track record & obstacles">
          <Bullets items={p.history} warn={p.obstacles} />
          {p.capacity?.notes && <p className="mt-2 text-sm text-muted">Capacity: {p.capacity.notes}</p>}
        </Section>
      )}
      {!compact && !!p.habits?.running?.length && (
        <Section title="Habits that already run">
          <Bullets items={p.habits.running} />
        </Section>
      )}
      {!compact && !!p.preferences?.length && (
        <Section title="Preferences">
          <Bullets items={p.preferences} />
        </Section>
      )}
      {!!p.ifThen?.length && (
        <Section title="If-then plans">
          <ul className="space-y-2">
            {p.ifThen.map((it) => (
              <li key={it.id} className="rounded-lg border border-line px-3 py-2 text-[14px] leading-snug">
                <span className="lh-mono text-[11px] uppercase text-muted">if </span>
                {it.if}
                <span className="lh-mono text-[11px] uppercase text-muted"> → then </span>
                {it.then}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {!!p.lessons?.length && (
        <Section title="Lessons about how you work">
          <ul className="space-y-1.5 text-[14px] leading-snug">
            {p.lessons.map((l) => (
              <li key={l.id}>
                {l.text} {l.evidence && <span className="text-sm text-muted">({l.evidence})</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
