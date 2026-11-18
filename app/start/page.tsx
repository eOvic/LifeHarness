"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getJson, postJson } from "@/lib/api";

type State = { chats: { id: string; kind: string; title: string; phase: string; updatedAt: string }[]; plan: unknown };
type SettingsInfo = { current: string | null; error?: string };

const STEPS = [
  { t: "Interview", d: "About 15 questions, one at a time: what you want from life, this year, this month, this week, and how your days really run." },
  { t: "Plan", d: "A goal tree (year → month → week) and a time-blocked week, placed around your sleep, commitments and energy." },
  { t: "Live it", d: "Today shows where you are. Mark blocks ✓ ½ ✗ in seconds. Export to your phone's calendar." },
  { t: "Review", d: "Every week: what held, what didn't, why. The plan adapts to the evidence, not to guilt." },
];

export default function Start() {
  const router = useRouter();
  const [state, setState] = useState<State | null>(null);
  const [model, setModel] = useState<SettingsInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getJson<State>("/api/state").then(setState).catch((e) => setErr(e.message));
    getJson<SettingsInfo>("/api/settings").then(setModel).catch(() => {});
  }, []);

  const onboarding = state?.chats.find((c) => c.kind === "onboarding");
  const begin = async () => {
    setBusy(true);
    try {
      const c = await postJson<{ id: string }>("/api/chats", { kind: "onboarding" });
      router.push(`/session/${c.id}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-6 py-14">
      <p className="text-sm font-medium text-accent">An agent harness for self-development</p>
      <h1 className="mt-2 text-4xl font-semibold leading-tight tracking-tight">
        From what you want in life
        <br />
        to a week you can actually live.
      </h1>
      <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-muted">
        LifeHarness interviews you the way a good coach would. It measures where you are before planning anything, then builds the
        smallest plan that moves every goal you care about, and fits it around your real constraints. Every block traces back to a goal, and every goal gets time.
      </p>

      <ol className="mt-10 grid gap-4 sm:grid-cols-2">
        {STEPS.map((s, i) => (
          <li key={s.t} className="rounded-2xl border border-line bg-white p-4">
            <div className="flex items-center gap-2">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent">{i + 1}</span>
              <span className="font-semibold">{s.t}</span>
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{s.d}</p>
          </li>
        ))}
      </ol>

      <div className="mt-10 flex flex-wrap items-center gap-3">
        {onboarding ? (
          <>
            <Link href={`/session/${onboarding.id}`} className="rounded-xl bg-accent px-5 py-3 font-semibold text-white shadow-sm hover:brightness-110">
              Continue your interview →
            </Link>
            <button type="button" onClick={begin} disabled={busy} className="rounded-xl border border-line bg-white px-4 py-3 text-sm text-muted hover:text-ink">
              Start over
            </button>
          </>
        ) : (
          <button type="button" onClick={begin} disabled={busy || !model?.current} className="rounded-xl bg-accent px-5 py-3 font-semibold text-white shadow-sm hover:brightness-110 disabled:opacity-40">
            {busy ? "Starting…" : "Start the interview →"}
          </button>
        )}
        {model && (
          <span className="text-xs text-muted">
            {model.current ? <>Model: {model.current} · change in Settings</> : <span className="text-red-600">{model.error ?? "No model configured"}</span>}
          </span>
        )}
      </div>
      {err && <p className="mt-4 text-sm text-red-600">{err}</p>}
      <p className="mt-12 text-xs leading-relaxed text-muted">
        Local-first: your answers, plans and tracking are plain JSON files on this machine. Model requests go to the provider you configured.
        Methods are evidence-based (goal-setting theory, implementation intentions, WOOP, progress monitoring, time-blocking). See docs/METHODOLOGY.md.
      </p>
    </div>
  );
}
