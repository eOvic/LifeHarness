import { availableModels, resolveModel } from "@/src/server/llm";
import { getSettings, saveSettings, type Settings } from "@/src/server/store";
import { DATA_DIR } from "@/src/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [models, current] = await Promise.all([availableModels(), resolveModel()]);
    return Response.json({ settings: getSettings(), models, current: `${current.provider}/${current.id}`, dataDir: DATA_DIR });
  } catch (e) {
    return Response.json({ settings: getSettings(), models: [], current: null, dataDir: DATA_DIR, error: (e as Error).message });
  }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Settings;
  const next: Settings = { ...getSettings() };
  if (typeof body.model === "string") next.model = body.model || undefined;
  if (body.reasoning && ["minimal", "low", "medium", "high"].includes(body.reasoning)) next.reasoning = body.reasoning;
  saveSettings(next);
  return Response.json(next);
}
