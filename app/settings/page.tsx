"use client";
import { useEffect, useState } from "react";
import { getJson, postJson } from "@/lib/api";
import { PRAYER_METHODS } from "@/src/core/prayer";
import { DAYS, type Profile } from "@/src/core/types";

type Info = { settings: { model?: string; reasoning?: string }; models: { ref: string; name: string }[]; current: string | null; dataDir: string; error?: string };

export default function SettingsPage() {
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

  const saveSettings = async (patch: object) => {
    await postJson("/api/settings", patch);
    setMsg("Saved.");
    load();
  };
  const patchProfile = async (patch: object) => {
    const r = await postJson<{ message: string; profile: Profile }>("/api/profile", patch);
    setProfile(r.profile);
    setMsg(r.message);
  };

  if (!info || !profile) return <div className="p-10 text-center text-muted">Loading…</div>;
  const faith = profile.faith;
  return (
    <div className="mx-auto max-w-2xl space-y-5 px-5 py-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      {msg && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{msg}</p>}

      <Card title="AI model">
        {info.error && <p className="mb-2 text-sm text-red-600">{info.error}</p>}
        <Row label="Model">
          <select value={info.settings.model ?? ""} onChange={(e) => saveSettings({ model: e.target.value })} className="w-full rounded-lg border border-line bg-white px-2 py-1.5 text-sm">
            <option value="">Automatic ({info.current ?? "none"})</option>
            {info.models.map((m) => (
              <option key={m.ref} value={m.ref}>
                {m.ref}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Reasoning">
          <select value={info.settings.reasoning ?? "medium"} onChange={(e) => saveSettings({ reasoning: e.target.value })} className="rounded-lg border border-line bg-white px-2 py-1.5 text-sm">
            {["low", "medium", "high"].map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
          <span className="ml-2 text-xs text-muted">lower = faster interview turns</span>
        </Row>
        <p className="mt-2 text-xs text-muted">
          Credentials come from pi&apos;s login (<code>~/.pi/agent/auth.json</code>) or provider env vars (ANTHROPIC_API_KEY, OPENAI_API_KEY, …). Set LIFEHARNESS_AUTH_FILE to use a separate file.
        </p>
      </Card>

      <Card title="Time">
        <Row label="Timezone">
          <input defaultValue={profile.timezone} onBlur={(e) => e.target.value !== profile.timezone && patchProfile({ timezone: e.target.value })} className="w-60 rounded-lg border border-line px-2 py-1.5 text-sm" />
        </Row>
        <Row label="Week starts">
          <select value={profile.weekStart ?? "mon"} onChange={(e) => patchProfile({ weekStart: e.target.value })} className="rounded-lg border border-line bg-white px-2 py-1.5 text-sm capitalize">
            {DAYS.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </Row>
      </Card>

      <Card title="Prayer times (optional faith module)">
        <Row label="Enabled">
          <input type="checkbox" checked={!!faith?.enabled} onChange={(e) => patchProfile({ faith: { enabled: e.target.checked } })} className="h-4 w-4 accent-[#5b4bd6]" />
        </Row>
        {faith?.enabled && (
          <>
            <Row label="Location">
              <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" className="w-36 rounded-lg border border-line px-2 py-1.5 text-sm" />
              <input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Country" className="ml-1 w-32 rounded-lg border border-line px-2 py-1.5 text-sm" />
              <button type="button" onClick={() => patchProfile({ location: { city, country, lat: undefined, lon: undefined } })} className="ml-1 rounded-lg border border-line px-2 py-1.5 text-sm hover:bg-gray-50">
                Find
              </button>
              {profile.location?.lat != null && (
                <span className="ml-2 text-xs text-muted">
                  {profile.location.lat}, {profile.location.lon}
                </span>
              )}
            </Row>
            <Row label="Method">
              <select value={faith.prayers?.method ?? "MuslimWorldLeague"} onChange={(e) => patchProfile({ faith: { prayers: { method: e.target.value } } })} className="rounded-lg border border-line bg-white px-2 py-1.5 text-sm">
                {PRAYER_METHODS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </Row>
            <Row label="Asr">
              <select value={faith.prayers?.madhab ?? "shafi"} onChange={(e) => patchProfile({ faith: { prayers: { madhab: e.target.value } } })} className="rounded-lg border border-line bg-white px-2 py-1.5 text-sm">
                <option value="shafi">Standard (Shafi&apos;i, Maliki, Hanbali)</option>
                <option value="hanafi">Hanafi</option>
              </select>
            </Row>
          </>
        )}
      </Card>

      <Card title="Data">
        <p className="text-sm">
          Everything is stored as JSON in <code className="rounded bg-gray-100 px-1">{info.dataDir}</code>. Back it up by copying the folder.
        </p>
      </Card>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 text-sm text-muted">{label}</span>
      <div className="flex flex-1 flex-wrap items-center">{children}</div>
    </div>
  );
}
