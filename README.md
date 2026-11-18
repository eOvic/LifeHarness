# LifeHarness

**An agent harness for self-development: from what you want in life to a week you can actually live.**

LifeHarness interviews you the way a good coach would, then plans. It works one question at a time and measures two things before it plans anything: where you want to go, and how your days actually run. It then builds the smallest plan that moves every goal you care about, fits that plan around your real constraints, and keeps it honest with tracking and a weekly review.

It's modelled on [LearnHarness](https://github.com/amosblomqvist/learnharness) (measure → plan → teach → practice), applied to self-development instead of learning.

![Interview with a live life map](docs/assets/interview.png)

## How it works

1. **Interview.** About 15 questions, one at a time, each answered with options or your own words, an optional *think out loud* field and, when it matters, a confidence slider. The agent covers:
   - your values and life direction;
   - concrete goals for the year → month → week (each with a measure, a deadline, a why and your confidence);
   - fixed commitments and sleep;
   - optional faith practices, such as prayer times;
   - your energy peak and track record (*what did you actually sustain last time?*);
   - the obstacle that usually wins;
   - the most you'd keep on a bad week.

   Every goal you mention is captured immediately, and your goal list is confirmed and ranked before the interview goes deep on any one goal. A live checklist of strands shows what's still unknown, and the interview can't finish until the scheduler has what it needs.
2. **Plan.** A planner agent designs a goal tree and recurring blocks, and a **deterministic scheduler** places them around your anchors. The scheduler never overlaps blocks, and it reports anything that doesn't fit, with the reason. The planner iterates until every non-negotiable block fits and at least 15% of your awake time stays free, then presents the plan. You adopt it with one click.
3. **Live it.** *Today* shows the current and next block with its if-then plan. Mark each block ✓ ½ ✗ in a second. *Week* shows the whole week visually, and **Export .ics** puts it in your phone's calendar.
4. **Review.** Weekly scores (overall and for non-negotiable blocks), streaks and the weakest block. The coach runs WOOP on that block (wish, outcome, real obstacle, if-then plan) and redesigns the plan when the evidence says the *design* is wrong, not your willpower.

| Plan proposal | The week | Today |
|---|---|---|
| ![](docs/assets/session-plan.png) | ![](docs/assets/week.png) | ![](docs/assets/today.png) |

The method, with the evidence behind each part (goal-setting theory, self-concordance, the planning fallacy, chronotype, implementation intentions, WOOP, progress monitoring), is in **[docs/METHODOLOGY.md](docs/METHODOLOGY.md)**. Sources and how much of each was read are in [docs/research.md](docs/research.md).

## Run it

```bash
npm install
npm run dev          # http://localhost:3210
```

**Models.** LifeHarness uses the Pi engine. If you're logged into [pi](https://pi.dev) (`/login`), it just works with that login. Otherwise, set a provider key such as `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `GEMINI_API_KEY`. Pick the model and reasoning level in **Settings**.

**Data.** Everything is plain JSON in `./data`. Override the location with `LIFEHARNESS_DATA_DIR`, and point at a separate credentials file with `LIFEHARNESS_AUTH_FILE`.

## Develop

```bash
npm test                           # core maths + agent loop with a scripted model (no network)
npm run typecheck
npm run smoke -- --rounds 30       # LIVE: a second model plays a persona through the whole interview → plan
npx tsx scripts/ui-e2e.ts          # drives the real UI in Chrome (server must be running)
npm run shots                      # screenshots of every page into ./shots
```

- Architecture: [docs/architecture.md](docs/architecture.md)
- Next steps (desktop app like LearnHarness, phone sync, other users): [docs/ROADMAP.md](docs/ROADMAP.md)

## Layout

```
prompts/        agent doctrine (interviewer, planner, reviewer + shared): edit these to change behaviour
src/core/       pure logic: scheduler, prayer times, profile merge/coverage, report, .ics
src/server/     storage, Pi model runtime, tools, agent loop, plan versions
app/            Next.js pages + API routes
components/     question dock, week grid, life map, plan panel
```
