"use client";
import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { useAppearance } from "@/components/appearance";
import PageHeader from "@/components/PageHeader";
import { Button, cx, Label, Spinner } from "@/components/ui";
import { getJson, postJson } from "@/lib/api";
import { PRAYER_METHODS } from "@/src/core/prayer";
import { THEMES } from "@/src/core/themes";
import { DAYS, type Profile } from "@/src/core/types";

type Info = { settings: { model?: string; reasoning?: string }; models: { ref: string; name: string }[]; current: string | null; dataDir: string; error?: string };

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

          <section>
            <Label>AI model</Label>
            {!info ? (
              <div className="mt-3">
                <Spinner />
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                {info.error && <p className="text-sm text-danger">{info.error}</p>}
                <Row label="Model">
                  <select value={info.settings.model ?? ""} onChange={(e) => saveSettings({ model: e.target.value })} className={cx(field, "w-full max-w-md")}>
                    <option value="">Automatic ({info.current ?? "none"})</option>
                    {info.models.map((m) => (
                      <option key={m.ref} value={m.ref}>
                        {m.ref}
                      </option>
                    ))}
                  </select>
                </Row>
                <Row label="Reasoning">
                  <select value={info.settings.reasoning ?? "medium"} onChange={(e) => saveSettings({ reasoning: e.target.value })} className={field}>
                    {["low", "medium", "high"].map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                  <span className="text-sm text-muted">lower = faster interview turns</span>
                </Row>
                <p className="text-sm text-muted">
                  Credentials come from your pi login (<code className="lh-mono text-[12px]">~/.pi/agent/auth.json</code>) or provider keys like ANTHROPIC_API_KEY.
                </p>
              </div>
            )}
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
              <Label>Data</Label>
              <p className="mt-3 text-[14px] text-ink">
                Everything is plain JSON in <code className="lh-mono rounded bg-panel px-1.5 py-0.5 text-[12px]">{info.dataDir}</code>. Back it up by copying the folder.
              </p>
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
