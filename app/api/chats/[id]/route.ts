import { isBusy } from "@/src/server/agent";
import { deleteChat, getChat } from "@/src/server/store";
import { chatView } from "@/src/server/view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rec = getChat(id);
  if (!rec) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ ...chatView(rec), busy: isBusy(id) });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (isBusy(id)) return Response.json({ error: "Busy" }, { status: 409 });
  deleteChat(id);
  return Response.json({ ok: true });
}
