# Contributing to LifeHarness

Thanks for wanting to help. Bug reports, ideas, documentation fixes and code are all welcome.

## Ways to help

- **Report a bug:** [open an issue](https://github.com/eOvic/LifeHarness/issues/new/choose) and fill in the form. Leave out personal details.
- **Suggest an idea, or ask a question:** use [Discussions](https://github.com/eOvic/LifeHarness/discussions).
- **Improve the guide:** [DOCUMENTATION.md](DOCUMENTATION.md) is plain Markdown. Small fixes can be made right on GitHub with the pencil icon.
- **Write code:** read on.

## Working on the code

You need [Node.js](https://nodejs.org) 22 or newer and Git.

```bash
git clone https://github.com/eOvic/LifeHarness.git && cd LifeHarness
npm install
npm run dev          # the app in your browser, at http://127.0.0.1:3210
npm run desktop      # or the desktop app
npm test             # tests (no network, no real data)
npm run typecheck
```

[docs/development.md](docs/development.md) covers the rest: building installers, testing, and the checks a build must pass. [docs/architecture.md](docs/architecture.md) explains how it works inside, and [AGENTS.md](AGENTS.md) lists the rules the code follows.

A few things matter most:
- **The coaching method comes first.** [docs/METHODOLOGY.md](docs/METHODOLOGY.md) is the reference. Changes to the coach's behaviour go in `prompts/`, and the method document changes with them.
- **The AI decides what goes in the plan; the scheduler decides where.** Never let the model place times directly.
- **Every system counts:** Windows, macOS and Linux. Use `path.join`, ask `src/server/platform.ts` for the OS, and spawn programs without a shell.
- **No real personal data,** in code, tests or screenshots. Use the invented demo data: `npm run seed -- <folder>`.

## Pull requests

1. Open an issue or discussion first for anything big, so we agree on the direction before you spend time on it.
2. Keep each pull request to one change. Add a test when you fix a bug or change the scheduler.
3. `npm run typecheck` and `npm test` must pass.

## License

LifeHarness is licensed under the [GNU AGPL v3](LICENSE). By contributing, you agree that your contribution is licensed under the same terms.
