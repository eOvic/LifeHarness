"use client";
import Link from "next/link";
import { use, useCallback, useEffect, useRef, useState } from "react";
import LifeMap from "@/components/LifeMap";
import Markdown from "@/components/Markdown";
import PlanPanel from "@/components/PlanPanel";
import QuestionDock from "@/components/QuestionDock";
import { getJson, postJson, streamTurn, type ChatView } from "@/lib/api";
import type { Strand } from "@/src/core/profile";
import type { Plan, Profile } from "@/src/core/types";
import type { QuestionAnswer } from "@/src/server/store";
import type { ViewItem } from "@/src/server/view";

type ProfileState = { profile: Profile; coverage: Strand[] };

export default function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [chat, setChat] = useState<(ChatView & { busy?: boolean }) | null>(null);
  const [life, setLife] = useState<ProfileState | null>(null);
  const [live, setLive] = useState<{ text: string; status: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"map" | "plan">("map");
  const [draft, setDraft] = useState("");
  const started = useRef(false);
  const lastProposal = useRef<string | null>(null);

  const refreshLife = useCallback(() => {
    getJson<ProfileState>("/api/profile").then(setLife).catch(() => {});
  }, []);

  const run = useCallback(
    async (input: unknown, optimistic?: (c: ChatView) => ChatView) => {
      setBusy(true);
      setError(null);
      setLive({ text: "", status: "Thinking…" });
      if (optimistic) setChat((c) => (c ? { ...optimistic(c) } : c));
      try {
        await streamTurn(id, input, (e) => {
          if (e.type === "text") setLive((l) => ({ text: (l?.text ?? "") + e.delta, status: "" }));
          else if (e.type === "status") setLive((l) => ({ text: l?.text ?? "", status: e.text }));
          else if (e.type === "tool") refreshLife();
          else if (e.type === "chat") {
            setChat(e.chat);
            setLive((l) => (l ? { text: "", status: "" } : l));
          } else if (e.type === "error") setError(e.message);
        });
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
        setLive(null);
        refreshLife();
      }
    },
    [id, refreshLife],
  );

  // Load, then auto-start a fresh session.
  useEffect(() => {
    getJson<ChatView & { busy?: boolean }>(`/api/chats/${id}`)
      .then((c) => {
        setChat(c);
        const fresh = !c.items.length && !c.pending && !c.canContinue && !c.lastError;
        if (fresh && !started.current) {
          started.current = true;
          run({ type: "start" });
        }
      })
      .catch((e) => setError(e.message));
    refreshLife();
  }, [id, run, refreshLife]);

  // A new proposal: show the Plan tab.
  useEffect(() => {
    const p = chat?.proposal?.toolCallId ?? null;
    if (p && p !== lastProposal.current) {
      if (lastProposal.current !== null || chat?.phase !== "intake") setTab("plan");
      lastProposal.current = p;
    }
  }, [chat?.proposal?.toolCallId, chat?.phase]);

  // Follow the conversation.
  useEffect(() => {
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
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
      setError((e as Error).message);
    }
  };

  if (!chat) {
    return <div className="p-10 text-center text-muted">{error ?? "Loading…"}</div>;
  }

  const step = chat.kind === "review" ? -1 : chat.proposal?.adoptedVersion ? 2 : chat.phase === "plan" ? 1 : 0;
  const pending = chat.pending;

  return (
    <div className="mx-auto flex max-w-[1500px] gap-6 px-5">
      <section className="flex min-h-[calc(100vh-3.25rem)] min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-3 py-4">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">{chat.title}</h1>
            <p className="text-xs text-muted">
              {chat.usage.calls} model calls · ≈${chat.usage.cost.toFixed(2)}
            </p>
          </div>
          {step >= 0 && (
            <ol className="flex items-center gap-1 text-xs">
              {["Interview", "Plan", "Adopted"].map((s, i) => (
                <li key={s} className="flex items-center gap-1">
                  <span className={`rounded-full px-2.5 py-1 font-medium ${i === step ? "bg-accent text-white" : i < step ? "bg-accent-soft text-accent" : "bg-gray-100 text-muted"}`}>
                    {i < step ? "✓ " : ""}
                    {s}
                  </span>
                  {i < 2 && <span className="text-gray-300">—</span>}
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="flex-1 space-y-4 pb-6">
          {chat.items.map((it) => (
            <Item key={it.id} item={it} />
          ))}
          {live && (live.text || live.status) && (
            <div>
              {live.text && <Markdown className="text-[15px]">{live.text}</Markdown>}
              {live.status && (
                <p className="lh-dots mt-1 text-sm text-muted">
                  {live.status.replace(/…$/, "")}
                  <span>.</span>
                  <span>.</span>
                  <span>.</span>
                </p>
              )}
            </div>
          )}
          {chat.proposal?.adoptedVersion && !busy && (
            <div className="flex flex-wrap gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              Plan v{chat.proposal.adoptedVersion} is live.
              <Link href="/today" className="font-semibold underline">
                Open Today →
              </Link>
              <Link href="/week" className="font-semibold underline">
                See the week →
              </Link>
            </div>
          )}
        </div>

        <div className="sticky bottom-0 bg-gradient-to-t from-paper via-paper to-paper/0 pb-5 pt-3">
          {error && (
            <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              <span className="min-w-0 break-words">{error}</span>
              {chat.canContinue && !busy && (
                <button type="button" onClick={() => run({ type: "continue" })} className="shrink-0 rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white">
                  Retry
                </button>
              )}
            </div>
          )}
          {!error && chat.canContinue && !busy && (
            <div className="mb-2 flex items-center justify-between rounded-lg border border-line bg-white px-3 py-2 text-sm">
              <span className="text-muted">The agent stopped mid-way.</span>
              <button type="button" onClick={() => run({ type: "continue" })} className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-white">
                Continue
              </button>
            </div>
          )}
          {pending ? (
            <QuestionDock key={pending.toolCallId} args={pending.args} busy={busy} onSubmit={answer} />
          ) : (
            <div className="flex items-end gap-2 rounded-2xl border border-line bg-white p-2 shadow-sm">
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
                placeholder={busy ? "Working…" : chat.proposal && !chat.proposal.adoptedVersion ? "Ask for changes, e.g. “move workouts to the evening”" : "Write a message…"}
                className="max-h-40 min-h-[40px] flex-1 resize-y bg-transparent px-2 py-2 text-sm outline-none"
              />
              <button type="button" onClick={send} disabled={busy || !draft.trim()} className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-35">
                Send
              </button>
            </div>
          )}
        </div>
      </section>

      <aside className="scroll-thin sticky top-[4.25rem] my-4 hidden h-[calc(100vh-5.5rem)] w-[470px] shrink-0 overflow-y-auto rounded-2xl border border-line bg-white p-4 lg:block">
        <div className="mb-3 flex gap-1 rounded-lg bg-gray-100 p-1 text-sm">
          {(["map", "plan"] as const).map((t) => (
            <button
              type="button"
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 rounded-md py-1.5 font-medium transition ${tab === t ? "bg-white shadow-sm" : "text-muted hover:text-ink"}`}
            >
              {t === "map" ? "Life map" : "Plan"}
              {t === "plan" && chat.proposal && !chat.proposal.adoptedVersion && <span className="ml-1.5 inline-block h-2 w-2 rounded-full bg-accent" />}
            </button>
          ))}
        </div>
        {tab === "map" ? (
          life ? (
            <LifeMap profile={life.profile} strands={chat.phase === "intake" ? life.coverage : undefined} compact />
          ) : (
            <p className="text-sm text-muted">Loading…</p>
          )
        ) : chat.proposal ? (
          <PlanPanel proposal={chat.proposal} busy={busy} onAdopt={adopt} />
        ) : (
          <p className="py-6 text-center text-sm text-muted">The plan appears here once the interview is done.</p>
        )}
      </aside>
    </div>
  );
}

function Item({ item }: { item: ViewItem }) {
  switch (item.kind) {
    case "user":
      return (
        <div className="flex justify-end">
          <div className="max-w-[75%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-sm text-white">{item.text}</div>
        </div>
      );
    case "assistant":
      return <Markdown className="text-[15px]">{item.text}</Markdown>;
    case "question":
      if (item.open) return null; // shown in the dock
      return (
        <div className="rounded-xl border border-line bg-white px-3.5 py-2.5">
          <Markdown className="text-sm font-medium text-ink/80">{item.args.question}</Markdown>
          {item.answer ? <AnswerView a={item.answer} /> : <p className="text-xs text-muted">(unanswered)</p>}
        </div>
      );
    case "activity":
      return (
        <div className={`flex items-start gap-2 text-xs ${item.error ? "text-amber-700" : "text-muted"}`} title={item.detail}>
          <span className="mt-px">{item.error ? "↻" : "⚙"}</span>
          <span className="min-w-0">
            <span className="font-medium">{item.label}</span>
            {item.detail && <span className="line-clamp-1"> · {item.detail}</span>}
          </span>
        </div>
      );
    case "divider":
      return (
        <div className="flex items-center gap-3 py-2 text-xs font-medium uppercase tracking-wider text-accent">
          <div className="h-px flex-1 bg-accent/25" />
          {item.label}
          <div className="h-px flex-1 bg-accent/25" />
        </div>
      );
  }
}

function AnswerView({ a }: { a: QuestionAnswer }) {
  if (a.skipped) return <p className="mt-1 text-sm italic text-muted">Skipped</p>;
  return (
    <div className="mt-1.5 space-y-1">
      <div className="flex flex-wrap gap-1.5">
        {a.selected?.map((s) => (
          <span key={s} className="rounded-md bg-accent-soft px-2 py-0.5 text-sm text-accent">
            {s}
          </span>
        ))}
        {a.confidence != null && <span className="rounded-md bg-gray-100 px-2 py-0.5 text-xs leading-5 text-muted">{a.confidence}% sure</span>}
      </div>
      {a.other && <p className="whitespace-pre-wrap text-sm">{a.other}</p>}
      {a.thinking && <p className="whitespace-pre-wrap text-xs italic text-muted">💭 {a.thinking}</p>}
    </div>
  );
}
