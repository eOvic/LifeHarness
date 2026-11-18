"use client";
// Live theme switching: CSS variables on <html>, persisted to settings, mirrored to the desktop title bar.
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { themeById, themeVars, type Theme } from "@/src/core/themes";
import { desktop } from "@/lib/desktop";

const Ctx = createContext<{ theme: Theme; setTheme: (id: string) => void }>({ theme: themeById(null), setTheme: () => {} });

export function useAppearance() {
  return useContext(Ctx);
}

function apply(theme: Theme) {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(themeVars(theme))) root.style.setProperty(k, v);
  root.classList.toggle("dark", theme.mode === "dark");
  root.classList.toggle("light", theme.mode === "light");
  desktop()?.setChrome({ background: theme.colors.background, symbol: theme.colors.text });
}

export function AppearanceProvider({ initialThemeId, children }: { initialThemeId: string; children: React.ReactNode }) {
  const [theme, setThemeState] = useState(() => themeById(initialThemeId));
  useEffect(() => {
    desktop()?.setChrome({ background: theme.colors.background, symbol: theme.colors.text });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const setTheme = useCallback((id: string) => {
    const t = themeById(id);
    setThemeState(t);
    apply(t);
    fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ theme: t.id }) }).catch(() => {});
  }, []);
  return <Ctx.Provider value={{ theme, setTheme }}>{children}</Ctx.Provider>;
}
