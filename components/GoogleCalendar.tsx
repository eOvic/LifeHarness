"use client";
// Settings -> Google Calendar: connect your own Google Cloud client, then LifeHarness keeps a "LifeHarness"
// calendar in step with your plan (src/server/google-calendar.ts). The secret and tokens stay server-side.
import { CalendarCheck, ExternalLink, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button, Label, Spinner } from "@/components/ui";
import { getJson, postJson } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import type { GoogleStatus } from "@/src/server/google-calendar";

const field = "h-9 min-w-0 flex-1 rounded-lg border border-line bg-panel px-3 text-[14px] text-ink outline-none transition focus:border-muted";

export default function GoogleCalendar() {
  const [st, setSt] = useState<GoogleStatus | null>(null);
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => getJson<GoogleStatus>("/api/google").then(setSt).catch(() => {}), []);
  useEffect(() => {
    load();
  }, [load]);
  // While you sign in (or a sync runs), follow along.
  useEffect(() => {
    if (!st?.connecting && !st?.syncing) return;
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, [st?.connecting, st?.syncing, load]);

  const act = async (body: object) => {
    setBusy(true);
    setError(null);
    try {
      const r = await postJson<GoogleStatus>("/api/google", body);
      setSt(r);
      if (r.authUrl && (body as { action: string }).action === "connect") window.open(r.authUrl, "_blank", "noopener");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!st) return null;
  const message = error ?? st.error;
  return (
    <section data-lh="google-calendar">
      <Label>Google Calendar · optional</Label>
      <div className="mt-3 space-y-3 text-[14px] leading-relaxed">
        <p className="text-muted">
          Puts your plan in a separate &ldquo;{st.calendar}&rdquo; calendar in your Google account, with a reminder on each block, so your phone reminds you even when this
          computer is off. LifeHarness can only touch that one calendar. What goes to Google: block titles, times and if-then plans for the next 14 days.
        </p>

        {st.connected ? (
          <div className="flex flex-wrap items-center gap-3" data-lh="google-connected">
            <CalendarCheck className="h-4 w-4 text-ok" />
            <span className="text-ink">
              Connected
              {st.lastSync && (
                <span className="text-muted">
                  {" "}
                  · synced {fmtDateTime(st.lastSync.at)} · {st.lastSync.events} {st.lastSync.events === 1 ? "event" : "events"} in the next 14 days
                </span>
              )}
            </span>
            <Button size="sm" variant="ghost" disabled={busy || st.syncing} onClick={() => act({ action: "sync" })} data-lh="google-sync">
              {st.syncing || busy ? <Spinner /> : <RefreshCw className="h-3.5 w-3.5" />} Sync now
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => confirm("Disconnect Google Calendar? The LifeHarness calendar stays in your Google account; delete it there if you no longer want it.") && act({ action: "disconnect" })}>
              Disconnect
            </Button>
          </div>
        ) : st.connecting ? (
          <div className="flex flex-wrap items-center gap-3" data-lh="google-connecting">
            <Spinner />
            <span className="text-ink">Finish signing in in your browser.</span>
            {st.authUrl && (
              <a href={st.authUrl} target="_blank" rel="noopener noreferrer" className="lh-mono inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.06em] text-muted hover:text-ink">
                Open the sign-in page again <ExternalLink className="h-3 w-3" />
              </a>
            )}
            <Button size="sm" variant="ghost" onClick={() => act({ action: "cancel" })}>
              Cancel
            </Button>
          </div>
        ) : (
          <div className="space-y-2.5" data-lh="google-setup">
            {st.configured ? (
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-muted">Your Google client is saved.</span>
                <Button size="sm" variant="accent" disabled={busy} onClick={() => act({ action: "connect" })} data-lh="google-connect">
                  Connect again
                </Button>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="Client ID (…apps.googleusercontent.com)" className={field} autoComplete="off" spellCheck={false} data-lh="google-client-id" />
                  <input value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="Client secret" type="password" className={field} autoComplete="off" data-lh="google-client-secret" />
                  <Button size="sm" variant="accent" disabled={busy || !clientId.trim() || !secret.trim()} onClick={() => act({ action: "connect", clientId, clientSecret: secret })} data-lh="google-connect">
                    {busy ? <Spinner /> : null} Connect
                  </Button>
                </div>
                <details className="text-[13px] text-muted">
                  <summary className="cursor-pointer select-none hover:text-ink">How to get a Client ID (once, about 10 minutes)</summary>
                  <ol className="mt-2 list-decimal space-y-1 pl-5">
                    <li>At console.cloud.google.com, create a project and enable the Google Calendar API.</li>
                    <li>
                      In Google Auth Platform: Branding (any app name), Audience <b className="text-ink">External</b>, then <b className="text-ink">Publish app</b> (otherwise
                      the connection ends every 7 days).
                    </li>
                    <li>
                      Data access: add only <code className="lh-mono text-[12px]">…/auth/calendar.app.created</code>.
                    </li>
                    <li>Clients: create a client of type Desktop app, and paste its Client ID and secret here.</li>
                  </ol>
                  <p className="mt-2">Google then shows &ldquo;Google hasn&apos;t verified this app&rdquo; once: it&apos;s your own app, so continue.</p>
                </details>
              </>
            )}
          </div>
        )}
        {message && (
          <p className="text-[13px] text-danger" data-lh="google-error">
            {message}
          </p>
        )}
      </div>
    </section>
  );
}
