# Roadmap

The approach: start with the easiest thing that's genuinely useful, keep it stable, then package it.

## Phase 1: local web MVP ✅ (this commit series)

- Interview → goal tree → scheduled week → adopt → Today (✓ ½ ✗) → weekly review (WOOP).
- Deterministic scheduler with optional prayer anchors; `.ics` export.
- Tests:
  - the core maths;
  - the agent loop, with a scripted model;
  - a live persona smoke test;
  - a browser e2e test.

## Phase 2: make the daily loop excellent

- **Edit without chatting.** Drag a block on the week grid, or mark a one-off "not today" for a block. Small edits go straight into a new plan version.
- **Bad-day mode.** One button collapses today to the core (★) blocks and pushes the rest.
- **Mid-week check-in.** A two-question pulse on the weakest block, before the weekly review.
- **Monthly review.** Goal progress against each `measure`, then re-decompose the next month.
- **Ramadan mode.** UmmAlQura Isha at +120 min, suhoor and iftar anchors, Taraweeh. (An open gap in the scheduler today.)
- **Arabic UI and RTL.** Dark mode.
- **Notifications.** Browser notifications at block starts, plus a gentle "mark today" nudge.
- **Prompt evals.** Run `scripts/smoke-agent.ts` over ~10 diverse personas and score each run:
  - questions asked;
  - strands covered;
  - core blocks placed;
  - slack percentage;
  - persona-judged realism.

  Use the scores to A/B the doctrine.

## Phase 3: a desktop app like LearnHarness

The LearnHarness route:
- Electron launches the Next **standalone** server (`output: "standalone"`) privately on loopback, then loads it in a sandboxed window.
- Package as `.deb`/AppImage with electron-builder, with an in-app updater.
- Data goes in `~/.config/LifeHarness/data`, and credentials stay in the Electron main process.

Desktop extras:
- A **top-bar "now" widget** (e.g. a GNOME Shell extension). It shows the current block, the next one, and ✓ ½ ✗ from the panel.
- Start on login, tray icon, and a "Plan tomorrow" reminder at the evening block.

## Phase 4: on the phone

- **Google Calendar push.** An app-owned calendar under the `calendar.app.created` scope, synced nightly with stable event IDs.
- **PWA.** An installable Today view with offline marks that sync later.
- Possibly a Flutter client later, using the same API.

## Phase 5: other users

- Accounts and a database (SQLite → Postgres). Per-user data directories map cleanly onto rows.
- Credentials: bring-your-own key (as today), or a hosted key with metering.
- Privacy: life maps are sensitive. Encrypt at rest, offer export and delete, and send the model only what each turn needs.
- Onboarding without pi: an API-key entry screen in Settings (`ModelRuntime.setRuntimeApiKey`).
