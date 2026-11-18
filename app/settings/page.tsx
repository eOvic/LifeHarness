"use client";
import { Check, FolderOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { useAppearance } from "@/components/appearance";
import Connections from "@/components/Connections";
import PageHeader from "@/components/PageHeader";
import { Button, cx, Label, Spinner } from "@/components/ui";
import { getJson, postJson } from "@/lib/api";
import { desktop } from "@/lib/desktop";
import type { ModelInfo } from "@/src/server/llm";
import { PRAYER_METHODS } from "@/src/core/prayer";
import { THEMES } from "@/src/core/themes";
import { DAYS, type Profile } from "@/src/core/types";

type Info = {
  settings: { model?: string; reasoning?: string };
  models: ModelInfo[];
  current: ModelInfo | null;
  dataDir: string;
  configDir: string;
  version: string | null;
  error?: string;
};

const field = "h-9 rounded-lg border border-line bg-panel px-3 text-[14px] text-ink outline-none transition focus:border-muted";

export default function SettingsPage() {
  const { theme, setTheme } = useAppearance();
  const [info, setInfo] = useState<Info | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");

  const load = () => {
    getJson<Info>("/api/settings").then(setInfo).catch(() => {});
    getJson<{ profile: Profile }>("/api/profile").then((p) => {
      setProfile(p.profile);
      setCity(p.profile.location?.city ?? "");
      setCountry(p.profile.location?.country ?? "");
    });
  };
  useEffect(load, []);

  const flash = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(null), 2500);
  };
  const saveSettings = async (patch: object) => {
    await postJson("/api/settings", patch);
    flash("Saved");
    load();
  };
  const patchProfile = async (patch: object) => {
    const r = await postJson<{ message: string; profile: Profile }>("/api/profile", patch);
    setProfile(r.profile);
    flash(r.message.replace(/^Saved: /, "Saved: "));
  };

  return (
    <>
      <PageHeader title="Settings" right={msg && <span className="lh-mono text-[11px] uppercase tracking-[0.07em] text-ok">{msg}</span>} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[880px] space-y-10 px-6 pb-14 pt-7">
          <section id="models" className="scroll-mt-6">
            <Label>AI models</Label>
            {!info ? (
              <div className="mt-3">
                <Spinner />
              </div>
            ) : (
              <div className="mt-3 space-y-6">
                {info.current ? (
                  <div className="space-y-3 rounded-xl border border-line bg-panel px-4 py-3.5">
                    <p className="text-[15px] text-ink" data-lh="current-model">
                      Using <b className="font-semibold">{info.current.name}</b> <span className="text-muted">· {info.current.providerName}</span>
                      {info.current.subscription && <span className="lh-mono ml-2 text-[11px] uppercase tracking-[0.06em] text-muted">subscription</span>}
                    </p>
                    <Row label="Model">
                      <select value={info.settings.model ?? ""} onChange={(e) => saveSettings({ model: e.target.value })} className={cx(field, "w-full max-w-md")} data-lh="model-select">
                        <option value="">Automatic ({info.current.name})</option>
                        {groups(info.models).map(([provider, ms]) => (
                          <optgroup key={provider} label={provider}>
                            {ms.map((m) => (
                              <option key={m.ref} value={m.ref}>
                                {m.name}
                                {m.recommended ? " · recommended" : ""}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </Row>
                    <Row label="Reasoning">
                      <select value={info.settings.reasoning ?? "medium"} onChange={(e) => saveSettings({ reasoning: e.target.value })} className={field}>
                        {["low", "medium", "high"].map((r) => (
                          <option key={r}>{r}</option>
                        ))}
                      </select>
                      <span className="text-sm text-muted">lower = faster, cheaper turns</span>
                    </Row>
                  </div>
                ) : (
                  <p className="rounded-xl border border-accent/40 px-4 py-3 text-[15px] text-ink" data-lh="no-model">
                    No AI model is connected yet. Connect <b>one</b> provider below: a subscription you already have, or an API key.
                  </p>
                )}
                {info.error && <p className="text-sm text-danger">{info.error}</p>}
                <Connections onChange={load} />
              </div>
            )}
          </section>

          <section>
            <Label>Appearance</Label>
            <p className="mt-1 text-sm text-muted">The theme sets every color, including the desktop title bar.</p>
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              {THEMES.map((t) => {
                const on = t.id === theme.id;
                const c = t.colors;
                return (
                  <button
                    type="button"
                    key={t.id}
                    onClick={() => setTheme(t.id)}
                    className={cx("rounded-xl border p-2 text-left transition", on ? "border-ink/70 ring-1 ring-ink/40" : "border-line hover:border-muted")}
                  >
                    <div className="flex h-16 items-center justify-between rounded-lg border px-3" style={{ background: c.background, borderColor: c.border }}>
                      <span style={{ color: c.text }} className="text-[19px]">
                        <span className="lh-title font-bold" style={{ color: c.bold }}>
                          Aa
                        </span>{" "}
                        <i style={{ color: c.italic }}>ai</i>
                      </span>
                      <span className="flex gap-1">
                        {[c.accent, c.error, c.success].map((x, i) => (
                          <i key={i} className="h-2.5 w-2.5 rounded-full" style={{ background: x }} />
                        ))}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between px-1">
                      <span className="flex items-center gap-1 text-[13px] text-ink">
                        {on && <Check className="h-3.5 w-3.5" />}
                        {t.name}
                      </span>
                      <span className="lh-mono rounded border border-line px-1 text-[9.5px] uppercase tracking-[0.06em] text-muted">{t.mode}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {profile && (
            <section>
              <Label>Time</Label>
              <div className="mt-3 space-y-3">
                <Row label="Timezone">
                  <input defaultValue={profile.timezone} onBlur={(e) => e.target.value !== profile.timezone && patchProfile({ timezone: e.target.value })} className={cx(field, "w-64")} />
                </Row>
                <Row label="Week starts">
                  <select value={profile.weekStart ?? "mon"} onChange={(e) => patchProfile({ weekStart: e.target.value })} className={cx(field, "capitalize")}>
                    {DAYS.map((d) => (
                      <option key={d}>{d}</option>
                    ))}
                  </select>
                </Row>
              </div>
            </section>
          )}

          {profile && (
            <section>
              <Label>Prayer times · optional</Label>
              <div className="mt-3 space-y-3">
                <Row label="Enabled">
                  <button
                    type="button"
                    onClick={() => patchProfile({ faith: { enabled: !profile.faith?.enabled } })}
                    className={cx("relative h-6 w-11 rounded-full border transition", profile.faith?.enabled ? "border-accent bg-accent" : "border-line bg-panel")}
                    aria-pressed={!!profile.faith?.enabled}
                  >
                    <span className={cx("absolute top-0.5 h-[18px] w-[18px] rounded-full transition-all", profile.faith?.enabled ? "left-[22px] bg-accent-ink" : "left-0.5 bg-muted")} />
                  </button>
                </Row>
                {profile.faith?.enabled && (
                  <>
                    <Row label="Location">
                      <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" className={cx(field, "w-40")} />
                      <input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Country" className={cx(field, "w-36")} />
                      <Button size="md" onClick={() => patchProfile({ location: { city, country } })}>
                        Find
                      </Button>
                      {profile.location?.lat != null && (
                        <span className="lh-mono text-[11px] text-muted">
                          {profile.location.lat}, {profile.location.lon}
                        </span>
                      )}
                    </Row>
                    <Row label="Method">
                      <select value={profile.faith.prayers?.method ?? "MuslimWorldLeague"} onChange={(e) => patchProfile({ faith: { prayers: { method: e.target.value } } })} className={field}>
                        {PRAYER_METHODS.map((m) => (
                          <option key={m}>{m}</option>
                        ))}
                      </select>
                    </Row>
                    <Row label="Asr">
                      <select value={profile.faith.prayers?.madhab ?? "shafi"} onChange={(e) => patchProfile({ faith: { prayers: { madhab: e.target.value } } })} className={field}>
                        <option value="shafi">Standard (Shafi&apos;i, Maliki, Hanbali)</option>
                        <option value="hanafi">Hanafi</option>
                      </select>
                    </Row>
                  </>
                )}
              </div>
            </section>
          )}

          {info && (
            <section>
              <Label>Data &amp; privacy</Label>
              <div className="mt-3 space-y-3 text-[14px] leading-relaxed">
                <p className="text-ink">
                  Your life map, plans and tracking are plain JSON files on this computer. During a session, the conversation is sent to the AI provider you connected, and
                  nowhere else.
                </p>
                <Folder label="Your data" path={info.dataDir} which="data" />
                <Folder label="Sign-ins & keys" path={info.configDir} which="config" />
                <p className="text-muted">Back up by copying the data folder. Keys are stored in auth.json (readable only by you); disconnect a provider to remove its key.</p>
              </div>
            </section>
          )}

          {info?.version && (
            <section>
              <Label>About</Label>
              <p className="lh-mono mt-3 text-[12px] text-muted">LifeHarness {info.version}</p>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4">
      <span className="w-28 shrink-0 text-[14px] text-muted">{label}</span>
      <div className="flex flex-1 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function groups(models: ModelInfo[]): [string, ModelInfo[]][] {
  const out = new Map<string, ModelInfo[]>();
  for (const m of models) out.set(m.providerName, [...(out.get(m.providerName) ?? []), m]);
  return [...out.entries()].map(([k, v]) => [k, [...v].sort((a, b) => Number(b.recommended) - Number(a.recommended))]);
}

function Folder({ label, path, which }: { label: string; path: string; which: "data" | "config" }) {
  const d = desktop();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="w-32 shrink-0 text-muted">{label}</span>
      <code className="lh-mono min-w-0 truncate rounded bg-panel px-1.5 py-0.5 text-[12px] text-ink">{path}</code>
      {d?.openFolder && (
        <Button size="sm" variant="ghost" onClick={() => d.openFolder!(which)}>
          <FolderOpen className="h-3.5 w-3.5" /> Open
        </Button>
      )}
    </div>
  );
}
