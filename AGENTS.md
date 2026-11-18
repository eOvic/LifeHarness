<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## LifeHarness: notes for agents working on this repo

- **The theory comes first.** `docs/METHODOLOGY.md` is canonical. `prompts/*.md` compress it, and `src/core` enforces what can be enforced. To change agent behaviour, edit the prompts, and update the methodology if the theory changes.
- **The LLM decides *what*; `src/core/scheduler.ts` decides *where*.** Never let the model place times directly. Extend the block spec and the scheduler instead.
- **Check every change:**
  - `npm test`, which has no network. Add a test in `tests/core.test.ts` for every scheduler rule.
  - `npm run typecheck`.
  - `npx next build`.
- **For behaviour changes, run a live check:** `npm run smoke -- --persona "..." --keep` (a second model plays the user). Look at the questions, the captured goals and the proposed blocks.
- **Use a scratch data directory.** User data lives in `./data` (gitignored). Use `LIFEHARNESS_DATA_DIR=$(mktemp -d)` for experiments and never touch real data.
- **Don't `pkill -f "next start"`.** It matches your own shell. Kill by port: `ss -ltnp 'sport = :3210'`.
- **Desktop:**
  - `npm run desktop` runs dev mode, with `--no-sandbox` on Linux because of Ubuntu's userns restriction.
  - `npm run desktop:build [-- --dir] [-- --skip-next]` builds the packages into `dist-desktop/`.
  - The packaged app's data is `~/.config/LifeHarness/data`. Set `LIFEHARNESS_DATA_DIR` when testing so real data isn't touched.
  - `LIFEHARNESS_SHOT=/x.png LIFEHARNESS_SHOT_PATH=/week` makes the shell capture its page and quit.
- **Stopping processes.** Never use `pkill -f` or `ps | grep` patterns that also appear in your own command line: they kill your shell. Use `pgrep -x electron` or `pgrep -x lifeharness` (process names), or kill by port or by saved PID. The packaged app's server renames itself `next-server (v16…)`: check for orphans with `ps -eo comm | grep -c '^next-server'`.
- **Credentials.** The app uses its own `~/.config/LifeHarness/auth.json` (Settings → AI models), never pi's. Tests and QA must use scratch credentials: `LIFEHARNESS_AUTH_FILE=$(mktemp -d)/auth.json`, or `XDG_CONFIG_HOME=$(mktemp -d)` for the packaged app. Don't offer or use Claude Pro/Max sign-in (Anthropic's terms); Claude is API-key only.
- **QA without spending money.** `npm run seed -- <dir>` writes demo data with no model calls. `scripts/qa-connections.ts` exercises every connect path (a deliberately invalid key, sign-in start, device code), saving nothing. `npm run qa:desktop` drives the packaged app at 3 window sizes.
- **Packaging guard.** `desktop:build` copies the AI engine whole and runs `scripts/verify-server.mjs` twice. If it fails, a lazily loaded module is missing: don't ship.
- **One `next dev` per checkout.** Two dev servers sharing `.next/dev` cause an endless reload ("HMR hash mismatch"). Restart `next dev` if pages reload in a loop.
