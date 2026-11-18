"use client";
import { PanelLeftOpen } from "lucide-react";
import type { ReactNode } from "react";
import { useShell } from "./Shell";
import { IconButton } from "./ui";

/** The 60px band at the top of every page. In the desktop app it is also the window's title bar. */
export default function PageHeader({ title, meta, right }: { title: ReactNode; meta?: ReactNode; right?: ReactNode }) {
  const { sidebarOpen, toggleSidebar } = useShell();
  return (
    <header className="lh-drag lh-wco-pad flex h-[60px] shrink-0 items-center gap-3 border-b border-line pl-5">
      {!sidebarOpen && (
        <IconButton onClick={toggleSidebar} title="Show sidebar (Ctrl+B)" className="-ml-2">
          <PanelLeftOpen />
        </IconButton>
      )}
      <h1 className="lh-title min-w-0 truncate text-[25px] leading-none">{title}</h1>
      {meta && <div className="lh-mono hidden shrink-0 pt-1 text-xs text-muted sm:block">{meta}</div>}
      <div className="ml-auto flex shrink-0 items-center gap-2">{right}</div>
    </header>
  );
}
