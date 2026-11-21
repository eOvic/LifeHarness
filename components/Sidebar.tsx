"use client";
import { CalendarDays, ChartColumn, Compass, PanelLeftClose, Plus, Settings, Sun } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { getJson, postJson } from "@/lib/api";
import { fmt, fmtDuration } from "@/src/core/time";
import { CATEGORIES, type ScheduledBlock, type WeekSchedule } from "@/src/core/types";
import type { ChatSummary } from "@/src/server/store";
import LogoMark from "./LogoMark";
import { cx, IconButton, Label } from "./ui";

const NAV = [
  { href: "/today", label: "Today", icon: Sun },
  { href: "/week", label: "Week", icon: CalendarDays },
  { href: "/review", label: "Review", icon: ChartColumn },
  { href: "/map", label: "Life map", icon: Compass },
];

function ago(iso: string): string {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function status(c: ChatSummary): string {
  if (c.proposal === "adopted") return `Plan v${c.adoptedVersion} adopted`;
  if (c.waiting) return c.phase === "intake" ? `Interview · your turn (${c.questions})` : "Your turn";
  if (c.proposal === "proposed") return "Plan ready to adopt";
  return c.kind === "review" ? "Weekly review" : c.phase === "intake" ? "Interview" : "Planning";
}

export default function Sidebar({ onToggle, mac }: { onToggle: () => void; mac: boolean }) {
  const path = usePathname();
  const [chats, setChats] = useState<ChatSummary[]>([]);
  useEffect(() => {
    const load = () => getJson<ChatSummary[]>("/api/chats").then(setChats).catch(() => {});
    load();
    window.addEventListener("lh:refresh", load);
    const t = setInterval(load, 30_000);
    return () => {
      window.removeEventListener("lh:refresh", load);
      clearInterval(t);
    };
  }, [path]);

  return (
    <aside className="flex h-dvh w-[272px] shrink-0 flex-col border-r border-line bg-canvas">
      <div className="lh-drag lh-traffic flex h-[60px] shrink-0 items-center justify-between pl-4 pr-3">
        <Link href="/" className="flex items-center gap-2.5 text-ink">
          <LogoMark className="lh-traffic-hide h-[26px] w-[26px]" />
          <span className="lh-title text-[19px]">LifeHarness</span>
        </Link>
        <IconButton onClick={onToggle} title={`Hide sidebar (${mac ? "⌘B" : "Ctrl+B"})`}>
          <PanelLeftClose />
        </IconButton>
      </div>

      <nav className="space-y-0.5 px-2 pt-1">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = path === href || path.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={cx(
                "lh-mono flex items-center gap-3 rounded-lg px-3 py-2 text-[12px] uppercase tracking-[0.07em] transition",
                active ? "bg-selected text-ink" : "text-muted hover:bg-hover hover:text-ink",
              )}
            >
              <Icon className="h-[15px] w-[15px]" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-6 flex items-center justify-between pl-5 pr-3">
        <Label>Sessions</Label>
        <NewSession />
      </div>
      <div className="mt-1 min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
        {chats.map((c) => {
          const active = path === `/session/${c.id}`;
          return (
            <Link key={c.id} href={`/session/${c.id}`} className={cx("block rounded-lg px-3 py-2 transition", active ? "bg-selected" : "hover:bg-hover")}>
              <div className="flex items-center gap-2">
                {c.waiting && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" title="Waiting for you" />}
                <span className="truncate text-[14px] text-ink">{c.title}</span>
              </div>
              <div className="lh-mono mt-0.5 truncate text-[11px] text-muted">
                {status(c)} · {ago(c.updatedAt)}
              </div>
            </Link>
          );
        })}
        {!chats.length && <p className="px-3 py-2 text-sm text-muted">No sessions yet.</p>}
      </div>

      <NowCard />

      <div className="border-t border-line px-2 py-2">
        <Link
          href="/settings"
          className={cx(
            "lh-mono flex items-center gap-3 rounded-lg px-3 py-2 text-[12px] uppercase tracking-[0.07em] transition",
            path === "/settings" ? "bg-selected text-ink" : "text-muted hover:bg-hover hover:text-ink",
          )}
        >
          <Settings className="h-[15px] w-[15px]" />
          Settings
        </Link>
      </div>
    </aside>
  );
}

function NewSession() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  const start = async (kind: "replan" | "review" | "onboarding") => {
    setOpen(false);
    const c = await postJson<{ id: string }>("/api/chats", { kind });
    window.dispatchEvent(new Event("lh:refresh"));
    router.push(`/session/${c.id}`);
  };
  return (
    <div ref={ref} className="relative">
      <IconButton onClick={() => setOpen((o) => !o)} title="New session" active={open} className="h-7 w-7">
        <Plus />
      </IconButton>
      {open && (
        <div className="lh-rise absolute right-0 top-8 z-40 w-56 rounded-xl border border-line bg-panel p-1 shadow-xl shadow-black/20">
          {[
            { k: "replan" as const, t: "Change my plan", d: "Something changed or isn't working" },
            { k: "review" as const, t: "Weekly review", d: "What held, what didn't, what to fix" },
            { k: "onboarding" as const, t: "New interview", d: "Start over from scratch" },
          ].map((o) => (
            <button type="button" key={o.k} onClick={() => start(o.k)} className="block w-full rounded-lg px-3 py-2 text-left hover:bg-hover">
              <div className="text-[14px] text-ink">{o.t}</div>
              <div className="text-xs text-muted">{o.d}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type Week = WeekSchedule & { today: string; nowMin: number };

/** Where am I right now? (The desktop "widget", inside the app.) */
function NowCard() {
  const [week, setWeek] = useState<Week | null>(null);
  useEffect(() => {
    const load = () => getJson<Week>("/api/schedule").then(setWeek).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    window.addEventListener("lh:refresh", load);
    return () => {
      clearInterval(t);
      window.removeEventListener("lh:refresh", load);
    };
  }, []);
  const day = week?.days.find((d) => d.date === week.today);
  if (!week || !day || !day.planVersion) return null;
  const now = week.nowMin;
  const blocks = day.blocks.filter((b) => b.source !== "sleep");
  const cur: ScheduledBlock | undefined = blocks.filter((b) => b.start <= now && now < b.end).sort((a, b) => Number(!!a.overlay) - Number(!!b.overlay))[0];
  const next = blocks.find((b) => b.start > now && !b.overlay);
  const color = cur ? CATEGORIES[cur.category].color : undefined;
  return (
    <Link href="/today" className="mx-2 mb-2 block rounded-xl border border-line bg-panel px-3 py-2.5 transition hover:bg-hover">
      <div className="flex items-center justify-between">
        <Label className={cur ? "text-accent" : ""}>{cur ? "Now" : "Free time"}</Label>
        {cur && <span className="lh-mono text-[11px] text-muted">{fmtDuration(cur.end - now)} left</span>}
      </div>
      {cur ? (
        <>
          <div className="mt-1 flex items-center gap-2">
            <span className="h-3 w-1 shrink-0 rounded-full" style={{ background: color }} />
            <span className="truncate text-[14px] font-medium text-ink">{cur.title}</span>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-hover">
            <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(((now - cur.start) / (cur.end - cur.start)) * 100)}%` }} />
          </div>
        </>
      ) : (
        <div className="mt-1 text-[13px] text-muted">Nothing scheduled right now.</div>
      )}
      {next && (
        <div className="lh-mono mt-2 truncate text-[11px] text-muted">
          Next {fmt(next.start)} · {next.title}
        </div>
      )}
    </Link>
  );
}
