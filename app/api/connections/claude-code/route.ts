// Claude through the person's own Claude Code sign-in: status, and turning it on or off.
import { listProviders, setClaudeCode } from "@/src/server/connections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const p = (await listProviders()).find((x) => x.id === "claude-code");
  return Response.json({ provider: p });
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { action?: unknown } | null;
  const action = b?.action;
  if (action !== "enable" && action !== "disable" && action !== "check") return Response.json({ error: "action must be enable | disable | check" }, { status: 400 });
  try {
    return Response.json(await setClaudeCode(action));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
