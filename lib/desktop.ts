// The bridge the desktop app's preload script exposes (absent in a plain browser).
export interface DesktopBridge {
  isDesktop: true;
  platform: string;
  setChrome: (c: { background: string; symbol: string }) => void;
  /** Open one of the app's own folders in the file manager (older shells don't have it). */
  openFolder?: (which: "data" | "config" | "logs" | "licenses") => void;
  /** Re-read reminders, background and login settings now (after saving them or adopting a plan). */
  refreshShell?: () => void;
  /** What this shell can do: starting at login needs the installed app. */
  shellInfo?: () => Promise<{ atLoginSupported: boolean }>;
}

export function desktop(): DesktopBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { lifeharness?: DesktopBridge }).lifeharness;
}
