"use client";
import { PanelLeftOpen } from "lucide-react";
import type { ReactNode } from "react";
import { shortcut, useShell } from "./Shell";
import { cx, IconButton } from "./ui";

/** The 60px band at the top of every page. In the desktop app it is also the window's title bar. */
export default function PageHeader({ title, meta, right }: { title: ReactNode; meta?: ReactNode; right?: ReactNode }) {
  const { sidebarOpen, toggleSidebar, mac } = useShell();
  return (
    <header className={cx("lh-drag lh-wco-pad @container flex h-[60px] shrink-0 items-center gap-3 border-b border-line pl-5", !sidebarOpen && "lh-traffic")}>
      {!sidebarOpen && (
        <IconButton onClick={toggleSidebar} title={`Show sidebar (${shortcut(mac, "B")})`} className="-ml-2">
          <PanelLeftOpen />
        </IconButton>
      )}
      <h1 className="lh-title min-w-0 truncate text-[25px] leading-none">{title}</h1>
      {/* The meta line gives way first: it shrinks long before the title, and hides in narrow headers. */}
      {meta && <div className="lh-mono hidden min-w-0 shrink-[100] truncate pt-1 text-xs text-muted @3xl:block">{meta}</div>}
      <div className="ml-auto flex shrink-0 items-center gap-2">{right}</div>
    </header>
  );
}
