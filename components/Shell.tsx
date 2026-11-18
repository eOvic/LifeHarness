"use client";
// The desktop-style frame: a collapsible sidebar and a main column. Pages render their own
// PageHeader (the 60px band that doubles as the window title bar in the desktop app).
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "./Sidebar";

const ShellCtx = createContext<{ sidebarOpen: boolean; toggleSidebar: () => void }>({ sidebarOpen: true, toggleSidebar: () => {} });
export const useShell = () => useContext(ShellCtx);

/** Pages call this after changing sessions so the sidebar list refreshes. */
export function refreshSidebar() {
  window.dispatchEvent(new Event("lh:refresh"));
}

/** Below this window width the sidebar closes by itself (it reopens when there's room again). */
const AUTOCLOSE = 900;

export default function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  useEffect(() => {
    // An explicit choice ("open"/"closed") is remembered; with none, open when there's room.
    const saved = localStorage.getItem("lh.sidebar");
    let wide = window.innerWidth >= AUTOCLOSE;
    setOpen(saved === "open" || (saved !== "closed" && wide));
    const onResize = () => {
      const now = window.innerWidth >= AUTOCLOSE;
      if (now === wide) return; // only react when crossing the threshold
      wide = now;
      setOpen(now ? localStorage.getItem("lh.sidebar") !== "closed" : false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const toggleSidebar = useCallback(() => {
    setOpen((o) => {
      localStorage.setItem("lh.sidebar", o ? "closed" : "open");
      return !o;
    });
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === "b") {
        e.preventDefault();
        toggleSidebar();
      } else if (e.key === ",") {
        e.preventDefault();
        router.push("/settings");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleSidebar, router]);

  return (
    <ShellCtx.Provider value={{ sidebarOpen: open, toggleSidebar }}>
      <div className="flex h-dvh overflow-hidden">
        {open && <Sidebar onToggle={toggleSidebar} />}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
      </div>
    </ShellCtx.Provider>
  );
}
