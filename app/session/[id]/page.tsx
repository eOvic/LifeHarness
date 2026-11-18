"use client";
import { ArrowUp, Check, PanelRight, X } from "lucide-react";
import Link from "next/link";
import { use, useCallback, useEffect, useRef, useState } from "react";
import Connections from "@/components/Connections";
import LifeMap from "@/components/LifeMap";
import Markdown from "@/components/Markdown";
import PageHeader from "@/components/PageHeader";
import PlanPanel from "@/components/PlanPanel";
import QuestionDock from "@/components/QuestionDock";
import { refreshSidebar } from "@/components/Shell";
import { Button, cx, IconButton, Label, Segmented, Spinner } from "@/components/ui";
import { ApiError, getJson, postJson, streamTurn, type ChatView } from "@/lib/api";
import type { Strand } from "@/src/core/profile";
import type { Plan, Profile } from "@/src/core/types";
import type { QuestionAnswer } from "@/src/server/store";
import type { ViewItem } from "@/src/server/view";

type ProfileState = { profile: Profile; coverage: Strand[] };
const PHASE_LABEL = { intake: "Interview", plan: "Plan", review: "Review" } as const;

export default function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [chat, setChat] = useState<ChatView | null>(null);
  const [life, setLife] = useState<ProfileState | null>(null);
  const [live, setLive] = useState<{ text: string; status: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; action?: "connect" | "retry"; detail?: string } | null>(null);
  const [tab, setTab] = useState<"map" | "plan">("map");
  const [panel, setPanel] = useState(false);
  /** The side panel slides over the conversation instead of squeezing it when space is short. */
  const [overlay, setOverlay] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  /** What to re-send after the person fixes the cause (e.g. connects a model). */
  const retry = useRef<unknown>(null);
  const [draft, setDraft] = useState("");
  const started = useRef(false);
  const lastProposal = useRef<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const fit = () => setOverlay(el.clientWidth < 1100);
    fit();
    setPanel(el.clientWidth >= 1100);
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!chat]);

  const refreshLife = useCallback(() => {
    getJson<ProfileState>("/api/profile").then(setLife).catch(() => {});
  }, []);

  const run = useCallback(
    async (input: unknown, optimistic?: (c: ChatView) => ChatView) => {
      setBusy(true);
      setError(null);
      retry.current = null;
      setLive({ text: "", status: "Thinking" });
      if (optimistic) setChat((c) => (c ? { ...optimistic(c) } : c));
      try {
        await streamTurn(id, input, (e) => {
          if (e.type === "text") setLive((l) => ({ text: (l?.text ?? "") + e.delta, status: "" }));
          else if (e.type === "status") setLive((l) => ({ text: l?.text ?? "", status: e.text.replace(/…$/, "") }));
          else if (e.type === "tool") refreshLife();
          else if (e.type === "chat") {
            setChat(e.chat);
            setLive((l) => (l ? { text: "", status: "" } : l));
          } else if (e.type === "error") {
            setError({ message: e.message, action: e.action });
            retry.current = { type: "continue" };
          }
        });
      } catch (e) {
        const err = e as ApiError;
        setError({ message: err.message, action: err.action });
        // 503 = the turn never started (no model, engine trouble): send the same input again.
        if (err.status === 503) retry.current = input;
      } finally {
        setBusy(false);
        setLive(null);
        refreshLife();
        refreshSidebar();
      }
    },
    [id, refreshLife],
  );

  useEffect(() => {
    started.current = false;
    lastProposal.current = null;
    setChat(null);
    getJson<ChatView>(`/api/chats/${id}`)
      .then((c) => {
        setChat(c);
        lastProposal.current = c.proposal?.toolCallId ?? null;
        if (c.lastError && c.canContinue) {
          setError({ message: c.lastError, action: c.lastErrorAction, detail: c.lastErrorDetail });
          retry.current = { type: "continue" };
        }
        const fresh = !c.items.length && !c.pending && !c.canContinue && !c.lastError;
        if (fresh && !started.current) {
          started.current = true;
          run({ type: "start" });
        }
      })
      .catch((e) => setError({ message: (e as Error).message }));
    refreshLife();
  }, [id, run, refreshLife]);

  useEffect(() => {
    const p = chat?.proposal?.toolCallId ?? null;
    if (p && p !== lastProposal.current) {
      // A plan just arrived in this session: show it (over the conversation if space is short).
      setTab("plan");
      setPanel(true);
      lastProposal.current = p;
    }
  }, [chat?.proposal?.toolCallId]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [chat?.items.length, live?.text, chat?.pending?.toolCallId]);

  const answer = (a: QuestionAnswer) => {
    const pend = chat?.pending;
    if (!pend) return;
    run({ type: "answer", toolCallId: pend.toolCallId, answer: a }, (c) => ({
      ...c,
      pending: null,
      items: c.items.map((it) => (it.kind === "question" && it.id === pend.toolCallId ? { ...it, answer: a, open: false } : it)),
    }));
  };
  const send = () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    run({ type: "message", text }, (c) => ({ ...c, items: [...c.items, { kind: "user", id: `tmp${Date.now()}`, text }] }));
  };
  const adopt = async () => {
    try {
      const plan = await postJson<Plan>("/api/plan/adopt", { chatId: id });
      const text = `I've adopted the plan (v${plan.version}).`;
      run({ type: "message", text }, (c) => ({
        ...c,
        proposal: c.proposal ? { ...c.proposal, adoptedVersion: plan.version } : c.proposal,
        items: [...c.items, { kind: "user", id: `tmp${Date.now()}`, text }],
      }));
    } catch (e) {
      setError({ message: (e as Error).message });
    }
  };
  const retryNow = () => {
    const input = retry.current ?? { type: "continue" };
    retry.current = null;
    run(input);
  };

  if (!chat) {
    return (
      <>
        <PageHeader title=" " />
        <div className="grid flex-1 place-items-center text-muted">{error?.message ?? <Spinner />}</div>
      </>
    );
  }

  const step = chat.kind === "review" ? -1 : chat.proposal?.adoptedVersion ? 2 : chat.phase === "plan" ? 1 : 0;
  const qCount = chat.items.filter((i) => i.kind === "question").length;
  const pending = chat.pending;

  return (
    <>
      <PageHeader
        title={chat.title}
        meta={meta(chat)}
        right={
          <>
            {busy && <Spinner className="mr-1" />}
            {step >= 0 ? (
              <ol className="lh-mono flex items-center gap-1.5 text-[11px] uppercase tracking-[0.07em]">
                {["Interview", "Plan", "Adopted"].map((s, i) => (
                  <li key={s} className="flex items-center gap-1.5">
                    <span className={cx("flex items-center gap-1", i === step ? "text-ink" : i < step ? "text-muted" : "text-muted/50")}>
                      {i < step ? <Check className="h-3 w-3" /> : i === step ? <span className="h-1.5 w-1.5 rounded-full bg-accent" /> : null}
                      {s}
                    </span>
                    {i < 2 && <span className="text-muted/40">›</span>}
                  </li>
                ))}
              </ol>
            ) : (
              <span className="lh-label">{PHASE_LABEL[chat.phase]}</span>
            )}
            <IconButton onClick={() => setPanel((p) => !p)} active={panel} title="Life map & plan panel" className="ml-2">
              <PanelRight />
            </IconButton>
          </>
        }
      />
      <div ref={body} className="relative flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto max-w-[760px] space-y-5 px-6 pb-10 pt-7">
              {chat.items.map((it, i) => (
                <Item key={it.id} item={it} n={chat.items.slice(0, i + 1).filter((x) => x.kind === "question").length} />
              ))}
              {live && (live.text || live.status) && (
                <div>
                  {live.text && <Markdown>{live.text}</Markdown>}
                  {live.status && (
                    <p className="lh-dots lh-mono mt-1 text-[11px] uppercase tracking-[0.08em] text-muted">
                      {live.status}
                      <span>.</span>
                      <span>.</span>
                      <span>.</span>
                    </p>
                  )}
                </div>
              )}
              {error?.action === "connect" && !busy && (
                <div className="lh-rise rounded-2xl border border-accent/40 bg-panel px-5 pb-3 pt-4" data-lh="connect-panel">
                  <p className="text-[15px] text-ink">{error.message}</p>
                  <p className="mt-1 text-[13px] text-muted">Your session is saved; it continues as soon as a model is connected.</p>
                  <div className="mt-4">
                    <Connections compact onConnected={retryNow} />
                  </div>
                </div>
              )}
              {chat.proposal?.adoptedVersion && !busy && (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-ok/40 px-4 py-3 text-[15px]">
                  <Check className="h-4 w-4 text-ok" /> Plan v{chat.proposal.adoptedVersion} is live.
                  <Link href="/today" className="lh-mono text-[11px] uppercase tracking-[0.07em] text-accent hover:underline">
                    Open today →
                  </Link>
                  <Link href="/week" className="lh-mono text-[11px] uppercase tracking-[0.07em] text-accent hover:underline">
                    See the week →
                  </Link>
                </div>
              )}
            </div>
          </div>

          <div className="shrink-0 px-6 pb-5">
            <div className="mx-auto max-w-[760px]">
              {error && error.action !== "connect" && (
                <div className="mb-2 flex items-start justify-between gap-3 rounded-xl border border-danger/40 px-4 py-2.5 text-sm" data-lh="turn-error">
                  <div className="min-w-0 break-words">
                    <span className="text-danger">{error.message}</span>
                    {error.detail && (
                      <details className="mt-1 text-[12px] text-muted">
                        <summary className="cursor-pointer select-none">Details</summary>
                        <code className="lh-mono mt-1 block whitespace-pre-wrap break-all">{error.detail}</code>
                      </details>
                    )}
                  </div>
                  {(retry.current || chat.canContinue) && !busy && (
                    <Button size="sm" variant="danger" onClick={retryNow}>
                      Retry
                    </Button>
                  )}
                </div>
              )}
              {!error && chat.canContinue && !busy && (
                <div className="mb-2 flex items-center justify-between rounded-xl border border-line px-4 py-2.5 text-sm">
                  <span className="text-muted">The coach stopped mid-way.</span>
                  <Button size="sm" variant="primary" onClick={() => run({ type: "continue" })}>
                    Continue
                  </Button>
                </div>
              )}
              {pending ? (
                <QuestionDock key={pending.toolCallId} args={pending.args} busy={busy} label={`${PHASE_LABEL[chat.phase]} · Q${qCount}`} onSubmit={answer} />
              ) : (
                <div className="flex items-end gap-2 rounded-2xl border border-line bg-panel p-2 pl-4 shadow-[0_18px_50px_-28px_rgba(0,0,0,0.55)]">
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        send();
                      }
                    }}
                    rows={1}
                    disabled={busy}
                    placeholder={busy ? "The coach is working…" : chat.proposal && !chat.proposal.adoptedVersion ? "Ask for changes, e.g. “move workouts to the evening”" : "Write to your coach…"}
                    className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent py-2 text-[16px] leading-snug text-ink outline-none placeholder:text-muted/70"
                  />
                  <IconButton onClick={send} disabled={busy || !draft.trim()} title="Send (Enter)" className="h-10 w-10 rounded-xl bg-ink text-canvas hover:bg-ink hover:text-canvas hover:opacity-90">
                    <ArrowUp />
                  </IconButton>
                </div>
              )}
            </div>
          </div>
        </div>

        {panel && (
          <aside
            className={cx(
              "w-[440px] shrink-0 overflow-y-auto overflow-x-hidden border-l border-line px-5 py-4",
              overlay && "lh-rise absolute inset-y-0 right-0 z-20 w-[min(440px,92%)] bg-canvas shadow-[-24px_0_60px_-30px_rgba(0,0,0,0.6)]",
            )}
            data-lh="side-panel"
          >
            {overlay && (
              <div className="-mt-1 mb-2 flex justify-end">
                <IconButton onClick={() => setPanel(false)} title="Close panel">
                  <X />
                </IconButton>
              </div>
            )}
            <Segmented
              className="mb-5 flex w-full"
              value={tab}
              onChange={setTab}
              options={[
                { value: "map", label: "Life map" },
                {
                  value: "plan",
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      Plan{chat.proposal && !chat.proposal.adoptedVersion && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
                    </span>
                  ),
                },
              ]}
            />
            {tab === "map" ? (
              life ? (
                <LifeMap profile={life.profile} strands={chat.phase === "intake" ? life.coverage : undefined} compact />
              ) : (
                <Spinner />
              )
            ) : chat.proposal ? (
              <PlanPanel proposal={chat.proposal} busy={busy} onAdopt={adopt} />
            ) : (
              <p className="py-10 text-center text-[14px] text-muted">The plan appears here once the interview is done.</p>
            )}
          </aside>
        )}
      </div>
    </>
  );
}

