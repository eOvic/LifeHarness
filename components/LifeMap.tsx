"use client";
import type { Strand } from "@/src/core/profile";
import { DAYS, type Goal, type Horizon, type Profile, type TimeRule } from "@/src/core/types";

const HORIZON_STYLE: Record<Horizon, string> = {
  life: "bg-slate-800 text-white",
  year: "bg-accent text-white",
  quarter: "bg-violet-200 text-violet-900",
  month: "bg-sky-100 text-sky-900",
  week: "bg-emerald-100 text-emerald-900",
};
const HORIZON_ORDER: Horizon[] = ["life", "year", "quarter", "month", "week"];

export function ruleText(r?: TimeRule): string {
  if (r == null) return "—";
  if (typeof r === "string") return r;
  const sign = r.offsetMin >= 0 ? "+" : "−";
  return `${r.anchor[0].toUpperCase()}${r.anchor.slice(1)} ${sign}${Math.abs(r.offsetMin)} min`;
}

export function GoalTree({ goals, compact = false }: { goals: Goal[]; compact?: boolean }) {
  const active = goals.filter((g) => (g.status ?? "active") !== "dropped");
  const ids = new Set(active.map((g) => g.id));
  const children = (id: string) => active.filter((g) => g.parentId === id).sort((a, b) => HORIZON_ORDER.indexOf(a.horizon) - HORIZON_ORDER.indexOf(b.horizon));
  const roots = active.filter((g) => !g.parentId || !ids.has(g.parentId)).sort((a, b) => HORIZON_ORDER.indexOf(a.horizon) - HORIZON_ORDER.indexOf(b.horizon));
  if (!active.length) return <p className="text-sm text-muted">No goals yet.</p>;
  const node = (g: Goal, depth: number): React.ReactNode => (
    <li key={g.id} className={depth ? "mt-1.5 border-l-2 border-line pl-3" : "mt-2.5"}>
      <div className="flex items-start gap-2">
        <span className={`mt-0.5 shrink-0 rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide ${HORIZON_STYLE[g.horizon]}`}>{g.horizon}</span>
        <div className="min-w-0">
          <div className={`font-medium leading-snug ${compact ? "text-[13px]" : "text-sm"} ${g.status === "done" ? "text-muted line-through" : ""}`}>{g.title}</div>
          {(g.measure || g.deadline) && (
            <div className="text-xs text-muted">
              {g.measure}
              {g.measure && g.deadline ? " · " : ""}
              {g.deadline && <span>by {g.deadline}</span>}
            </div>
          )}
          {!compact && g.why && <div className="text-xs italic text-muted">why: {g.why}</div>}
          {g.confidence != null && (
            <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted">
              <div className="h-1 w-16 overflow-hidden rounded bg-gray-200">
                <div className="h-full rounded" style={{ width: `${g.confidence}%`, background: g.confidence < 60 ? "#e8a33a" : "#3fae6a" }} />
              </div>
              {g.confidence}% sure
            </div>
          )}
        </div>
      </div>
      {children(g.id).length > 0 && <ul>{children(g.id).map((c) => node(c, depth + 1))}</ul>}
    </li>
  );
  return <ul className="-mt-1">{roots.map((g) => node(g, 0))}</ul>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line py-3 first:border-t-0 first:pt-0">
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</h3>
      {children}
    </section>
  );
}

function List({ items }: { items?: string[] }) {
  if (!items?.length) return <p className="text-sm text-muted">—</p>;
  return (
    <ul className="space-y-1 text-sm">
      {items.map((s, i) => (
        <li key={i} className="leading-snug">
          • {s}
        </li>
      ))}
    </ul>
  );
}

