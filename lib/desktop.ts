// The bridge the desktop app's preload script exposes (absent in a plain browser).
export interface DesktopBridge {
  isDesktop: true;
  platform: string;
  setChrome: (c: { background: string; symbol: string }) => void;
}

export function desktop(): DesktopBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { lifeharness?: DesktopBridge }).lifeharness;
}
