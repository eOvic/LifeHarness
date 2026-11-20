import path from "node:path";
import { availableModels, authFile, resolveModel, type ModelInfo } from "@/src/server/llm";
import { DATA_DIR, getSettings, saveSettings, type Settings } from "@/src/server/store";
import { BEFORE_OPTIONS } from "@/src/core/reminders";
import { syncSoon } from "@/src/server/google-calendar";
import { THEMES } from "@/src/core/themes";
import { isHM } from "@/src/core/time";

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
  if (body.reminders && typeof body.reminders === "object") {
    const r = body.reminders as Record<string, unknown>;
    const out = { ...next.reminders };
    for (const k of ["blocks", "prayers", "evening"] as const) if (typeof r[k] === "boolean") out[k] = r[k] as boolean;
    if (typeof r.before === "number" && BEFORE_OPTIONS.includes(r.before)) out.before = r.before;
    if (isHM(r.eveningAt)) out.eveningAt = r.eveningAt;
    next.reminders = out;
    syncSoon(); // the Google calendar's reminders follow these
  }
  if (typeof body.background === "boolean") next.background = body.background;
  if (typeof body.atLogin === "boolean") next.atLogin = body.atLogin;
  saveSettings(next);
  return Response.json(next);
}
