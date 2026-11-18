"use client";
import { useEffect, useRef, useState } from "react";
import Markdown from "./Markdown";
import type { AskQuestionArgs, QuestionAnswer } from "@/src/server/store";

export default function QuestionDock({ args, busy, onSubmit }: { args: AskQuestionArgs; busy: boolean; onSubmit: (a: QuestionAnswer) => void }) {
  const kind = args.kind ?? (args.options?.length ? "single" : "text");
  const options = kind === "text" ? [] : (args.options ?? []);
  const [selected, setSelected] = useState<string[]>([]);
  const [other, setOther] = useState("");
  const [thinking, setThinking] = useState("");
  const [confidence, setConfidence] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setSelected([]);
    setOther("");
    setThinking("");
    setConfidence(null);
    if (kind === "text") setTimeout(() => textRef.current?.focus(), 50);
  }, [args, kind]);

  const toggle = (label: string) => {
    if (kind === "multi") setSelected((s) => (s.includes(label) ? s.filter((x) => x !== label) : [...s, label]));
    else setSelected((s) => (s[0] === label ? [] : [label]));
  };
  const hasAnswer = selected.length > 0 || other.trim().length > 0;
  const canSubmit = !busy && hasAnswer && (!args.askConfidence || confidence != null);
  const submit = () => {
    if (!canSubmit) return;
    onSubmit({
      selected: selected.length ? selected : undefined,
      other: other.trim() || undefined,
      thinking: thinking.trim() || undefined,
      confidence: args.askConfidence ? (confidence ?? undefined) : undefined,
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        submit();
        return;
      }
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") return;
      const n = Number(e.key);
      if (n >= 1 && n <= options.length) toggle(options[n - 1].label);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div ref={rootRef} className="rounded-2xl border border-accent/25 bg-white p-4 shadow-[0_6px_30px_-12px_rgba(91,75,214,0.35)]">
      <Markdown className="text-[15px] font-medium leading-snug">{args.question}</Markdown>
      {args.why && <p className="mt-0.5 text-xs text-muted">{args.why}</p>}

      {options.length > 0 && (
        <div className="mt-3 grid gap-1.5">
          {options.map((o, i) => {
            const on = selected.includes(o.label);
            return (
              <button
                type="button"
                key={o.label}
                onClick={() => toggle(o.label)}
                className={`flex items-start gap-3 rounded-xl border px-3 py-2 text-left transition ${
                  on ? "border-accent bg-accent-soft" : "border-line bg-white hover:border-accent/40 hover:bg-gray-50"
                }`}
              >
                <span
                  className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center text-[11px] font-semibold ${kind === "multi" ? "rounded-md" : "rounded-full"} ${
                    on ? "bg-accent text-white" : "border border-gray-300 text-muted"
                  }`}
                >
                  {on ? "✓" : i + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium leading-snug">{o.label}</span>
                  {o.description && <span className="block text-xs leading-snug text-muted">{o.description}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-3 space-y-2">
        {kind === "text" ? (
          <textarea
            ref={textRef}
            value={other}
            onChange={(e) => setOther(e.target.value)}
            rows={3}
            placeholder={args.placeholder ?? "Your answer, in your own words"}
            className="w-full resize-y rounded-xl border border-line px-3 py-2 text-sm outline-none focus:border-accent"
          />
        ) : (
          <input
            value={other}
            onChange={(e) => setOther(e.target.value)}
            placeholder={selected.length ? "Add detail (optional)" : "Other: say it in your own words"}
            className="w-full rounded-xl border border-line px-3 py-2 text-sm outline-none focus:border-accent"
          />
        )}
        <textarea
          value={thinking}
          onChange={(e) => setThinking(e.target.value)}
          rows={thinking ? 3 : 1}
          placeholder="Think out loud (optional): why, doubts, what makes this hard…"
          className="w-full resize-y rounded-xl border border-dashed border-line bg-gray-50/60 px-3 py-2 text-sm outline-none focus:border-accent focus:bg-white"
        />
        {args.askConfidence && (
          <div className="rounded-xl bg-gray-50 px-3 py-2">
            <div className="flex items-center justify-between text-xs text-muted">
              <span>{args.confidenceLabel ?? "How sure are you?"}</span>
              <span className={`font-semibold ${confidence == null ? "text-amber-600" : "text-ink"}`}>{confidence == null ? "drag to set" : `${confidence}%`}</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={confidence ?? 50}
              onChange={(e) => setConfidence(Number(e.target.value))}
              onMouseDown={() => confidence == null && setConfidence(50)}
              className="mt-1 w-full accent-[#5b4bd6]"
            />
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <button type="button" disabled={busy} onClick={() => onSubmit({ skipped: true })} className="text-xs text-muted hover:text-ink disabled:opacity-40">
          Skip / I don&apos;t know
        </button>
        <div className="flex items-center gap-2">
          <span className="hidden text-[11px] text-muted sm:inline">Ctrl+Enter</span>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={submit}
            className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-35"
          >
            Answer
          </button>
        </div>
      </div>
    </div>
  );
}
