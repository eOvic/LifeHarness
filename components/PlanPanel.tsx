"use client";
import { Check } from "lucide-react";
import { fmtDuration } from "@/src/core/time";
import type { Proposal } from "@/src/server/store";
import { GoalTree } from "./LifeMap";
import Markdown from "./Markdown";
import { Button, cx, Label } from "./ui";
import WeekGrid, { Legend } from "./WeekGrid";

export default function PlanPanel({ proposal, busy, onAdopt }: { proposal: Proposal; busy: boolean; onAdopt: () => void }) {
  const w = proposal.preview;
  const goalTitles = Object.fromEntries(proposal.goals.map((g) => [g.id, g.title]));
  const core = new Set(proposal.blocks.filter((b) => b.core).map((b) => b.id));
  const coreMissing = w.unplaced.filter((u) => core.has(u.blockId));
  const notPlaced = w.unplaced.reduce((s, u) => s + u.wanted - u.placed, 0);
  const adopted = proposal.adoptedVersion;
  const maxGoal = Math.max(60, ...Object.values(w.stats.byGoal));
  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Label>{adopted ? `Plan v${adopted}` : "Proposed plan"}</Label>
          <p className="mt-0.5 text-sm text-muted">Placed by the scheduler around your anchors</p>
        </div>
        {adopted ? (
          <span className="lh-mono inline-flex h-8 items-center gap-1.5 rounded-lg border border-ok/40 px-3 text-[11px] uppercase tracking-[0.06em] text-ok">
            <Check className="h-3.5 w-3.5" /> Adopted
          </span>
        ) : (
          <Button variant="accent" disabled={busy || coreMissing.length > 0} onClick={onAdopt} title={coreMissing.length ? "Some non-negotiable blocks don't fit yet" : ""}>
            Adopt this plan
          </Button>
        )}
      </div>

      <div className="grid grid-cols-3 divide-x divide-line rounded-xl border border-line">
        <Stat label="free time" value={`${w.stats.freePct}%`} warn={w.stats.freePct < 15} />
        <Stat label="blocks" value={String(proposal.blocks.length)} />
        <Stat label="not placed" value={String(notPlaced)} warn={notPlaced > 0} />
      </div>

      {w.unplaced.length > 0 && (
        <div className="rounded-xl border border-warn/40 px-3.5 py-2.5 text-sm text-ink">
          {w.unplaced.map((u) => (
            <div key={u.blockId}>
              <span className="text-warn">!</span> <b>{u.title}</b> {u.placed}/{u.wanted} placed. <span className="text-muted">{u.reasons[0]}</span>
            </div>
          ))}
        </div>
      )}

      {proposal.approach && <Markdown small>{proposal.approach}</Markdown>}

      <div>
        <Label className="mb-2 block">Hours per goal · week</Label>
        <div className="space-y-2">
          {Object.entries(w.stats.byGoal)
            .sort((a, b) => b[1] - a[1])
            .map(([g, m]) => (
              <div key={g} className="flex items-center gap-3 text-[13px]">
                <span className="w-40 truncate text-ink">{goalTitles[g] ?? g}</span>
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-hover">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${(m / maxGoal) * 100}%` }} />
                </div>
                <span className="lh-mono w-14 text-right text-[11px] text-muted">{fmtDuration(m)}</span>
              </div>
            ))}
        </div>
      </div>

      <div>
        <Label className="mb-2.5 block">Goal tree</Label>
        <GoalTree goals={proposal.goals} compact />
      </div>

      <div>
        <Label className="mb-3 block">The week</Label>
        <WeekGrid days={w.days} compact goalTitles={goalTitles} />
        <div className="mt-3">
          <Legend days={w.days} />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="px-3 py-2.5 text-center">
      <div className={cx("lh-title text-xl", warn && "text-warn")}>{value}</div>
      <div className="lh-label mt-0.5 text-[10px]">{label}</div>
    </div>
  );
}
