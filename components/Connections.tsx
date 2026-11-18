"use client";
// Settings → AI models: connect a provider by signing in with a subscription or pasting an API key.
// Also used compactly wherever a model is missing (Start page, a session that can't run).
import { Check, ChevronDown, Copy, ExternalLink, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { deleteJson, getJson, postJson, streamNdjson } from "@/lib/api";
import { desktop } from "@/lib/desktop";
import type { LoginEvent, ProviderInfo } from "@/src/server/connections";
import { Button, cx, Label, Spinner } from "./ui";

type Method = "oauth" | "api_key";
type PromptEvent = Extract<LoginEvent, { type: "prompt" }>;
interface Flow {
  provider: string;
  method: Method;
  job?: string;
  state: "running" | "done" | "error";
  progress?: string;
  authUrl?: { url: string; instructions?: string };
  device?: { code: string; url: string };
  prompt?: PromptEvent;
  warning?: string;
  error?: string;
  done?: Extract<LoginEvent, { type: "done" }>;
  abort: AbortController;
}

const field = "h-9 min-w-0 rounded-lg border border-line bg-canvas px-3 text-[14px] text-ink outline-none transition placeholder:text-muted/60 focus:border-muted";

export default function Connections({ compact = false, onChange, onConnected }: { compact?: boolean; onChange?: () => void; onConnected?: () => void }) {
  const [providers, setProviders] = useState<ProviderInfo[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [flow, setFlow] = useState<Flow | null>(null);
  const [keyFor, setKeyFor] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [moreSignIns, setMoreSignIns] = useState(false);
  const [adding, setAdding] = useState("");
  const opened = useRef<string | null>(null);

  // Leaving the page cancels a running sign-in (frees its callback port). Only on unmount: every
  // flow update shares one AbortController, so a [flow]-keyed cleanup would abort mid-flow.
  const current = useRef<Flow | null>(null);
  current.current = flow;
  useEffect(() => () => current.current?.abort.abort(), []);

  const load = useCallback(() => {
    getJson<{ providers: ProviderInfo[]; error?: string }>("/api/connections")
      .then((r) => {
        setProviders(r.providers);
        setLoadError(r.error ?? null);
      })
      .catch((e) => setLoadError((e as Error).message));
  }, []);
  useEffect(load, [load]);

  const patch = (p: Partial<Flow>) => setFlow((f) => (f ? { ...f, ...p } : f));

  const start = async (provider: string, method: Method, key?: string) => {
    flow?.abort.abort();
    const abort = new AbortController();
    setFlow({ provider, method, state: "running", progress: method === "oauth" ? "Starting sign-in…" : "Saving…", abort });
    opened.current = null;
    try {
      await streamNdjson<LoginEvent>(
        "/api/connections/login",
        { provider, method, key },
        (e) => {
          if (e.type === "started") patch({ job: e.job });
          else if (e.type === "progress" || e.type === "info") patch({ progress: e.message });
          else if (e.type === "auth_url") {
            patch({ authUrl: { url: e.url, instructions: e.instructions }, progress: "Waiting for you to finish in the browser…" });
            // The desktop app hands the page to your default browser right away.
            if (desktop() && opened.current !== e.url) {
              opened.current = e.url;
              window.open(e.url, "_blank", "noopener");
            }
          } else if (e.type === "device_code") patch({ device: { code: e.code, url: e.url }, progress: "Waiting for you to approve…" });
          else if (e.type === "prompt") patch({ prompt: e });
          else if (e.type === "prompt_closed") setFlow((f) => (f && f.prompt?.id === e.id ? { ...f, prompt: undefined } : f));
          else if (e.type === "warning") patch({ warning: e.message });
          else if (e.type === "error") patch({ state: "error", error: e.message, prompt: undefined });
          else if (e.type === "done") {
            patch({ state: "done", done: e, prompt: undefined, authUrl: undefined, device: undefined });
            setKeyFor(null);
            setDraft("");
            load();
            onChange?.();
            onConnected?.();
          }
        },
        abort.signal,
      );
    } catch (e) {
      if (!abort.signal.aborted) patch({ state: "error", error: (e as Error).message });
    }
  };

  const cancel = () => {
    if (flow?.job) postJson(`/api/connections/login/${flow.job}`, { cancel: true }).catch(() => {});
    flow?.abort.abort();
    setFlow(null);
  };

  const answer = async (value: string) => {
    if (!flow?.job || !flow.prompt) return;
    const id = flow.prompt.id;
    patch({ prompt: undefined, progress: "Continuing…" });
    await postJson(`/api/connections/login/${flow.job}`, { prompt: id, value }).catch(() => {});
  };

  const disconnect = async (p: ProviderInfo) => {
    await deleteJson(`/api/connections/${p.id}`).catch(() => {});
    if (flow?.provider === p.id) setFlow(null);
    load();
    onChange?.();
  };

  if (!providers) return <div className="py-3">{loadError ? <p className="text-sm text-danger">{loadError}</p> : <Spinner />}</div>;

  const signIns = providers.filter((p) => p.signIn).sort((a, b) => a.signIn!.rank - b.signIn!.rank);
  const featuredSignIns = signIns.filter((p) => p.signIn!.featured);
  const otherSignIns = signIns.filter((p) => !p.signIn!.featured);
  const keys = providers.filter((p) => p.key);
  const shownKeys = keys.filter((p) => p.key!.featured || (p.via === "api_key" && p.connected) || keyFor === p.id).sort((a, b) => a.key!.rank - b.key!.rank || a.name.localeCompare(b.name));
  const addable = keys.filter((p) => !shownKeys.includes(p)).sort((a, b) => a.key!.label.localeCompare(b.key!.label));
  const blocked = providers.filter((p) => p.signInBlocked);
  const envOnly = providers.filter((p) => p.connected && (p.via === "environment" || p.via === "config"));

  const flowFor = (id: string, method: Method) => (flow && flow.provider === id && flow.method === method ? flow : null);

  const signInRow = (p: ProviderInfo) => {
    const f = flowFor(p.id, "oauth");
    const on = p.connected && p.via === "oauth";
    return (
      <Row
        key={`s-${p.id}`}
        title={p.signIn!.label}
        blurb={p.signIn!.blurb}
        right={
          on ? (
            <Connected onDisconnect={() => disconnect(p)} detail="subscription" />
          ) : f?.state === "running" ? (
            <Button size="sm" variant="ghost" onClick={cancel}>
              Cancel
            </Button>
          ) : (
            <Button size="sm" onClick={() => start(p.id, "oauth")} data-lh={`connect-${p.id}`}>
              Connect
            </Button>
          )
        }
      >
        {f && <FlowView flow={f} onAnswer={answer} onRetry={() => start(p.id, "oauth")} />}
      </Row>
    );
  };

  const keyRow = (p: ProviderInfo) => {
    const f = flowFor(p.id, "api_key");
    const on = p.connected && p.via === "api_key";
    const editing = keyFor === p.id && !on;
    return (
      <Row
        key={`k-${p.id}`}
        title={p.key!.label}
        blurb={p.key!.blurb}
        right={
          on ? (
            <Connected onDisconnect={() => disconnect(p)} detail="key" />
          ) : editing ? null : (
            <Button
              size="sm"
              onClick={() => {
                setKeyFor(p.id);
                setDraft("");
                if (flow?.method === "api_key") setFlow(null);
              }}
              data-lh={`key-${p.id}`}
            >
              Add key
            </Button>
          )
        }
      >
        {editing && (
          <form
            className="mt-2.5 flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim()) start(p.id, "api_key", draft);
            }}
          >
            <input
              autoFocus
              type="password"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Paste key…"
              autoComplete="off"
              spellCheck={false}
              className={cx(field, "lh-mono flex-1 text-[13px]")}
              data-lh="key-input"
            />
            <Button type="submit" size="md" variant="primary" disabled={!draft.trim() || f?.state === "running"}>
              {f?.state === "running" ? <Spinner /> : "Save"}
            </Button>
            <Button
              size="md"
              variant="ghost"
              onClick={() => {
                setKeyFor(null);
                if (f) cancel();
              }}
            >
              Cancel
            </Button>
            {p.key!.url && (
              <a href={p.key!.url} target="_blank" rel="noopener noreferrer" className="lh-mono inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.06em] text-muted hover:text-ink">
                Get a key <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </form>
        )}
        {f && <FlowView flow={f} onAnswer={answer} />}
      </Row>
    );
  };

  return (
    <div className="space-y-6" data-lh="connections">
      <div>
        <Label>Subscriptions</Label>
        <p className="mt-1 text-[13px] text-muted">Sign in with a plan you already pay for. No key to copy.</p>
        <div className="mt-2">
          {featuredSignIns.map(signInRow)}
          {!compact && otherSignIns.length > 0 && (
            <>
              {moreSignIns && otherSignIns.map(signInRow)}
              <button
                type="button"
                onClick={() => setMoreSignIns((m) => !m)}
                className="lh-mono mt-2 inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.06em] text-muted hover:text-ink"
              >
                <ChevronDown className={cx("h-3 w-3 transition", moreSignIns && "rotate-180")} />
                {moreSignIns ? "Fewer sign-ins" : `More sign-ins (${otherSignIns.map((p) => p.signIn!.label).join(", ")})`}
              </button>
            </>
          )}
        </div>
      </div>

      <div>
        <Label>API keys</Label>
        <p className="mt-1 text-[13px] text-muted">Pay per use. Create a key in the provider&apos;s console and paste it here. It&apos;s checked with one tiny request, then stored only on this computer.</p>
        <div className="mt-2">
          {shownKeys.map(keyRow)}
          {!compact && addable.length > 0 && (
            <div className="mt-3 flex items-center gap-2">
              <Plus className="h-3.5 w-3.5 text-muted" />
              <select
                value={adding}
                onChange={(e) => {
                  setAdding("");
                  if (e.target.value) {
                    setKeyFor(e.target.value);
                    setDraft("");
                  }
                }}
                className={cx(field, "h-8 w-64 bg-panel text-[13px]")}
                aria-label="Add another provider"
              >
                <option value="">Add another provider ({addable.length})</option>
                {addable.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.key!.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {!compact && envOnly.length > 0 && (
        <p className="text-[13px] text-muted">
          Also available from your environment: {envOnly.map((p) => `${p.name}${p.source ? ` (${p.source})` : ""}`).join(", ")}.
        </p>
      )}
      {blocked.map((p) => (
        <p key={p.id} className="text-[13px] leading-relaxed text-muted">
          {p.signInBlocked}
        </p>
      ))}
    </div>
  );
}

function Row({ title, blurb, right, children }: { title: string; blurb?: string; right: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="border-b border-line-soft py-3 last:border-b-0">
      <div className="flex min-h-8 items-center gap-3">
        <div className="min-w-0 flex-1 truncate">
          <span className="text-[15px] text-ink">{title}</span>
          {blurb && <span className="ml-2 text-[13px] text-muted">{blurb}</span>}
        </div>
        <div className="flex shrink-0 items-center gap-2">{right}</div>
      </div>
      {children}
    </div>
  );
}

function Connected({ detail, onDisconnect }: { detail: string; onDisconnect: () => void }) {
  return (
    <>
      <span className="lh-mono inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.06em] text-ok">
        <Check className="h-3.5 w-3.5" /> Connected · {detail}
      </span>
      <Button size="sm" variant="ghost" onClick={onDisconnect}>
        Disconnect
      </Button>
    </>
  );
}

function FlowView({ flow, onAnswer, onRetry }: { flow: Flow; onAnswer: (v: string) => void; onRetry?: () => void }) {
  const [value, setValue] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => setValue(""), [flow.prompt?.id]);
  const p = flow.prompt;

  return (
    <div className="mt-2.5 space-y-2.5 rounded-lg border border-line bg-canvas/60 px-3.5 py-3 text-[14px]" data-lh="login-flow" aria-live="polite">
      {flow.state === "running" && flow.progress && !p && (
        <p className="flex items-center gap-2 text-muted">
          <Spinner /> {flow.progress}
        </p>
      )}
      {flow.state === "running" && flow.authUrl && (
        <div className="flex flex-wrap items-center gap-2">
          <a href={flow.authUrl.url} target="_blank" rel="noopener noreferrer">
            <Button size="sm" variant="primary">
              Open the sign-in page <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          </a>
          <span className="text-[13px] text-muted">Finish signing in there; this updates by itself.</span>
        </div>
      )}
      {flow.state === "running" && flow.device && (
        <div className="space-y-2">
          <p className="text-[13px] text-muted">Enter this code on the provider&apos;s page, then approve LifeHarness:</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="lh-mono rounded-lg border border-line bg-panel px-3 py-1.5 text-[20px] tracking-[0.18em] text-ink" data-lh="device-code">
              {flow.device.code}
            </code>
            <Button
              size="sm"
              onClick={() => {
                navigator.clipboard?.writeText(flow.device!.code).then(() => setCopied(true), () => {});
              }}
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy"}
            </Button>
            <a href={flow.device.url} target="_blank" rel="noopener noreferrer" onClick={() => navigator.clipboard?.writeText(flow.device!.code).then(() => setCopied(true), () => {})}>
              <Button size="sm" variant="primary">
                Open {hostOf(flow.device.url)} <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            </a>
          </div>
        </div>
      )}
      {p && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            onAnswer(value);
          }}
        >
          <p className="text-[13px] text-muted">{p.kind === "manual_code" ? "If the browser doesn't come back here by itself, paste the address it ends on:" : p.message}</p>
          <div className="flex flex-wrap gap-2">
            {p.kind === "select" ? (
              <select value={value} onChange={(e) => setValue(e.target.value)} className={cx(field, "flex-1")}>
                <option value="">Choose…</option>
                {p.options?.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={p.kind === "secret" ? "password" : "text"}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={p.placeholder}
                autoComplete="off"
                spellCheck={false}
                className={cx(field, "flex-1", p.kind !== "text" && "lh-mono text-[13px]")}
              />
            )}
            <Button type="submit" size="md" disabled={p.kind !== "text" && !value.trim()}>
              {p.kind === "text" && !value.trim() ? "Skip" : "Continue"}
            </Button>
          </div>
        </form>
      )}
      {flow.warning && <p className="text-[13px] text-warn">{flow.warning}</p>}
      {flow.state === "error" && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 text-[13px] text-danger" data-lh="login-error">
            {flow.error}
          </p>
          {onRetry && (
            <Button size="sm" onClick={onRetry}>
              Try again
            </Button>
          )}
        </div>
      )}
      {flow.state === "done" && flow.done && (
        <p className="flex items-center gap-2 text-[14px] text-ok" data-lh="login-done">
          <Check className="h-4 w-4" />
          {flow.done.keptModel
            ? `Connected. Still using ${flow.done.keptModel}; switch under Model if you like.`
            : flow.done.modelName
              ? `Connected. LifeHarness will use ${flow.done.modelName}.`
              : "Connected."}
        </p>
      )}
    </div>
  );
}

function hostOf(url: string) {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return "page";
  }
}
