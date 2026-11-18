"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { getJson, postJson } from "@/lib/api";
import { addDays } from "@/src/core/time";
import type { WeekReport } from "@/src/core/report";
import { CATEGORIES } from "@/src/core/types";

type Chat = { id: string; kind: string; title: string; updatedAt: string };

export default function Review() {
  const router = useRouter();
  const [r, setR] = useState<WeekReport | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback((start?: string) => {
    getJson<WeekReport>(`/api/report${start ? `?start=${start}` : ""}`).then(setR).catch((e) => setErr(e.message));
  }, []);
  useEffect(() => {
    load();
    getJson<Chat[]>("/api/chats").then((c) => setChats(c.filter((x) => x.kind === "review"))).catch(() => {});
  }, [load]);

  const startReview = async () => {
    setBusy(true);
    try {
      const c = await postJson<{ id: string }>("/api/chats", { kind: "review" });
      router.push(`/session/${c.id}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  if (!r) return <div className="p-10 text-center text-muted">{err ?? "Loading…"}</div>;
  const empty = r.marked === 0 && r.unmarked === 0;

  return (
    <div className="mx-auto max-w-4xl px-5 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Weekly review</h1>
          <p className="text-sm text-muted">
            {r.start} → {r.end} · score = done 1, half ½, skipped 0, over marked blocks
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => load(addDays(r.start, -7))} className="rounded-lg border border-line bg-white px-3 py-1.5 text-sm hover:bg-gray-50">
            ←
          </button>
          <button type="button" onClick={() => load(addDays(r.start, 7))} className="rounded-lg border border-line bg-white px-3 py-1.5 text-sm hover:bg-gray-50">
            →
          </button>
          <button type="button" onClick={startReview} disabled={busy} className="ml-2 rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white hover:brightness-110 disabled:opacity-40">
            {busy ? "Starting…" : "Review this week with the coach →"}
          </button>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card label="Week score" value={r.score != null ? `${r.score}%` : "—"} />
        <Card label="Core (non-negotiable)" value={r.coreScore != null ? `${r.coreScore}%` : "—"} />
        <Card label="Marked" value={String(r.marked)} />
        <Card label="Unmarked" value={String(r.unmarked)} warn={r.unmarked > r.marked} />
      </div>

      {empty ? (
        <p className="mt-8 rounded-xl border border-dashed border-line bg-white p-6 text-center text-sm text-muted">
          Nothing tracked this week yet. Mark blocks on <Link href="/today" className="text-accent underline">Today</Link>: the review learns from those marks.
        </p>
      ) : (
        <>
          <div className="mt-6 rounded-2xl border border-line bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold">By day</h2>
            <div className="flex items-end gap-2">
              {r.days.map((d) => (
                <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
                  <div className="text-xs font-semibold">{d.score != null ? `${d.score}%` : "—"}</div>
                  <div className="flex h-24 w-full items-end overflow-hidden rounded-md bg-gray-50">
                    <div className="w-full rounded-md bg-accent/75" style={{ height: `${d.score ?? 0}%` }} />
                  </div>
                  <div className="text-[11px] text-muted">{new Date(`${d.date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" })}</div>
                  {d.unmarked > 0 && <div className="text-[10px] text-amber-600">{d.unmarked} unmarked</div>}
                </div>
              ))}
            </div>
          </div>

          {r.weakest && r.weakestReason === "score" && (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm">
              <b>Weakest block: {r.weakest.title}</b> ({r.weakest.score ?? "—"}%). The review will run WOOP on it: what is it for, what actually got in the way, and one if-then plan, or a
              redesign if the time or length is wrong.
            </div>
          )}
          {r.weakest && r.weakestReason === "unmarked" && (
            <div className="mt-4 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm">
              Everything you marked held. <b>{r.weakest.title}</b> has the most unmarked sessions ({r.weakest.unmarked}): tracking is the habit to fix, so tie marking to your evening
              “Plan tomorrow” block.
            </div>
          )}

          <div className="mt-4 overflow-hidden rounded-2xl border border-line bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2">Block</th>
                  <th className="px-2 py-2 text-center">✓</th>
                  <th className="px-2 py-2 text-center">½</th>
                  <th className="px-2 py-2 text-center">✗</th>
                  <th className="px-2 py-2 text-center">unmarked</th>
                  <th className="px-4 py-2 text-right">score</th>
                </tr>
              </thead>
              <tbody>
                {r.blocks.map((b) => (
                  <tr key={b.title} className="border-t border-line">
                    <td className="px-4 py-2">
                      <span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: CATEGORIES[b.category]?.color }} />
                      {b.core && "★ "}
                      {b.title}
                    </td>
                    <td className="px-2 py-2 text-center">{b.done}</td>
                    <td className="px-2 py-2 text-center">{b.half}</td>
                    <td className="px-2 py-2 text-center">{b.skip}</td>
                    <td className="px-2 py-2 text-center text-muted">{b.unmarked}</td>
                    <td className="px-4 py-2 text-right font-semibold">{b.score != null ? `${b.score}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {r.streaks.length > 0 && (
            <div className="mt-4 rounded-2xl border border-line bg-white p-4 text-sm">
              <h2 className="mb-2 font-semibold">Core streaks</h2>
              <div className="flex flex-wrap gap-2">
                {r.streaks.map((s) => (
                  <span key={s.title} className="rounded-full bg-gray-100 px-3 py-1 text-xs">
                    {s.title}: <b>{s.days}</b> day{s.days === 1 ? "" : "s"}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {chats.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-2 text-sm font-semibold">Past reviews</h2>
          <ul className="space-y-1 text-sm">
            {chats.map((c) => (
              <li key={c.id}>
                <Link href={`/session/${c.id}`} className="text-accent hover:underline">
                  {c.title} · {new Date(c.updatedAt).toLocaleDateString()}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {err && <p className="mt-4 text-sm text-red-600">{err}</p>}
    </div>
  );
}

function Card({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`rounded-2xl border px-4 py-3 ${warn ? "border-amber-200 bg-amber-50" : "border-line bg-white"}`}>
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}
