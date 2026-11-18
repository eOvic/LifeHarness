// Run a sign-in or API-key setup, streamed as NDJSON events (see LoginEvent in connections.ts).
// The page answers prompts with POST /api/connections/login/<job>. Closing the stream cancels.
import { LoginError, runLogin, type LoginEvent, type LoginRequest } from "@/src/server/connections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 900;

function parse(body: unknown): LoginRequest | null {
  const b = body as Record<string, unknown>;
  if (typeof b?.provider !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(b.provider)) return null;
  if (b.method !== "oauth" && b.method !== "api_key") return null;
  if (b.key !== undefined && (typeof b.key !== "string" || b.key.length > 2000)) return null;
  if (b.enterprise !== undefined && (typeof b.enterprise !== "string" || b.enterprise.length > 255)) return null;
  return { provider: b.provider, method: b.method, key: b.key as string | undefined, enterprise: b.enterprise as string | undefined };
}

export async function POST(req: Request) {
  const input = parse(await req.json().catch(() => null));
  if (!input) return Response.json({ error: "Bad request" }, { status: 400 });
  const enc = new TextEncoder();
  const ac = new AbortController();
  req.signal.addEventListener("abort", () => ac.abort(), { once: true });
  const body = new ReadableStream({
    async start(controller) {
      let open = true;
      const send = (e: LoginEvent) => {
        if (!open) return;
        try {
          controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
        } catch {
          open = false;
          ac.abort(); // the page went away: stop the flow (frees callback ports)
        }
      };
      try {
        await runLogin(input, send, ac.signal);
      } catch (e) {
        send({ type: "error", message: e instanceof LoginError ? e.message : `Couldn't start: ${(e as Error).message}` });
      } finally {
        if (open) {
          open = false;
          controller.close();
        }
      }
    },
    cancel() {
      ac.abort();
    },
  });
  return new Response(body, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" },
  });
}
