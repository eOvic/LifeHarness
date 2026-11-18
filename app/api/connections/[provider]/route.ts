// Disconnect a provider: removes its stored credential (environment variables are untouched).
import { disconnect } from "@/src/server/connections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(provider)) return Response.json({ error: "Bad provider" }, { status: 400 });
  try {
    await disconnect(provider);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
