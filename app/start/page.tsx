"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import LogoMark from "@/components/LogoMark";
import PageHeader from "@/components/PageHeader";
import Connections from "@/components/Connections";
import { refreshSidebar } from "@/components/Shell";
import { Button, Label } from "@/components/ui";
import { getJson, postJson } from "@/lib/api";
import type { ModelInfo } from "@/src/server/llm";
import type { ChatSummary } from "@/src/server/store";

type State = { chats: ChatSummary[]; plan: unknown };
type SettingsInfo = { current: ModelInfo | null; error?: string };

const STEPS = [
  { t: "Interview", d: "About 15 questions, one at a time: what you want from life, this year, this month, this week, and how your days really run." },
  { t: "Plan", d: "A goal tree from year to week, and a time-blocked week placed around your sleep, commitments and energy." },
  { t: "Live it", d: "Today shows where you are. Mark blocks ✓ ½ ✗ in a second. Export the week to your phone's calendar." },
  { t: "Review", d: "Every week: what held, what didn't, and why. The plan adapts to the evidence, not to guilt." },
];

export default function Start() {
  const router = useRouter();
  const [state, setState] = useState<State | null>(null);
  const [model, setModel] = useState<SettingsInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadModel = () => {
    getJson<SettingsInfo>("/api/settings").then(setModel).catch(() => {});
  };
  useEffect(() => {
    getJson<State>("/api/state").then(setState).catch((e) => setErr(e.message));
    loadModel();
  }, []);

  const onboarding = state?.chats.find((c) => c.kind === "onboarding" && c.proposal !== "adopted");
  const begin = async () => {
    setBusy(true);
    try {
      const c = await postJson<{ id: string }>("/api/chats", { kind: "onboarding" });
      refreshSidebar();
      router.push(`/session/${c.id}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Welcome" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[760px] px-8 pb-16 pt-16">
          <LogoMark className="h-12 w-12 text-ink" />
          <Label className="mt-8 block">An agent harness for self-development</Label>
          <h2 className="lh-title mt-3 text-[44px] leading-[1.08]">
            From what you want in life
            <br />
            to a week you can actually live.
          </h2>
          <p className="mt-5 max-w-[620px] text-[17px] leading-relaxed text-muted">
            LifeHarness interviews you the way a good coach would. It measures where you are before planning anything, then builds the smallest plan that moves every goal you
            care about, around your real constraints. Every block traces back to a goal; every goal gets time.
          </p>

          {model && !model.current && (
            <div className="mt-10 rounded-2xl border border-line bg-panel px-5 pb-3 pt-5" data-lh="connect-first">
              <h3 className="lh-title text-[22px]">First, connect an AI model</h3>
              <p className="mt-1.5 max-w-[600px] text-[15px] leading-relaxed text-muted">
                The coach runs on an AI model from a provider you choose. You only need one: sign in with a plan you already have, or paste an API key.
              </p>
              <div className="mt-5">
                <Connections compact onConnected={loadModel} />
              </div>
            </div>
          )}

          <ol className="mt-10 grid border-t border-line sm:grid-cols-2">
            {STEPS.map((s, i) => (
              <li key={s.t} className="border-b border-line py-5 sm:odd:border-r sm:odd:pr-6 sm:even:pl-6">
                <div className="lh-mono flex items-baseline gap-3 text-[12px] uppercase tracking-[0.08em]">
                  <span className="text-accent">0{i + 1}</span>
                  <span className="text-ink">{s.t}</span>
                </div>
                <p className="mt-2 text-[15px] leading-relaxed text-muted">{s.d}</p>
              </li>
            ))}
          </ol>

          {model?.current && (
            <div className="mt-10 flex flex-wrap items-center gap-3">
              {onboarding ? (
                <>
                  <Link href={`/session/${onboarding.id}`}>
                    <Button variant="accent" size="lg">
                      Continue your interview →
                    </Button>
                  </Link>
                  <Button variant="ghost" size="lg" onClick={begin} disabled={busy}>
                    Start over
                  </Button>
                </>
              ) : (
                <Button variant="accent" size="lg" onClick={begin} disabled={busy || !model?.current} data-lh="start-interview">
                  {busy ? "Starting…" : "Start the interview →"}
                </Button>
              )}
            </div>
          )}
          {model?.current && (
            <p className="mt-4 text-[13px] leading-relaxed text-muted">
              <span className="lh-mono text-[11px] uppercase tracking-[0.06em]">
                {model.current.name} · {model.current.providerName}
              </span>
              <br />
              Your plans and tracking are stored on this computer. The interview itself is sent to {model.current.providerName}.{" "}
              <Link href="/settings#models" className="underline decoration-line underline-offset-2 hover:text-ink">
                Change model
              </Link>
            </p>
          )}
          {err && <p className="mt-4 text-sm text-danger">{err}</p>}
        </div>
      </div>
    </>
  );
}
