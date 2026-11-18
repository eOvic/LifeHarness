"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import LifeMap from "@/components/LifeMap";
import Markdown from "@/components/Markdown";
import PageHeader from "@/components/PageHeader";
import { refreshSidebar } from "@/components/Shell";
import { Button, Label, Spinner } from "@/components/ui";
import { getJson, postJson } from "@/lib/api";
import type { Strand } from "@/src/core/profile";
import type { Plan, Profile } from "@/src/core/types";
import { fmtDate, fmtDateTime } from "@/lib/format";

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
    refreshSidebar();
    router.push(`/session/${c.id}`);
  };
  return (
    <>
      <PageHeader
        title="Life map"
        meta="what your coach knows · carried into every plan"
        right={
          <>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => open("onboarding")}>
              Redo interview
            </Button>
            <Button size="sm" variant="primary" disabled={busy} onClick={() => open("replan")}>
              Change my plan
            </Button>
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!s ? (
          <div className="grid h-full place-items-center">
            <Spinner />
          </div>
        ) : (
          <div className="mx-auto grid max-w-[1120px] gap-8 px-6 pb-12 pt-6 lg:grid-cols-[1fr_340px]">
            <div className="min-w-0">
              <LifeMap profile={s.profile} strands={s.coverage} />
            </div>
            <aside className="space-y-4">
              <div className="rounded-xl border border-line p-4">
                <Label>Current plan</Label>
                {s.plan ? (
                  <>
                    <p className="lh-mono mt-1 text-[11px] text-muted">
                      v{s.plan.version} · adopted {fmtDate(s.plan.adoptedAt!)} · {s.plan.blocks.length} blocks
                    </p>
                    <Markdown small className="mt-3">
                      {s.plan.approach}
                    </Markdown>
                  </>
                ) : (
                  <p className="mt-2 text-sm text-muted">
                    None yet.{" "}
                    <Link href="/start" className="text-accent hover:underline">
                      Start the interview
                    </Link>
                  </p>
                )}
              </div>
              {s.versions.length > 0 && (
                <div className="rounded-xl border border-line p-4">
                  <Label>History</Label>
                  <ul className="mt-2 space-y-1.5">
                    {[...s.versions].reverse().map((v) => (
                      <li key={v.version} className="lh-mono flex items-center justify-between text-[11.5px] text-muted">
                        <span>
                          v{v.version} · {v.adoptedAt ? fmtDateTime(v.adoptedAt) : "draft"}
                        </span>
                        {v.chatId && (
                          <Link href={`/session/${v.chatId}`} className="text-accent hover:underline">
                            session →
                          </Link>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </aside>
          </div>
        )}
      </div>
    </>
  );
}
