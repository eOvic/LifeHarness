# Developing LifeHarness

Next.js 16 (React 19, Tailwind 4) with an Electron desktop shell. The AI runs through the Pi engine (`@earendil-works/pi-ai`, `pi-coding-agent`), plus an optional Claude Code provider. Node.js 22+.

## Run it

```bash
npm install
npm run dev           # the web app at http://127.0.0.1:3210 (loopback only; data in ./data)
npm run desktop       # the same app inside the desktop shell (starts next dev if needed)
```

- **One `next dev` per checkout.** A second one is refused, because they share `.next/dev`.
- **Endless reloading?** If pages ever reload in a loop, restart `next dev`.

## Test

```bash
npm test              # core maths, agent loop, connections, Claude Code bridge (no network)
npm run typecheck
npm run smoke -- --rounds 30 --keep    # LIVE: a second model plays a persona through interview → plan (spends usage)
npx tsx scripts/ui-e2e.ts              # drives the real UI in Chrome (server must be running; LIVE model)
```

**Testing without spending money:**

```bash
npm run seed -- /tmp/demo                     # invented demo data, no model calls (--scene interview for a session in progress)
npm run qa:desktop -- --data /tmp/demo        # drives the packaged app at 1440/960/760 px: console errors, overflow, screenshots
npx tsx scripts/qa-connections.ts --exe dist-desktop/linux-unpacked/lifeharness   # every connect path; nothing is saved
npx tsx scripts/qa-reminders.ts --exe dist-desktop/linux-unpacked/lifeharness --data /tmp/demo   # a reminder shown on time, click, tray, start at login (~2 min)
npx tsx scripts/readme-shots.ts               # regenerates docs/assets from demo data (needs a desktop build)
```

Use scratch folders for experiments, so real data and credentials are never touched:

```bash
LIFEHARNESS_DATA_DIR=$(mktemp -d) LIFEHARNESS_AUTH_FILE=$(mktemp -d)/auth.json npm run dev
```

## Build the desktop app

```bash
npm run desktop:build            # Linux: .deb + AppImage; Windows: LifeHarness-<v>-x64-setup.exe (in dist-desktop/)
npm run desktop:build -- --dir   # unpacked only (faster): dist-desktop/linux-unpacked or win-unpacked
npm run desktop:build -- --win   # on Linux: a portable Windows .zip for testing (the setup .exe needs Windows)
```

**Build each OS on that OS.** Next traces native pieces for the machine it builds on, and the Windows installer (NSIS) can only be made on Windows. The `.exe`'s icon and version info are set on every OS. The installer is per-user (no administrator) and unsigned, so SmartScreen warns until it's code-signed.

**Release builds without rebooting:** `.github/workflows/desktop.yml` builds the Linux installers on Linux and the Windows installer on Windows, on GitHub's machines.
- **Start it by hand:** **Actions → Desktop builds → Run workflow**. The installers are attached to the run.
- **Push a version tag** (`git tag v0.3.4 && git push origin v0.3.4`): it also creates a **draft** GitHub Release with the installers, for you to check and publish.

**On Windows** you need Node.js 22+ and Git, then the same commands work in PowerShell: `npm install`, `npm test`, `npm run dev`, `npm run desktop`, `npm run desktop:build`. The packaged app is then in `dist-desktop\win-unpacked\LifeHarness.exe`, and a per-user install in `%LOCALAPPDATA%\Programs\LifeHarness`. To check an install, run `npx tsx scripts/qa-desktop.ts --data <copy of demo data>`. The tests that use a fake Claude Code are skipped there, because Windows only runs `claude.exe`. The Windows behaviour is tested on every OS in `tests/platform.test.ts`, with `LIFEHARNESS_PLATFORM=win32`. It covers finding Claude Code, saving while another program holds a file, and a window restored off-screen.

