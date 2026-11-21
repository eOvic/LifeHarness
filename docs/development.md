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
npm run desktop:build            # in dist-desktop/. Linux: .deb + AppImage; Windows: LifeHarness-<v>-x64-setup.exe;
                                 #   macOS: LifeHarness-<v>-arm64.dmg (Apple silicon) + LifeHarness-<v>-x64.dmg (Intel)
npm run desktop:build -- --dir   # unpacked only (faster): dist-desktop/linux-unpacked, win-unpacked, mac-arm64 or mac
npm run desktop:build -- --win   # on Linux: a portable Windows .zip for testing (the setup .exe needs Windows)
npm run desktop:build -- --mac   # off a Mac: the app folders only, to check their contents (unsigned: they can't open on a Mac)
```

**Build each OS on that OS.**
- **Next traces native pieces for the machine it builds on.**
- **Windows:** the installer (NSIS) can only be made on Windows. The `.exe`'s icon and version info are set on every OS. The installer is per-user (no administrator) and unsigned, so SmartScreen warns until it's code-signed.
- **macOS:** the disk images and signing need a Mac. A Mac with Apple silicon builds both chips.

**Release builds without rebooting:** `.github/workflows/desktop.yml` builds each OS's installers on that OS, on GitHub's machines. While the repository is private, a macOS minute uses about 10 times the free allowance of a Linux minute.
- **Start it by hand:** **Actions → Desktop builds → Run workflow**. The installers are attached to the run.
- **Push a version tag** (`git tag v0.3.4 && git push origin v0.3.4`): it also creates a **draft** GitHub Release with the installers, for you to check and publish.

**On Windows** you need Node.js 22+ and Git, then the same commands work in PowerShell: `npm install`, `npm test`, `npm run dev`, `npm run desktop`, `npm run desktop:build`. The packaged app is then in `dist-desktop\win-unpacked\LifeHarness.exe`, and a per-user install in `%LOCALAPPDATA%\Programs\LifeHarness`. To check an install, run `npx tsx scripts/qa-desktop.ts --data <copy of demo data>`. The tests that use a fake Claude Code are skipped there, because Windows only runs `claude.exe`. The Windows behaviour is tested on every OS in `tests/platform.test.ts`, with `LIFEHARNESS_PLATFORM=win32`. It covers finding Claude Code, saving while another program holds a file, and a window restored off-screen.

**On a Mac** you need Node.js 22+ and Git, then the same commands work in Terminal. Two things differ:
- **Signing.** Without an Apple Developer ID, `desktop:build` signs ad hoc: it runs, but macOS asks for **Open Anyway** once, and may refuse its notifications. To sign with a Developer ID and have Apple notarize the app:
  - set `CSC_LINK` (your "Developer ID Application" `.p12`, as a path or base64) and `CSC_KEY_PASSWORD`;
  - for notarization, set `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`;
  - in GitHub Actions, these come from the repository secrets `MAC_CERTIFICATE`, `MAC_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` (see the workflow). Empty values are ignored.
- **The icons.** After changing `build/icon.svg`, run `npx tsx scripts/mac-icons.ts`. It renders `build/icon-mac.png` (Apple's icon grid) and the menu bar's template icons, `electron/trayTemplate*.png`.

The macOS behaviour is also tested on every OS:
- `tests/platform.test.ts` with `LIFEHARNESS_PLATFORM=darwin` covers finding Claude Code from the Dock and where settings live.
- `tests/shell.test.ts` covers the LaunchAgent and the Dock guard.

The build refuses to ship a broken or leaky package:
- **The AI engine is shipped whole and checked twice.** `scripts/verify-server.mjs` confirms every module can load from the packaged folder. With `--os`, prebuilt native add-ons for other OSes may be missing: each package keeps its own OS's. A package for another OS is checked file by file, since its modules can only be loaded there.
- **The server folder may contain only runtime files.** A file-system call the bundler can't resolve once pulled the whole project in.
- **Nothing may identify you.** `scripts/privacy-check.mjs` fails the build if your home path, user name or git email appears anywhere in the package.
- **The package names a neutral maintainer.** Set `LIFEHARNESS_MAINTAINER="Name <email>"` to publish under your own.
- **OS checks run at run time.** Turbopack evaluates `process.platform === "…"` at build time wherever it decides a branch, so server code asks `src/server/platform.ts`. The build fails if `claude.exe` is missing from the compiled server, which is the sign that an OS check was decided at build time.
- **No symlinks.** Turbopack imports the AI engine through hashed aliases (`.next/node_modules/<package>-<hash>`, which are symlinks). Symlinks don't survive a Windows installer, so the build points the compiled code at the real packages and removes the aliases.
- **The server dies with the app.** It exits when the desktop shell's end of its stdin closes, even after a crash (`src/server/startup.ts`, run by `instrumentation.ts`). No orphaned server can block an update on Windows.
- **macOS: no second Dock icon.** The package must contain `server-title-guard.cjs` (see `docs/architecture.md`).
- **Licenses must ship.** `scripts/after-pack.cjs` puts `LICENSE` and `THIRD_PARTY_NOTICES.txt` in `resources/licenses/` (`LifeHarness.app/Contents/Resources/licenses/` on macOS). `scripts/third-party-notices.mjs` writes the notices file. It covers every package in the server and every production dependency the bundles can contain, plus the fonts in `licenses/fonts/`. The build fails if either file is missing.
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
