# Design

LifeHarness looks and feels like a calm desktop instrument. The direction comes from LearnHarness's interface: dark and monochrome by default, typographic, mono chrome around readable prose, serif titles. It's adapted for an app whose main content is a *colorful week*.

The rule of thumb: **the chrome stays quiet, so the person's week is the only color on screen.**

## Tokens

All colors are theme variables, set on `<html>` by the server at first paint. That means no wrong-theme flash, and switching themes is instant.

| Variable | Tailwind | Role |
|---|---|---|
| `--bg` | `bg-canvas` | Page |
| `--surface` | `bg-panel` | Cards, inputs, popovers |
| `--hover` / `--selected` | `bg-hover` / `bg-selected` | Derived from surface + text |
| `--border` / `--line-soft` | `border-line` / `border-line-soft` | Hairlines |
| `--text` / `--muted` | `text-ink` / `text-muted` | Ink |
| `--accent` / `--accent-ink` | `bg-accent` / `text-accent-ink` | Now-line, progress, focus, primary call to action |
| `--bold` `--italic` `--code` | (in `.prose-lh`) | Emphasis inks in agent prose |
| `--error` `--success` `--warning` | `text-danger` `text-ok` `text-warn` | Status |

**Themes** (`src/core/themes.ts`) are 12 colors plus a dark/light mode, the same shape as LearnHarness's theme files:
- **Default** (dark, gold accent) and **Paper** (warm light);
- Catppuccin Mocha and Latte, Rosé Pine and Rosé Pine Dawn, Gruvbox Dark, and Nord, all using their published palettes.

A theme switch also recolors the desktop window's native buttons, via the preload bridge.

## Type

| Face | Use |
|---|---|
| **JetBrains Mono** | Chrome: nav, labels (`.lh-label`: 11px, uppercase, +0.08em tracking), times, counters, pills |
| **Source Sans 3** | Reading: agent prose (`.prose-lh`, 16px / 1.55), answers, block titles |
| **Source Serif 4** (bold, optical size) | Titles (`.lh-title`): page headers, big numbers, the wordmark |

- **Ladder:** 11 · 12.5 · 14 · 16 · 20 · 25 · 32 px.
- **Spacing and radii:** a 4 px rhythm; radii 4 / 8 / 12 / 16.
- **Fonts are self-hosted** at build time (`next/font`), so the desktop app needs no network to render.

## The schedule's colors

Categories are mid-saturation hues (`CATEGORIES` in `src/core/types.ts`) drawn as **tints**: a 3px colored left edge, plus a fill of `color-mix(in oklab, <hue> 20%, var(--bg))`. Text stays in the theme's ink, so the same hues work on dark and light themes.

- **Sleep** is a low-contrast hatch.
- **Overlays** (a prayer break inside work) sit in the right half of their host block.
- **Now** is a 2px accent line with a dot.
- ★ marks a non-negotiable block.

## Layout

- **Shell:** a 272px sidebar and the main column.
  - The sidebar holds: the wordmark, nav (mono uppercase), sessions (with a "your turn" dot), the **Now card** (current block, time left, progress, next), and Settings.
  - The sidebar collapses with **Ctrl+B**, and automatically below 980px. **Ctrl+,** opens Settings.
- **Every page starts with `PageHeader`:** a 60px band with a serif title, mono metadata, and actions on the right. In the desktop app this band *is* the title bar: it's draggable (`.lh-drag`), and `.lh-wco-pad` keeps the right side clear of the native window buttons using `env(titlebar-area-*)`.
- **Session:**
  - the transcript sits in a centered 760px column;
  - your messages are left-ruled blocks labeled "YOU";
  - tool activity is a quiet mono row that expands on click;
  - the answer dock floats at the bottom;
  - the right panel (Life map / Plan) toggles from the header.
- **Question dock** (after LearnHarness's): a mono label ("INTERVIEW · Q7"), the question in prose, option rows with radio or checkbox circles and number-key hints, a dashed "own words" row, a confidence rail, then a **YOUR THINKING** field. Enter answers, Shift+Enter adds a newline, 1–6 picks an option.

## Desktop chrome

- **Frameless:** `titleBarStyle: "hidden"` plus a `titleBarOverlay` in the theme's colors on Linux and Windows; macOS gets hidden-inset traffic lights.
- **No white flash:** the window background is the theme background, and the window shows only on `ready-to-show`.
- **Sizes:** the minimum window is 760 × 560, and size and position are remembered.

## Don'ts

- No raw hex values in components: use the tokens. The only exceptions are the category hues and the theme previews.
- No shadows on cards. Floating surfaces (dock, composer, menus) may have one soft shadow.
- No focus rings from the browser. Surfaces show hover and selected states; inputs show focus with their border.
- Don't color the chrome by category. Category color belongs to blocks and their markers only.
