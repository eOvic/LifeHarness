import { listChats, newChat, type ChatKind } from "@/src/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(listChats());
}

export async function POST(req: Request) {
  const { kind } = (await req.json().catch(() => ({}))) as { kind?: ChatKind };
  if (!kind || !["onboarding", "review", "replan"].includes(kind)) return Response.json({ error: "kind must be onboarding | review | replan" }, { status: 400 });
  return Response.json(newChat(kind));
}
