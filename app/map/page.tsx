"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import LifeMap from "@/components/LifeMap";
import Markdown from "@/components/Markdown";
import { getJson, postJson } from "@/lib/api";
import type { Strand } from "@/src/core/profile";
import type { Plan, Profile } from "@/src/core/types";

type State = { profile: Profile; coverage: Strand[]; plan: Plan | null; versions: { version: number; adoptedAt?: string; chatId?: string }[] };

export default function MapPage() {
  const router = useRouter();
  const [s, setS] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    getJson<State>("/api/state").then(setS).catch(() => {});
  }, []);
  const open = async (kind: "replan" | "onboarding") => {
    setBusy(true);
    const c = await postJson<{ id: string }>("/api/chats", { kind });
    router.push(`/session/${c.id}`);
  };
  if (!s) return <div className="p-10 text-center text-muted">Loading…</div>;
  return (
    <div className="mx-auto max-w-5xl px-5 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Life map</h1>
          <p className="text-sm text-muted">What the coach knows about you. It carries into every plan and review.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" disabled={busy} onClick={() => open("replan")} className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40">
            Change my plan →
          </button>
          <button type="button" disabled={busy} onClick={() => open("onboarding")} className="rounded-lg border border-line bg-white px-3 py-1.5 text-sm text-muted hover:text-ink">
            Redo the interview
          </button>
        </div>
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="rounded-2xl border border-line bg-white p-5">
          <LifeMap profile={s.profile} strands={s.coverage} />
        </div>
        <aside className="space-y-4">
          <div className="rounded-2xl border border-line bg-white p-4">
            <h2 className="mb-2 text-sm font-semibold">Current plan</h2>
            {s.plan ? (
              <>
                <p className="text-xs text-muted">v{s.plan.version} · adopted {new Date(s.plan.adoptedAt!).toLocaleDateString()} · {s.plan.blocks.length} recurring blocks</p>
                <Markdown className="mt-2 text-[13px]">{s.plan.approach}</Markdown>
              </>
            ) : (
              <p className="text-sm text-muted">
                None yet. <Link href="/start" className="text-accent underline">Start</Link>
              </p>
            )}
          </div>
          {s.versions.length > 1 && (
            <div className="rounded-2xl border border-line bg-white p-4">
              <h2 className="mb-2 text-sm font-semibold">History</h2>
              <ul className="space-y-1 text-xs text-muted">
                {[...s.versions].reverse().map((v) => (
                  <li key={v.version}>
                    v{v.version} · {v.adoptedAt ? new Date(v.adoptedAt).toLocaleString() : "not adopted"}
                    {v.chatId && (
                      <Link href={`/session/${v.chatId}`} className="ml-1 text-accent hover:underline">
                        session
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
