"use client";
import { fmtDuration } from "@/src/core/time";
import type { Proposal } from "@/src/server/store";
import { GoalTree } from "./LifeMap";
import Markdown from "./Markdown";
import WeekGrid, { Legend } from "./WeekGrid";

export default function PlanPanel({ proposal, busy, onAdopt }: { proposal: Proposal; busy: boolean; onAdopt: () => void }) {
  const w = proposal.preview;
  const goalTitles = Object.fromEntries(proposal.goals.map((g) => [g.id, g.title]));
  const coreIds = new Set(proposal.blocks.filter((b) => b.core).map((b) => b.id));
  const coreMissing = w.unplaced.filter((u) => coreIds.has(u.blockId));
  const adopted = proposal.adoptedVersion;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{adopted ? `Plan v${adopted}` : "Proposed plan"}</h2>
          <p className="text-xs text-muted">Week of {w.start} · placed by the scheduler around your anchors</p>
        </div>
        {adopted ? (
          <span className="rounded-lg bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700">✓ Adopted</span>
        ) : (
          <button
            type="button"
            disabled={busy || coreMissing.length > 0}
            onClick={onAdopt}
            title={coreMissing.length ? "Some non-negotiable blocks don't fit yet" : ""}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 disabled:opacity-40"
          >
            Adopt this plan
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="free time" value={`${w.stats.freePct}%`} warn={w.stats.freePct < 15} />
        <Stat label="blocks" value={String(proposal.blocks.length)} />
        <Stat label="not placed" value={String(w.unplaced.reduce((s, u) => s + u.wanted - u.placed, 0))} warn={w.unplaced.length > 0} />
      </div>

      {w.unplaced.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {w.unplaced.map((u) => (
            <div key={u.blockId}>
              <b>{u.title}</b>: {u.placed}/{u.wanted} placed. {u.reasons[0]}
            </div>
          ))}
        </div>
      )}

      {proposal.approach && (
        <div className="rounded-lg bg-gray-50 px-3 py-2">
          <Markdown className="text-[13px]">{proposal.approach}</Markdown>
        </div>
      )}

      <div>
        <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Hours per goal / week</h3>
        <div className="space-y-1">
          {Object.entries(w.stats.byGoal)
            .sort((a, b) => b[1] - a[1])
            .map(([g, m]) => (
              <div key={g} className="flex items-center gap-2 text-xs">
                <span className="w-40 truncate">{goalTitles[g] ?? g}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded bg-gray-100">
                  <div className="h-full rounded bg-accent/70" style={{ width: `${Math.min(100, (m / 600) * 100)}%` }} />
                </div>
                <span className="w-14 text-right text-muted">{fmtDuration(m)}</span>
              </div>
            ))}
        </div>
      </div>

      <div>
        <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Goal tree</h3>
        <GoalTree goals={proposal.goals} compact />
      </div>

      <div>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">The week</h3>
        <WeekGrid days={w.days} compact goalTitles={goalTitles} />
        <div className="mt-2">
          <Legend days={w.days} />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`rounded-lg border px-2 py-1.5 ${warn ? "border-amber-200 bg-amber-50" : "border-line bg-white"}`}>
      <div className="text-base font-semibold">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
    </div>
  );
}
