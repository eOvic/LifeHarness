import path from "node:path";
import { availableModels, authFile, resolveModel, type ModelInfo } from "@/src/server/llm";
import { DATA_DIR, getSettings, saveSettings, type Settings } from "@/src/server/store";
import { THEMES } from "@/src/core/themes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const base = {
    settings: getSettings(),
    dataDir: DATA_DIR,
    configDir: path.dirname(/*turbopackIgnore: true*/ authFile()),
    version: process.env.LIFEHARNESS_VERSION ?? null,
  };
  try {
    const models = await availableModels();
    let current: ModelInfo | null = null;
    try {
      const m = await resolveModel();
      current = models.find((x) => x.ref === `${m.provider}/${m.id}`) ?? null;
    } catch {
      /* nothing connected */
    }
    return Response.json({ ...base, models, current });
  } catch (e) {
    return Response.json({ ...base, models: [], current: null, error: (e as Error).message });
  }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Settings;
  const next: Settings = { ...getSettings() };
  if (typeof body.model === "string" && (body.model === "" || /^[a-z0-9-]+\/\S{1,200}$/.test(body.model))) next.model = body.model || undefined;
  if (body.reasoning && ["minimal", "low", "medium", "high"].includes(body.reasoning)) next.reasoning = body.reasoning;
  if (typeof body.theme === "string" && THEMES.some((t) => t.id === body.theme)) next.theme = body.theme;
  saveSettings(next);
  return Response.json(next);
}
