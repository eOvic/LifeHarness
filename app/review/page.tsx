"use client";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { refreshSidebar } from "@/components/Shell";
import { Button, cx, IconButton, Label, Spinner } from "@/components/ui";
import { getJson, postJson } from "@/lib/api";
import type { WeekReport } from "@/src/core/report";
import { addDays } from "@/src/core/time";
import { CATEGORIES } from "@/src/core/types";

export default function Review() {
  const router = useRouter();
  const [r, setR] = useState<WeekReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback((start?: string) => {
    getJson<WeekReport>(`/api/report${start ? `?start=${start}` : ""}`).then(setR).catch((e) => setErr(e.message));
  }, []);
  useEffect(() => load(), [load]);

  const startReview = async () => {
    setBusy(true);
    try {
      const c = await postJson<{ id: string }>("/api/chats", { kind: "review" });
      refreshSidebar();
      router.push(`/session/${c.id}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  if (!r) {
    return (
      <>
        <PageHeader title="Weekly review" />
        <div className="grid flex-1 place-items-center text-muted">{err ?? <Spinner />}</div>
      </>
    );
  }
  const empty = r.marked === 0 && r.unmarked === 0;
  return (
    <>
      <PageHeader
        title="Weekly review"
        meta={`${r.start} → ${r.end}`}
        right={
          <>
            <IconButton onClick={() => load(addDays(r.start, -7))} title="Previous week">
              <ChevronLeft />
            </IconButton>
            <IconButton onClick={() => load(addDays(r.start, 7))} title="Next week">
              <ChevronRight />
            </IconButton>
            <Button variant="accent" size="sm" disabled={busy} onClick={startReview} className="ml-1">
              {busy ? "Starting…" : "Review with the coach →"}
            </Button>
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[920px] px-6 pb-12 pt-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="Week score" value={r.score != null ? `${r.score}%` : "—"} />
            <Tile label="Core ★" value={r.coreScore != null ? `${r.coreScore}%` : "—"} />
            <Tile label="Marked" value={String(r.marked)} />
            <Tile label="Unmarked" value={String(r.unmarked)} warn={r.unmarked > r.marked} />
          </div>
          <p className="lh-mono mt-2 text-[11px] text-muted">score = done 1 · half ½ · skipped 0, over marked blocks only</p>

          {empty ? (
            <div className="mt-8 rounded-xl border border-dashed border-line px-6 py-10 text-center text-[15px] text-muted">
              Nothing tracked this week yet. Mark blocks on{" "}
              <Link href="/today" className="text-accent hover:underline">
                Today
              </Link>
              : the review learns from those marks.
            </div>
          ) : (
            <>
              <section className="mt-8">
                <Label>By day</Label>
                <div className="mt-3 flex items-end gap-2">
                  {r.days.map((d) => (
                    <div key={d.date} className="flex flex-1 flex-col items-center gap-1.5">
                      <div className="lh-mono text-[11px] text-ink">{d.score != null ? `${d.score}%` : "—"}</div>
                      <div className="flex h-28 w-full items-end overflow-hidden rounded-lg bg-panel">
                        <div className="w-full rounded-lg bg-accent/80 transition-all" style={{ height: `${d.score ?? 0}%` }} />
                      </div>
                      <div className="lh-label">{new Date(`${d.date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" })}</div>
                      {d.unmarked > 0 && <div className="lh-mono text-[10px] text-warn">{d.unmarked} open</div>}
                    </div>
                  ))}
                </div>
              </section>

              {r.weakest && r.weakestReason === "score" && (
                <div className="mt-6 rounded-xl border border-warn/40 px-5 py-4 text-[15px] leading-relaxed">
                  <Label className="text-warn">Weakest block</Label>
                  <div className="mt-1">
                    <b>{r.weakest.title}</b> at {r.weakest.score ?? "—"}%. The coach will run WOOP on it: what it&apos;s for, what actually got in the way, one if-then plan, or a
                    redesign if the time or length is wrong.
                  </div>
                </div>
              )}
              {r.weakest && r.weakestReason === "unmarked" && (
                <div className="mt-6 rounded-xl border border-line px-5 py-4 text-[15px] leading-relaxed">
                  <Label>Tracking</Label>
                  <div className="mt-1">
                    Everything you marked held. <b>{r.weakest.title}</b> has the most unmarked sessions ({r.weakest.unmarked}): tie marking to your evening “Plan tomorrow” block.
                  </div>
                </div>
              )}

              <section className="mt-8">
                <Label>By block</Label>
                <table className="mt-3 w-full text-[14px]">
                  <thead>
                    <tr className="lh-label border-b border-line text-left">
                      <th className="py-2 font-normal">Block</th>
                      <th className="w-12 py-2 text-center font-normal">✓</th>
                      <th className="w-12 py-2 text-center font-normal">½</th>
                      <th className="w-12 py-2 text-center font-normal">✗</th>
                      <th className="w-20 py-2 text-center font-normal">open</th>
                      <th className="w-16 py-2 text-right font-normal">score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.blocks.map((b) => (
                      <tr key={b.title} className="border-b border-line-soft">
                        <td className="py-2.5">
                          <span className="mr-2.5 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: CATEGORIES[b.category]?.color }} />
                          {b.core && <span className="mr-1 text-accent">★</span>}
                          {b.title}
                        </td>
                        <td className="lh-mono text-center text-[12.5px]">{b.done}</td>
                        <td className="lh-mono text-center text-[12.5px]">{b.half}</td>
                        <td className="lh-mono text-center text-[12.5px]">{b.skip}</td>
                        <td className="lh-mono text-center text-[12.5px] text-muted">{b.unmarked}</td>
                        <td className={cx("lh-mono text-right text-[12.5px]", (b.score ?? 100) < 60 ? "text-warn" : "text-ink")}>{b.score != null ? `${b.score}%` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              {r.streaks.some((s) => s.days > 0) && (
                <section className="mt-8">
                  <Label>Core streaks</Label>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {r.streaks
                      .filter((s) => s.days > 0)
                      .map((s) => (
                        <span key={s.title} className="rounded-full border border-line px-3 py-1 text-[13px]">
                          {s.title} <span className="lh-mono ml-1 text-[11px] text-accent">{s.days}d</span>
                        </span>
                      ))}
                  </div>
                </section>
              )}

              {(r.tasks ?? []).some((t) => t.due > 0) && (
                <section className="mt-8" data-lh="review-tasks">
                  <Label>Daily tasks</Label>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {r.tasks
                      .filter((t) => t.due > 0)
                      .map((t) => (
                        <span key={t.id} className="rounded-full border border-line px-3 py-1 text-[13px]">
                          {t.title}{" "}
                          <span className={cx("lh-mono ml-1 text-[11px]", t.done === t.due ? "text-ok" : t.done * 2 >= t.due ? "text-warn" : "text-danger")}>
                            {t.done}/{t.due} days
                          </span>
                        </span>
                      ))}
                  </div>
                </section>
              )}
            </>
          )}
          {err && <p className="mt-4 text-sm text-danger">{err}</p>}
        </div>
      </div>
    </>
  );
}

function Tile({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={cx("rounded-xl border px-4 py-3.5", warn ? "border-warn/40" : "border-line")}>
      <div className={cx("lh-title text-3xl", warn && "text-warn")}>{value}</div>
      <div className="lh-label mt-1">{label}</div>
    </div>
  );
}