function Item({ item, n }: { item: ViewItem; n: number }) {
  switch (item.kind) {
    case "user":
      return (
        <div className="rounded-r-lg border-l-2 border-muted/60 bg-panel px-4 py-2.5">
          <Label>You</Label>
          <div className="mt-0.5 whitespace-pre-wrap text-[15px] leading-snug text-ink">{item.text}</div>
        </div>
      );
    case "assistant":
      return <Markdown>{item.text}</Markdown>;
    case "question":
      if (item.open) return null;
      return (
        <div className="rounded-xl border border-line px-4 py-3">
          <Label>Q{n}</Label>
          <Markdown small className="mt-0.5 text-muted">
            {item.args.question}
          </Markdown>
          {item.answer ? <AnswerView a={item.answer} /> : <p className="mt-1 text-sm text-muted">Unanswered</p>}
        </div>
      );
    case "activity":
      return (
        <details className="group">
          <summary className={cx("lh-mono flex cursor-pointer list-none items-center gap-2 text-[11px] uppercase tracking-[0.07em]", item.error ? "text-warn" : "text-muted hover:text-ink")}>
            <span className="h-1 w-1 rounded-full bg-current" />
            {item.label}
            {item.detail && <span className="transition group-open:rotate-90">›</span>}
          </summary>
          {item.detail && <p className="mt-1.5 border-l border-line pl-3 text-sm text-muted">{item.detail}</p>}
        </details>
      );
    case "divider":
      return (
        <div className="lh-mono flex items-center gap-3 py-2 text-[11px] uppercase tracking-[0.08em] text-accent">
          <div className="h-px flex-1 bg-line" />
          {item.label}
          <div className="h-px flex-1 bg-line" />
        </div>
      );
  }
}

