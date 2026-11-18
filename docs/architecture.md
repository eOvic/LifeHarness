# Architecture

LifeHarness is a Next.js app. The server owns the agent turns, storage and scheduling; the browser renders projections of them. The model layer is the Pi engine (`@earendil-works/pi-ai` + `pi-coding-agent`'s `ModelRuntime`), which is also what LearnHarness is built on.

```mermaid
flowchart LR
    UI[Browser: session / today / week / review] -->|POST turn| API[app/api/chats/:id/turn]
    API -->|NDJSON stream| UI
    API --> LOOP[src/server/agent.ts: runTurn]
    LOOP -->|systemPrompt + messages + tools| PI[Pi ModelRuntime.streamSimple]
    LOOP --> TOOLS[src/server/tools.ts]
    TOOLS --> MAP[(profile.json: life map)]
    TOOLS --> SCHED[src/core/scheduler.ts]
    SCHED --> PRAY[src/core/prayer.ts, adhan]
    LOOP --> CHATS[(chats/*.json)]
    UI -->|Adopt| ADOPT[api/plan/adopt] --> PLANS[(plans.json: versions + snapshots)]
    UI -->|✓ ½ ✗| TRACK[(tracking.json)]
    PLANS --> WEEK[src/server/schedule.ts] --> UI
    TRACK --> REPORT[src/core/report.ts] --> UI
```

## Code layout

| Path | Role |
|---|---|
| `src/core/` | Pure domain logic, no IO: types, time maths, prayer times, **scheduler**, profile merge + coverage, tracking report, `.ics` export |
| `src/server/` | Storage (JSON files), model runtime, prompt composition, tools, the agent loop, plan adoption, the view projection |
| `prompts/` | Agent doctrine: `base.md`, `intake.md` (interviewer), `planner.md`, `review.md`, and the `shared/` fragments |
| `app/` | Next.js pages and API routes |
| `components/` | The question dock, week grid, life map, plan panel |
| `tests/` | vitest: core maths, plus the agent loop with a scripted model (no network) |
| `scripts/` | `smoke-agent.ts` (a live model plays a persona end to end), `ui-e2e.ts` (drives the browser), `screenshots.ts` |

## Agent turns

A **turn** is one input from the person, followed by model calls until the agent asks a question or stops.

1. **Apply the input.**
   - A first `start`, a message, or an answer to the open question.
   - An answer becomes the `toolResult` of the `ask_question` call that asked it.
   - A typed message while a question is open counts as that question's answer.
2. **Call the model** with the system prompt for the current phase and that phase's tools:
   - `intake`: ask_question, update_profile, intake_done
   - `plan`: ask_question, update_profile, propose_plan, add_if_then
   - `review`: ask_question, update_profile, propose_plan, add_if_then, add_lesson
3. **Execute server tools** immediately. Arguments are validated against the JSON schemas; invalid calls return an error the model can correct.
   - `ask_question` pauses the turn. Only one question per turn: a second question in the same message is rejected.
4. **Hand off.** `intake_done` succeeds only when the required strands are covered. It switches the conversation to the planner, which continues in the same turn, mirroring LearnHarness's prober → teacher handoff.
5. **Save as you go.** Every model call is saved. A failed call can be retried (`continue`).

The browser receives NDJSON events:
- `status`
- `text` (deltas)
- `tool`
- `chat` (a full view snapshot)
- `error`
- `done`

## The system prompt

The system prompt is assembled from three parts, in this order:
1. The static doctrine: base + phase file + shared fragments.
2. The live context: the date and time, the life map as JSON, the open strands, the adopted plan, and, in a review, the week's tracking report.

## The scheduler

This is the deterministic core: the LLM proposes block *specs*, and code places them. Each day is filled in this order:

1. **Sleep.** A bed rule and a wake rule, or a bed rule plus a number of hours. Rules may be relative to a prayer (`{anchor: "isha", offsetMin: 80}`). Sleep may cross midnight.
2. **Fixed commitments,** with optional travel before and after.
3. **Prayers** (optional, via `adhan`):
   - Each prayer block starts 5 minutes before the adhan.
   - Friday Dhuhr becomes Jumu'ah.
   - A prayer inside a commitment moves to right after it *only if its window (up to the next adhan) is still open*, counting travel. Otherwise it becomes an overlay: a prayer break inside the commitment.
   - A Fajr that falls during sleep splits the sleep.
4. **Flexible blocks.**
   - Placement order: anchored blocks first (`after` / `before` a reference: wake, bed, a prayer, `block:<id>` or `fixed:<id>`; or `fill` the gap between two), then core blocks, then by priority, energy and length.
   - A block anchored to another block is always placed after it (topological order).
   - Days are explicit, or chosen by `timesPerWeek` with workdays first, falling back to the days with the most free time.
   - Each block lands in the earliest free slot inside its window. A `before` anchor takes the latest slot instead.
5. **Report.** Blocks that couldn't be placed are reported with the reason (e.g. "no free 90-min slot in 06:00–10:00, largest gap 45 min"), together with:
   - free time per day and as a percentage of awake time;
   - hours per goal and per category;
   - any overlap warnings.

## Plans and history

`plans.json` holds immutable versions. Each version stores:
- the goal tree and blocks;
- a **snapshot** of the scheduling-relevant profile.

For a past date, the version in force on that date is used; future dates use the latest version. Adopting a new plan therefore never rewrites earlier days or how they were tracked.

## Storage

Everything is plain JSON under `LIFEHARNESS_DATA_DIR` (default `./data`):

| File | Contents |
|---|---|
| `profile.json` | The life map |
| `plans.json` | Plan versions |
| `tracking.json` | `date → block key → {status, title, core, category}` |
| `chats/*.json` | Native Pi messages, the open question, answers, the latest proposal, usage |
| `settings.json` | The chosen model and reasoning level |

Writes go to a temp file and are then renamed into place. One server process should own a data directory.

## Desktop shell

`electron/main.cjs` turns the web app into a desktop app the same way LearnHarness does.

**Packaged startup.** The shell:
1. picks a free `127.0.0.1` port;
2. spawns `resources/server/server.js` (the Next **standalone** build) with `process.execPath` and `ELECTRON_RUN_AS_NODE=1`, so no separate Node install is needed;
3. sets `LIFEHARNESS_DATA_DIR=~/.config/LifeHarness/data`, `LIFEHARNESS_AUTH_FILE=~/.config/LifeHarness/auth.json`, the per-launch `LIFEHARNESS_API_SECRET` and the version;
4. polls `/api/health`, then loads the app;
5. if the server dies, restarts it on the same port and reloads the window (gives up with a dialog after 3 exits in a minute);
6. on quit, stops the server. Its process is named `next-server (v16…)`, not `lifeharness`.

Logs (`main.log`, `server.log`) rotate past 5 MB. A right-click menu provides cut/copy/paste, spelling suggestions and link actions (Electron has none by default). Settings' "Open" buttons ask the shell to open the data, config or logs folder by name; the page can't pass a path.

**Dev mode.** `npm run desktop` runs `scripts/desktop-dev.mjs`, which starts or reuses `next dev` (on 127.0.0.1), warms up its routes, and opens the shell with `LIFEHARNESS_DEV_URL`. Run only one `next dev` per checkout: two servers sharing `.next/dev` put the page in an endless "HMR hash mismatch" reload. If a dev page ever reloads in a loop, restart `next dev`.

**Window.** It's frameless:
- On Linux and Windows, `titleBarOverlay` draws the native buttons in the theme's colors. The renderer reports theme changes through the preload bridge (`window.lifeharness.setChrome`).
- The page's 60px headers are the drag region, and `env(titlebar-area-*)` keeps their content clear of the buttons.
- The background matches the theme, and the window shows on `ready-to-show`.
- Size and position are persisted.

**Security.**
- `contextIsolation`, `sandbox: true`, no Node in the page.
- Permission requests are denied, except clipboard writes.
- Navigation is pinned to the app's origin, and external links open in the default browser.

**Packaging.** `npm run desktop:build`:
1. builds the standalone server (`LIFEHARNESS_STANDALONE=1 next build`);
2. assembles the server and ships the AI engine **whole**: Next's file tracing only follows static imports, and pi loads its sign-in flows and provider SDKs lazily, so tracing alone shipped about a quarter of it (the first packaged build failed at the first model call). `scripts/server-deps.mjs` copies the full production dependency closure of the external packages, and `scripts/verify-server.mjs` checks it twice (staging folder, then the packaged app): every file present, and every pi-ai module importable from inside the server folder;
3. stages a dependency-free app folder (`desktop-app/`: main, preload, icon);
4. runs electron-builder, whose `afterPack` hook copies the server, including its `node_modules` and Turbopack's relative symlinks, into `resources/server`;
5. outputs a `.deb` (with an AppArmor profile for Ubuntu 24.04+'s user-namespace restriction) and an AppImage.

## Credentials and model choice

LifeHarness owns its credentials. `src/server/llm.ts` creates pi's `ModelRuntime` with `<config>/auth.json` and `<config>/models.json`, where `<config>` is `~/.config/LifeHarness` (the desktop app's userData; `LIFEHARNESS_CONFIG_DIR` / `LIFEHARNESS_AUTH_FILE` override). It never reads or writes `~/.pi`. Provider environment variables also count as connections.

**Connecting** (`src/server/connections.ts`, Settings → AI models) goes through pi's own `login(provider, "oauth" | "api_key", interaction)`:
- A sign-in is a *login job*. pi drives the flow; its prompts ("paste the redirect URL", "enterprise domain?") and events (open this URL, enter this device code) stream to the page as NDJSON from `POST /api/connections/login`, and answers come back on `POST /api/connections/login/<job>`. Closing the stream cancels the job (freeing callback ports such as 1455).
- An API key is cleaned (no whitespace; keys starting with `!` are refused, because pi runs those as shell commands), then tested with one tiny request while held in memory only (`setRuntimeApiKey`). A key the provider rejects is never saved.
- Claude Pro/Max sign-in is not offered: Anthropic doesn't allow third-party apps to use it. Claude is available with an API key.
- After a connect, the app adopts the provider's recommended model unless a working model was already picked. Recommendations favour each provider's strong, balanced model (`PREFERENCES` in `llm.ts`; e.g. the newest Sonnet, not Opus).

**Errors** a person can act on: `errors.ts` maps provider failures (rejected key, quota, network, overload, missing engine files) to one sentence and an action (`connect` or `retry`). Sessions keep the raw text as detail. A turn that can't start because nothing is connected returns 503 with `action: "connect"`, and the session shows the connect panel, then re-sends the same input once a model is connected.

## Local server security

The server holds the life map and the credentials, so `proxy.ts` (Next 16's middleware) guards every request:
1. **Loopback only.** `Host` must be `localhost`, `127.x.x.x` or `[::1]`, which defeats DNS rebinding. `npm run dev` / `npm start` also bind to 127.0.0.1, never the LAN.
2. **Same-origin writes.** Non-GET requests from another site (`Sec-Fetch-Site`, `Origin`) are refused, which stops CSRF.
3. **Desktop secret.** The Electron shell generates a random secret per launch, passes it to the server (`LIFEHARNESS_API_SECRET`), and adds it as a header to requests for the app's own origin only (it strips it from everything else, including redirects). Without it, every route except `/api/health` answers 403, so other users and processes on the machine can't use the API.