export function Coverage({ strands }: { strands: Strand[] }) {
  const done = strands.filter((s) => s.done).length;
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded bg-gray-200">
          <div className="h-full rounded bg-accent transition-all" style={{ width: `${(done / strands.length) * 100}%` }} />
        </div>
        <span className="text-xs text-muted">
          {done}/{strands.length}
        </span>
      </div>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
        {strands.map((s) => (
          <li key={s.id} className={`flex items-center gap-1.5 text-xs ${s.done ? "text-ink" : "text-muted"}`} title={s.done ? "" : s.hint}>
            <span className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full text-[9px] ${s.done ? "bg-emerald-500 text-white" : "border border-gray-300"}`}>{s.done ? "✓" : ""}</span>
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
  return (
    <div className="text-sm">
      {strands && (
        <Section title="What we know so far">
          <Coverage strands={strands} />
        </Section>
      )}
      {empty && <p className="py-2 text-sm text-muted">Your life map fills in as you answer.</p>}
      {(p.about || p.values?.length || p.vision) && (
        <Section title="Direction">
          {p.about && <p className="mb-1.5 leading-snug">{p.about}</p>}
          {!!p.values?.length && (
            <div className="mb-1.5 flex flex-wrap gap-1.5">
              {p.values.map((v) => (
                <span key={v.name} title={v.why} className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent">
                  {v.name}
                </span>
              ))}
            </div>
          )}
          {p.vision && <blockquote className="border-l-2 border-accent/40 pl-2.5 text-[13px] italic leading-snug text-ink/80">{p.vision}</blockquote>}
        </Section>
      )}
      {!!p.goals?.length && (
        <Section title="Goals">
          <GoalTree goals={p.goals} compact={compact} />
        </Section>
      )}
      {(p.sleep || p.fixed?.length || p.faith || p.weekStart) && (
        <Section title="Anchors">
          <dl className="grid grid-cols-[88px_1fr] gap-x-2 gap-y-1 text-[13px]">
            {p.sleep && (
              <>
                <dt className="text-muted">Sleep</dt>
                <dd>
                  bed {ruleText(p.sleep.bed)} · {p.sleep.wake != null ? `wake ${ruleText(p.sleep.wake)}` : `${p.sleep.hours} h`}
                  {p.sleep.override && <span className="text-muted"> (other times on {p.sleep.override.days.join(", ")})</span>}
                </dd>
              </>
            )}
            {p.weekStart && (
              <>
                <dt className="text-muted">Week starts</dt>
                <dd className="capitalize">{p.weekStart}</dd>
              </>
            )}
            {p.faith && (
              <>
                <dt className="text-muted">Prayer times</dt>
                <dd>
                  {p.faith.enabled ? (
                    <>
                      on · {p.faith.prayers?.method ?? "MuslimWorldLeague"}
                      {p.location?.city && ` · ${p.location.city}`}
                      {p.location?.lat == null && <span className="text-amber-600"> (location needed)</span>}
                    </>
                  ) : (
                    "off"
                  )}
                </dd>
              </>
            )}
            {p.fixed?.map((f) => (
              <span key={f.id} className="contents">
                <dt className="truncate text-muted">{f.title}</dt>
                <dd>
                  {[...f.days].sort((a, b) => DAYS.indexOf(a) - DAYS.indexOf(b)).join(" ")} · {f.start}–{f.end}
                  {f.travelMin ? <span className="text-muted"> (+{f.travelMin} min travel)</span> : null}
                </dd>
              </span>
            ))}
          </dl>
        </Section>
      )}
      {p.energy && (
        <Section title="Energy">
          <p className="text-[13px]">
            {p.energy.peak && (
              <>
                Peak <b>{p.energy.peak.start}–{p.energy.peak.end}</b>
              </>
            )}
            {p.energy.chronotype && <> · {p.energy.chronotype} type</>}
            {p.energy.focusMaxMin && <> · focus up to {p.energy.focusMaxMin} min</>}
            {p.energy.low && (
              <>
                {" "}
                · slump {p.energy.low.start}–{p.energy.low.end}
              </>
            )}
          </p>
          {p.energy.notes && <p className={`text-xs text-muted ${compact ? "line-clamp-2" : ""}`}>{p.energy.notes}</p>}
        </Section>
      )}
      {(!!p.history?.length || !!p.obstacles?.length) && (
        <Section title="Track record & obstacles">
          <List items={[...(p.history ?? []), ...(p.obstacles ?? []).map((o) => `⚠ ${o}`)]} />
          {p.capacity?.notes && <p className="mt-1 text-xs text-muted">Capacity: {p.capacity.notes}</p>}
        </Section>
      )}
      {!compact && !!p.habits?.running?.length && (
        <Section title="Habits that already run">
          <List items={p.habits.running} />
        </Section>
      )}
      {!compact && !!p.preferences?.length && (
        <Section title="Preferences">
          <List items={p.preferences} />
        </Section>
      )}
      {!!p.ifThen?.length && (
        <Section title="If-then plans">
          <ul className="space-y-1.5 text-[13px]">
            {p.ifThen.map((it) => (
              <li key={it.id} className="rounded-md bg-gray-50 px-2 py-1 leading-snug">
                <span className="text-muted">If</span> {it.if}, <span className="text-muted">then</span> {it.then}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {!!p.lessons?.length && (
        <Section title="Lessons about how you work">
          <ul className="space-y-1.5 text-[13px]">
            {p.lessons.map((l) => (
              <li key={l.id} className="leading-snug">
                {l.text} {l.evidence && <span className="text-xs text-muted">({l.evidence})</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
