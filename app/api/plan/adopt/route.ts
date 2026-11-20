import { TurnError } from "@/src/server/agent";
import { syncSoon } from "@/src/server/google-calendar";
import { adoptProposal } from "@/src/server/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { chatId } = (await req.json().catch(() => ({}))) as { chatId?: string };
  if (!chatId) return Response.json({ error: "chatId required" }, { status: 400 });
  try {
    const plan = adoptProposal(chatId);
    syncSoon(); // the Google calendar follows the new plan
    return Response.json(plan);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof TurnError ? e.status : 500 });
  }
}
