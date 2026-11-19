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

## AI models (Settings)

Modelled on LearnHarness's Providers panel: quiet rows, mono labels, one small action per row.

- **Subscriptions** first ("sign in with a plan you already pay for"): Claude (through Claude Code), ChatGPT, GitHub Copilot, Grok, then "More sign-ins". Claude's Connect either connects at once or opens a numbered setup panel (install, sign in, Check again) with copyable commands. **API keys** second: four featured providers, then "Add another provider".
- **One action per row.** A row reads `Name  blurb ………… [Connect]`. A key row expands in place to `[Paste key…] Save · Cancel · Get a key ↗`; nothing navigates away.
- **Flows stay inline.** A sign-in shows its live state under its row: the sign-in page button (opened automatically in the desktop app), a large device code with Copy and Open, or a paste field when the browser can't come back. It ends in one green sentence ("Connected. LifeHarness will use Claude Sonnet 5.5.") or one red one (the provider's own words, trimmed of JSON).
- **Connected** rows show `✓ CONNECTED · KEY` / `· SUBSCRIPTION` and a ghost Disconnect. Secrets never come back to the page.
- **The same panel goes wherever a model is missing:** the Start page (right under the intro) and a session that can't run (inside the conversation, which then continues by itself).

## Desktop chrome

- **Frameless:** `titleBarStyle: "hidden"` plus a `titleBarOverlay` in the theme's colors on Linux and Windows; macOS gets hidden-inset traffic lights.
- **No white flash:** the window background is the theme background, and the window shows only on `ready-to-show`.
- **Sizes:** the minimum window is 760 × 560, and size and position are remembered. Every page is checked at 1440, 960 (half a 1080p screen, a common way to run it) and 760 px wide.
- **Narrow windows:** the sidebar closes by itself below 900 px but remembers if you open it; the session's side panel slides over the conversation instead of squeezing it when the content area is under 1100 px; header metadata hides before a title would truncate.

## Don'ts

- No raw hex values in components: use the tokens. The only exceptions are the category hues and the theme previews.
- No shadows on cards. Floating surfaces (dock, composer, menus) may have one soft shadow.
- No focus rings from the browser. Surfaces show hover and selected states; inputs show focus with their border.
- Don't color the chrome by category. Category color belongs to blocks and their markers only.
