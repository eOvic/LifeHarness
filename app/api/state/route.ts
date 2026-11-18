import { coverage } from "@/src/core/profile";
import { clock } from "@/src/server/schedule";
import { currentPlan, getPlans, getProfile, getSettings, listChats } from "@/src/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const profile = getProfile();
  return Response.json({
    profile,
    coverage: coverage(profile),
    plan: currentPlan(),
    versions: getPlans().map((p) => ({ version: p.version, adoptedAt: p.adoptedAt, chatId: p.chatId, approach: p.approach })),
    chats: listChats(),
    settings: getSettings(),
    clock: clock(profile),
  });
}
