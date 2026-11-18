// Answer a prompt of a running sign-in ({prompt, value}) or cancel it ({cancel: true}).
import { answerLogin, cancelLogin } from "@/src/server/connections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ job: string }> }) {
  const { job } = await params;
  const b = (await req.json().catch(() => null)) as { prompt?: unknown; value?: unknown; cancel?: unknown } | null;
  if (b?.cancel === true) return Response.json({ ok: cancelLogin(job) });
  if (typeof b?.prompt !== "string" || typeof b.value !== "string" || b.value.length > 4000) return Response.json({ error: "Bad request" }, { status: 400 });
  const ok = answerLogin(job, b.prompt, b.value);
  return Response.json({ ok }, { status: ok ? 200 : 410 });
}
