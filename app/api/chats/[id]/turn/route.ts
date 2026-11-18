// One agent turn, streamed as NDJSON events (status, text deltas, tool activity, chat snapshots, done).
import { isBusy, runTurn, TurnError, type TurnEvent, type TurnInput } from "@/src/server/agent";
import { defaultStream, resolveModel } from "@/src/server/llm";
import { getSettings } from "@/src/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

function parseInput(body: unknown): TurnInput | null {
  const b = body as Record<string, unknown>;
  if (b?.type === "start" || b?.type === "continue") return { type: b.type };
  if (b?.type === "message" && typeof b.text === "string") return { type: "message", text: b.text };
  if (b?.type === "answer" && typeof b.toolCallId === "string" && b.answer && typeof b.answer === "object") {
    return { type: "answer", toolCallId: b.toolCallId, answer: b.answer as never };
  }
  return null;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const input = parseInput(await req.json().catch(() => null));
  if (!input) return Response.json({ error: "Bad input" }, { status: 400 });
  if (isBusy(id)) return Response.json({ error: "A turn is already running" }, { status: 409 });
  let deps;
  try {
    deps = { stream: await defaultStream(), model: await resolveModel(), reasoning: getSettings().reasoning };
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 503 });
  }
  const enc = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      let open = true;
      const send = (e: TurnEvent) => {
        if (!open) return; // the browser left; the turn keeps running and is saved
        try {
          controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
        } catch {
          open = false;
        }
      };
      try {
        await runTurn(id, input, send, deps);
      } catch (e) {
        send({ type: "error", message: e instanceof TurnError ? e.message : `Unexpected error: ${(e as Error).message}` });
        send({ type: "done" });
      } finally {
        if (open) controller.close();
      }
    },
  });
  return new Response(body, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" },
  });
}
