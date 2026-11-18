// Browser-side API helpers.
import type { ChatView } from "@/src/server/view";
import type { TurnEvent } from "@/src/server/agent";

/** An API failure; `action` tells the page what to offer (e.g. "connect" → Settings → AI models). */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public action?: "connect" | "retry",
  ) {
    super(message);
  }
}

async function fail(r: Response): Promise<never> {
  const j = await r.json().catch(() => ({}) as Record<string, unknown>);
  throw new ApiError(String(j.error ?? `Request failed (${r.status})`), r.status, j.action as ApiError["action"]);
}

export async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) await fail(r);
  return (await r.json()) as T;
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) await fail(r);
  return (await r.json()) as T;
}

export async function deleteJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { method: "DELETE" });
  if (!r.ok) await fail(r);
  return (await r.json()) as T;
}

/** POST, then feed each NDJSON line of the streamed response to onEvent until it ends. */
export async function streamNdjson<E>(url: string, body: unknown, onEvent: (e: E) => void, signal?: AbortSignal): Promise<void> {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  if (!r.ok || !r.body) await fail(r);
  const reader = r.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) onEvent(JSON.parse(line) as E);
    }
  }
}

/** POST a turn and feed each event to onEvent until the stream ends. */
export function streamTurn(chatId: string, input: unknown, onEvent: (e: TurnEvent) => void): Promise<void> {
  return streamNdjson<TurnEvent>(`/api/chats/${chatId}/turn`, input, onEvent);
}

export type { ChatView };