The build refuses to ship a broken or leaky package:
- **The AI engine is shipped whole and checked twice.** `scripts/verify-server.mjs` confirms every module can load from the packaged folder.
- **The server folder may contain only runtime files.** A file-system call the bundler can't resolve once pulled the whole project in.
- **Nothing may identify you.** `scripts/privacy-check.mjs` fails the build if your home path, user name or git email appears anywhere in the package.
- **The package names a neutral maintainer.** Set `LIFEHARNESS_MAINTAINER="Name <email>"` to publish under your own.
- **OS checks run at run time.** Turbopack evaluates `process.platform === "…"` at build time wherever it decides a branch, so server code asks `src/server/platform.ts`. The build fails if `claude.exe` is missing from the compiled server, which is the sign that an OS check was decided at build time.
- **No symlinks.** Turbopack imports the AI engine through hashed aliases (`.next/node_modules/<package>-<hash>`, which are symlinks). Symlinks don't survive a Windows installer, so the build points the compiled code at the real packages and removes the aliases.
- **The server dies with the app.** It exits when the desktop shell's end of its stdin closes, even after a crash (`src/server/startup.ts`, run by `instrumentation.ts`). No orphaned server can block an update on Windows.
- **Licenses must ship.** `scripts/after-pack.cjs` puts `LICENSE` and `THIRD_PARTY_NOTICES.txt` in `resources/licenses/`. `scripts/third-party-notices.mjs` writes the notices file. It covers every package in the server and every production dependency the bundles can contain, plus the fonts in `licenses/fonts/`. The build fails if either file is missing.
- **sharp stays out.** Next's image library (sharp and libvips: 47 MB, LGPL) is removed from the server, and `images.unoptimized` keeps Next from loading it. If you add `next/image`, revisit both.

## Licensing

LifeHarness is **AGPL-3.0-only**, like LearnHarness.
- **Adapted code:** code adapted from another project must come under a compatible license, and its file must say where it came from. See the headers of `src/server/claude-code.ts` and `claude-code-bridge.ts`, adapted in part from LearnHarness.
- **New fonts:** add their license to `licenses/fonts/` and to `FONTS` in `scripts/third-party-notices.mjs`.

## Environment variables

| Variable | Use |
|---|---|
| `LIFEHARNESS_DATA_DIR` | Data folder (default `./data`; the desktop app uses `~/.config/LifeHarness/data`) |
| `LIFEHARNESS_CONFIG_DIR` / `LIFEHARNESS_AUTH_FILE` | Where sign-ins and keys live (default `~/.config/LifeHarness/auth.json`) |
| `LIFEHARNESS_MODEL_CATALOG=online` | Allow the engine's background model-catalog refresh (off for privacy) |
| `LIFEHARNESS_ALLOW_HOSTS` | Extra host names the local server answers (it's loopback-only otherwise) |
| `LIFEHARNESS_CLAUDE_BIN` | Use a specific `claude` binary |
| `LIFEHARNESS_DEBUG_CLAUDE=1` | Log why a held Claude Code process was or wasn't reused |
| `LIFEHARNESS_MAINTAINER` | Maintainer named in the packages |

## Project layout

```
prompts/        coaching doctrine (interviewer, planner, reviewer + shared): edit these to change behaviour
src/core/       pure logic: scheduler, prayer times, themes, profile merge/coverage, report, .ics
src/server/     storage, model runtime, connections, Claude Code bridge, tools, agent loop, plans
app/            Next.js pages + API routes (proxy.ts guards them)
components/     shell + sidebar, question dock, week grid, life map, plan panel, AI-model connections
electron/       desktop shell (main + preload); build/ holds the icons, electron-builder.yml the packaging
scripts/        build, verification, seed data, QA and screenshot tools
tests/          vitest suites
```

## More

- [architecture.md](architecture.md): the runtime, connections, the Claude Code provider, security.
- [DESIGN.md](DESIGN.md): the design system.
- [METHODOLOGY.md](METHODOLOGY.md) and [research.md](research.md): the coaching method and its evidence.
- [../AGENTS.md](../AGENTS.md): notes for AI coding agents working on this repo.
