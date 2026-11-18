// Themes: 12 colors + a mode. The whole UI reads them as CSS variables, so a theme switch
// restyles everything (and the desktop title bar) without a reload.
// Community palettes use their published colors (Catppuccin, Rosé Pine, Gruvbox, Nord).

export const THEME_KEYS = [
  "background", // page
  "surface", // cards, inputs, sidebar
  "border",
  "text",
  "textMuted",
  "accent", // now-line, progress, focus, toggles
  "bold",
  "italic",
  "code",
  "error",
  "success",
  "warning",
] as const;
export type ThemeKey = (typeof THEME_KEYS)[number];

export interface Theme {
  id: string;
  name: string;
  mode: "dark" | "light";
  colors: Record<ThemeKey, string>;
}

const t = (id: string, name: string, mode: Theme["mode"], c: Record<ThemeKey, string>): Theme => ({ id, name, mode, colors: c });

export const THEMES: Theme[] = [
  t("default", "Default", "dark", {
    background: "#141414",
    surface: "#1b1b1b",
    border: "#363636",
    text: "#e7e5e1",
    textMuted: "#8e8b86",
    accent: "#e2b24a",
    bold: "#f2f0ec",
    italic: "#e7e5e1",
    code: "#e7e5e1",
    error: "#ef6b5b",
    success: "#5cc489",
    warning: "#e9a23b",
  }),
  t("paper", "Paper", "light", {
    background: "#faf8f4",
    surface: "#f2efe8",
    border: "#dcd7cc",
    text: "#1f1d1a",
    textMuted: "#77726a",
    accent: "#a8741a",
    bold: "#12110f",
    italic: "#1f1d1a",
    code: "#1f1d1a",
    error: "#c2412d",
    success: "#2f8a55",
    warning: "#b26a12",
  }),
  t("catppuccin-mocha", "Catppuccin Mocha", "dark", {
    background: "#1e1e2e",
    surface: "#262637",
    border: "#45475a",
    text: "#cdd6f4",
    textMuted: "#9399b2",
    accent: "#cba6f7",
    bold: "#b4befe",
    italic: "#f5c2e7",
    code: "#fab387",
    error: "#f38ba8",
    success: "#a6e3a1",
    warning: "#f9e2af",
  }),
  t("catppuccin-latte", "Catppuccin Latte", "light", {
    background: "#eff1f5",
    surface: "#e6e9ef",
    border: "#ccd0da",
    text: "#4c4f69",
    textMuted: "#7c7f93",
    accent: "#8839ef",
    bold: "#1e66f5",
    italic: "#ea76cb",
    code: "#fe640b",
    error: "#d20f39",
    success: "#40a02b",
    warning: "#df8e1d",
  }),
  t("rose-pine", "Rosé Pine", "dark", {
    background: "#191724",
    surface: "#1f1d2e",
    border: "#403d52",
    text: "#e0def4",
    textMuted: "#908caa",
    accent: "#f6c177",
    bold: "#ebbcba",
    italic: "#c4a7e7",
    code: "#9ccfd8",
    error: "#eb6f92",
    success: "#9ccfd8",
    warning: "#f6c177",
  }),
  t("rose-pine-dawn", "Rosé Pine Dawn", "light", {
    background: "#faf4ed",
    surface: "#f4ede8",
    border: "#dfdad9",
    text: "#575279",
    textMuted: "#797593",
    accent: "#d7827e",
    bold: "#286983",
    italic: "#907aa9",
    code: "#56949f",
    error: "#b4637a",
    success: "#286983",
    warning: "#ea9d34",
  }),
  t("gruvbox-dark", "Gruvbox Dark", "dark", {
    background: "#282828",
    surface: "#32302f",
    border: "#504945",
    text: "#ebdbb2",
    textMuted: "#a89984",
    accent: "#fabd2f",
    bold: "#fe8019",
    italic: "#d3869b",
    code: "#8ec07c",
    error: "#fb4934",
    success: "#b8bb26",
    warning: "#fabd2f",
  }),
  t("nord", "Nord", "dark", {
    background: "#2e3440",
    surface: "#343b49",
    border: "#4c566a",
    text: "#eceff4",
    textMuted: "#a3abbd",
    accent: "#88c0d0",
    bold: "#8fbcbb",
    italic: "#b48ead",
    code: "#a3be8c",
    error: "#bf616a",
    success: "#a3be8c",
    warning: "#ebcb8b",
  }),
];

export const DEFAULT_THEME = THEMES[0];

export function themeById(id: string | undefined | null): Theme {
  return THEMES.find((x) => x.id === id) ?? DEFAULT_THEME;
}

/** Readable ink on top of a color (for buttons filled with the accent). */
export function inkOn(hex: string): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.45 ? "#141414" : "#ffffff";
}

/** CSS custom properties for a theme (set on <html>). */
export function themeVars(theme: Theme): Record<string, string> {
  const c = theme.colors;
  return {
    "--bg": c.background,
    "--surface": c.surface,
    "--border": c.border,
    "--text": c.text,
    "--muted": c.textMuted,
    "--accent": c.accent,
    "--accent-ink": inkOn(c.accent),
    "--bold": c.bold,
    "--italic": c.italic,
    "--code": c.code,
    "--error": c.error,
    "--success": c.success,
    "--warning": c.warning,
  };
}
