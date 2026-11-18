"use client";
import { useEffect, useRef, useState } from "react";
import type { AskQuestionArgs, QuestionAnswer } from "@/src/server/store";
import Markdown from "./Markdown";
import { Button, cx, Kbd, Label } from "./ui";

/** The answer dock. The parent remounts it per question (key = toolCallId), so state starts fresh. */
export default function QuestionDock({ args, busy, label, onSubmit }: { args: AskQuestionArgs; busy: boolean; label: string; onSubmit: (a: QuestionAnswer) => void }) {
  const kind = args.kind ?? (args.options?.length ? "single" : "text");
  const options = kind === "text" ? [] : (args.options ?? []);
  const [selected, setSelected] = useState<string[]>([]);
  const [other, setOther] = useState("");
  const [thinking, setThinking] = useState("");
  const [confidence, setConfidence] = useState<number | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  // Focus once, on mount only: never move the cursor while the person is typing.
  useEffect(() => {
    if (kind === "text") textRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (l: string) => {
    if (kind === "multi") setSelected((s) => (s.includes(l) ? s.filter((x) => x !== l) : [...s, l]));
    else setSelected((s) => (s[0] === l ? [] : [l]));
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
  const enterSubmits = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        submit();
        return;
      }
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT" || e.ctrlKey || e.metaKey || e.altKey) return;
      const n = Number(e.key);
      if (n >= 1 && n <= options.length) toggle(options[n - 1].label);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div data-lh="dock" className="lh-rise overflow-hidden rounded-2xl border border-line bg-panel shadow-[0_18px_50px_-24px_rgba(0,0,0,0.55)]">
      <div className="px-5 pb-4 pt-4">
        <Label>{label}</Label>
        <div data-lh="question">
          <Markdown className="mt-1.5 font-medium">{args.question}</Markdown>
        </div>
        {args.why && <p className="mt-1 text-sm text-muted">{args.why}</p>}

        {options.length > 0 && (
          <div className="mt-4 grid gap-2">
            {options.map((o, i) => {
              const on = selected.includes(o.label);
              return (
                <button
                  type="button"
                  data-lh="option"
                  key={o.label}
                  onClick={() => toggle(o.label)}
                  className={cx(
                    "group flex items-start gap-3 rounded-xl border px-3.5 py-2.5 text-left transition",
                    on ? "border-ink/70 bg-selected" : "border-line hover:border-muted/60 hover:bg-hover",
                  )}
                >
                  <span
                    className={cx(
                      "mt-[3px] grid h-4 w-4 shrink-0 place-items-center border transition",
                      kind === "multi" ? "rounded-[4px]" : "rounded-full",
                      on ? "border-accent bg-accent text-accent-ink" : "border-muted/60",
                    )}
                  >
                    {on && (kind === "multi" ? <span className="text-[10px] font-bold leading-none">✓</span> : <span className="h-1.5 w-1.5 rounded-full bg-accent-ink" />)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] leading-snug text-ink">{o.label}</span>
                    {o.description && <span className="mt-0.5 block text-sm leading-snug text-muted">{o.description}</span>}
                  </span>
                  <span className="lh-mono mt-0.5 text-[11px] text-muted opacity-0 transition group-hover:opacity-100">{i + 1}</span>
                </button>
              );
            })}
          </div>
        )}

        {kind === "text" ? (
          <textarea
            ref={textRef}
            data-lh="answer-text"
            value={other}
            onChange={(e) => setOther(e.target.value)}
            onKeyDown={enterSubmits}
            rows={3}
            placeholder={args.placeholder ?? "Your answer, in your own words"}
            className="mt-4 w-full resize-y rounded-xl border border-line bg-canvas px-3.5 py-2.5 text-[16px] leading-snug text-ink outline-none transition placeholder:text-muted/70 focus:border-muted"
          />
        ) : (
          <input
            data-lh="answer-other"
            value={other}
            onChange={(e) => setOther(e.target.value)}
            onKeyDown={enterSubmits}
            placeholder={selected.length ? "Add detail (optional)" : "Something else? Say it in your own words"}
            className="mt-2 w-full rounded-xl border border-dashed border-line bg-transparent px-3.5 py-2.5 text-[15px] text-ink outline-none transition placeholder:text-muted/70 focus:border-solid focus:border-muted"
          />
        )}
      </div>

      {args.askConfidence && (
        <div className="flex items-center gap-4 border-t border-line px-5 py-3">
          <Label className="shrink-0">{args.confidenceLabel ? "Confidence" : "How sure?"}</Label>
          <div className="relative flex-1">
            <input
              type="range"
              data-lh="confidence"
              min={0}
              max={100}
              step={5}
              value={confidence ?? 50}
              onChange={(e) => setConfidence(Number(e.target.value))}
              onMouseDown={() => confidence == null && setConfidence(50)}
              className={cx("lh-range w-full", confidence == null && "opacity-50")}
              title={args.confidenceLabel}
            />
          </div>
          <span className={cx("lh-mono w-20 shrink-0 text-right text-[12px]", confidence == null ? "text-warn" : "text-ink")}>{confidence == null ? "drag to set" : `${confidence}%`}</span>
        </div>
      )}
      {args.askConfidence && args.confidenceLabel && <p className="-mt-1.5 px-5 pb-2 text-xs text-muted">{args.confidenceLabel}</p>}

      <div className="border-t border-line bg-canvas/40 px-5 pb-3 pt-3">
        <Label>Your thinking</Label>
        <textarea
          data-lh="thinking"
          value={thinking}
          onChange={(e) => setThinking(e.target.value)}
          onKeyDown={enterSubmits}
          rows={thinking.length > 80 ? 3 : 1}
          placeholder="Why? Doubts? Whatever comes to mind (optional)"
          className="mt-1 w-full resize-none bg-transparent text-[15px] leading-snug text-ink outline-none placeholder:text-muted/70"
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="lh-mono hidden items-center gap-1.5 text-[11px] text-muted sm:flex">
            <Kbd>↵</Kbd> answers · <Kbd>⇧↵</Kbd> newline{options.length > 0 && <> · <Kbd>1</Kbd>–<Kbd>{options.length}</Kbd> pick</>}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => onSubmit({ skipped: true })}>
              Skip
            </Button>
            <Button variant="primary" size="sm" disabled={!canSubmit} onClick={submit} className="px-4" data-lh="submit">
              Answer
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