function AnswerView({ a }: { a: QuestionAnswer }) {
  if (a.skipped) return <p className="mt-1.5 text-sm italic text-muted">Skipped</p>;
  return (
    <div className="mt-2 space-y-1.5">
      {(!!a.selected?.length || a.confidence != null) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {a.selected?.map((s) => (
            <span key={s} className="rounded-md bg-selected px-2 py-0.5 text-[14px] text-ink">
              {s}
            </span>
          ))}
          {a.confidence != null && <span className="lh-mono rounded-md border border-line px-1.5 py-0.5 text-[11px] text-muted">{a.confidence}% sure</span>}
        </div>
      )}
      {a.other && <p className="whitespace-pre-wrap text-[15px] leading-snug text-ink">{a.other}</p>}
      {a.thinking && (
        <p className="whitespace-pre-wrap text-sm leading-snug text-muted">
          <span className="lh-mono mr-1.5 text-[10.5px] uppercase tracking-[0.07em]">thinking</span>
          {a.thinking}
        </p>
      )}
    </div>
  );
}

/** Header line: the model in use, answered calls, and a cost only when there is one to report. */
function meta(chat: ChatView): string | undefined {
  const u = chat.usage;
  const n = chat.answeredCalls;
  const cost = u.billing === "subscription" ? "subscription" : u.cost >= 0.005 ? `$${u.cost.toFixed(2)}` : "";
  const usage = n ? [`${n} call${n === 1 ? "" : "s"}`, cost].filter(Boolean).join(" · ") : "";
  return [chat.model?.name, usage].filter(Boolean).join(" · ") || undefined;
}
