# The theory of planning a life into a week

This document is the canonical theory layer. The agent prompts in `prompts/` are a compression of it, and the code enforces the parts that can be enforced. It plays the same role as LearnHarness's `teaching-methodology.md`, adapted from *learning a subject* to *living toward goals*.

Every claim carries a tag:

- **[E]** Evidence. Sources are in [research.md](research.md), which also records how much of each source was actually read.
- **[D]** A design decision. It's reasonable, but not proven by a study.

## 1. Two states

A session is bounded by two states, just as a LearnHarness lesson is.

- **Current life.** How time is actually spent now: fixed commitments, sleep, energy across the day, habits that already run, the track record (what was tried and what really happened), and the obstacles that usually win.
- **Goal life.** What the person wants, at every horizon: what they value, a direction for life, then concrete goals for the year, the month and the week.

The interview defines both states precisely. **A vague goal can't be scheduled, and a vague current state can't be planned around.** The interview's precision is the ceiling on the plan's quality. [D]

## 2. A plan is a chain from values to minutes

Every scheduled block traces *up* to a goal, and through it to a value. That rules out orphan busywork. Every active goal traces *down* to recurring time on the calendar, so there is no goal without a home.

- Goals work partly by directing attention toward goal-relevant activity and away from irrelevant activity. [E: G1]
- Errors on complex, dynamic tasks often come from poor *decomposition of a distal goal into proximal goals*. Adding proximal goals to a distal goal raised self-efficacy and performance. That's why the goal tree runs year → month → week. [E: G1]
- Goals consistent with a person's own interests and values ("self-concordant") get more sustained effort and are more likely to be attained. That's why the interview asks *why*, and why goals carry a `why`. [E: G2]

## 3. Goals are concrete, challenging, and owned

- Specific, difficult goals produced higher performance than "do your best" (meta-analytic d ≈ .42–.80), because "do your best" has no external referent. [E: G1]
- The goal–performance link is strongest when people are **committed**. Commitment comes from importance (e.g. making a commitment public) and from **self-efficacy**. That's why goals carry a confidence rating, and why the agent reads confidence against the track record. [E: G1]
- For **new or complex skills**, a specific *learning* goal (discover strategies) can beat a performance goal, which can push people into unsystematic scrambling. That's why the interviewer turns "get good at X" with no clear path into a learning goal. [E: G1]
- **Goal conflict** undermines performance. That's why the interview caps active year goals at about three and parks the rest. [E: G1 for conflict; D for the number 3]

## 4. Capacity is measured, not assumed

People underestimate their *own* completion times. They focus on plan-based scenarios rather than relevant past experience, and the optimistic bias disappeared when participants were told to connect their predictions to past experiences. [E: G3]

So:

- **The interviewer asks for the track record:** "Last time you tried, how many sessions a week did you actually keep, and what broke it?" The plan budgets from that, not from hope. [E: G3 → D]
- **Capacity is binary-searched.** The interviewer proposes a concrete weekly load; a confident yes means raise it, hesitation means lower it. The target is the most the person would keep **on a bad week**. This is the analogue of LearnHarness's floor/ceiling bracketing of understanding. [D]

## 5. The minimal plan

As in LearnHarness's "minimal tree", this means the smallest set of recurring blocks that moves every active goal. Habits that already run are left alone. Nothing off the path gets added, however "productive" it sounds. [D]

**Slack is structural.** The planner keeps at least 15% of awake time unallocated across the week. A plan with zero slack fails at the first disruption, which looks like a commitment problem but is really a design problem. [D, see research.md: Commitment and tracking]

## 6. Time of day is personal

Cognitive performance varies across the day, and it depends on **chronotype**: specifically, on the match between a person's circadian peak and the time of the task. [E: G4]

That's why the interviewer *asks* when the person is sharpest instead of assuming mornings. The planner then puts high-energy work in that peak window and shallow work in the troughs.

A single bout of exercise gives a small-to-medium boost to cognition, with the largest benefit measured right after exercise. That's why the planner places workouts before hard thinking blocks when it can. [E: S5]

## 7. Anchors first, and two kinds of block

**Anchors are placed first.** Sleep, fixed commitments and, for people who want them, prayer times go on the calendar before anything else. Everything else is built around them. [D]

**Sleep consistency matters,** not only its length: inconsistent sleep correlated with lower grades. [E: S6]

**Faith practices are first-class constraints when a person holds them, and never assumed.** Prayers that fall inside a commitment move to right after it *only if the prayer's time window is still open by then*, including travel. Otherwise they become a short break inside the commitment. [D]

**Core versus flexible.** A few blocks are marked non-negotiable (★). On a disrupted day those are protected first, and the review scores them separately. [D]

## 8. If-then plans bind blocks to cues

- Implementation intentions ("If situation X, then I do Y") helped across 642 tests (d ≈ .27–.66). Effects were larger when the plan was in if-then form, the goal mattered to the person, and the plan was rehearsed. [E: C1]
- Mental contrasting with implementation intentions (WOOP: Wish → Outcome → Obstacle → Plan) has a small-to-medium overall effect (g ≈ .34; about .24 after correcting for publication bias). [E: C2]

So:

- Every core block gets an if-then plan tied to a concrete cue.
- Small daily habits are chained to anchors that already happen ("after Fajr", "after wake").
- The weekly review runs WOOP on the weakest block.

## 9. Feedback closes the loop

- Goals combined with **feedback** beat goals alone. Without feedback, people can't adjust their effort or strategy. [E: G1]
- Prompting people to monitor their progress improved goal attainment (d ≈ .40). [E: C3, snippet only]
- In a habit-formation study, missing a single opportunity to perform the behaviour did not materially affect habit formation. [E: G5, abstract snippet only]

So marking is one tap per block (✓ ½ ✗). The score counts marked blocks only, and unmarked blocks are a *tracking* problem, not a moral one. The review treats a low score as a **design signal first**: wrong time, wrong length, no cue, competing demand. [D]

## 10. The plan moves with the person

The first plan is a hypothesis. Tracking and the weekly review are measurement. Revising the plan is the normal, expected event, just as LearnHarness's lesson map is rewritten when teaching reveals something the probe missed. [D]

- Plans are versioned. A new version applies from its adoption date, so history is never rewritten.
- Lessons about how this particular person works (with evidence) are stored in the life map and read by every future plan. [D]

## 11. The system owns the logistics

The person's effort goes into deciding what matters and then doing it. Interviewing, remembering, time arithmetic, calendar placement and pattern-spotting all belong to the system. In practice:

- The LLM decides **what** matters: the goals, and the block specs.
- A **deterministic scheduler** decides **where** each block goes. It never overlaps blocks, never miscounts minutes, and reports what doesn't fit together with the reason. [D]

## 12. What this demands of the implementation

| Theory | Implementation |
|---|---|
| Precise states (§1) | Strands with a coverage checklist (`src/core/profile.ts`); `intake_done` is refused while required strands are missing |
| One question at a time, using every answer (§1, §4) | `ask_question` pauses the turn. The answer carries the selection, the person's own words, a thinking field and a confidence rating |
| Values → minutes (§2) | Goal tree linked by `parentId`. Every block has a `goalId`. The scheduler report shows hours per goal and flags year goals with no time |
| Concrete and owned (§3) | Goals carry `measure`, `deadline`, `why` and `confidence`. Learning-goal `kind` |
| Measured capacity (§4) | `history` and `capacity` strands; the binary-search doctrine in `prompts/intake.md` |
| Minimal plan with slack (§5) | `propose_plan` reports free %, unplaced blocks and missing core blocks; the planner iterates before presenting |
| Personal peak (§6) | `energy.peak` window; blocks with `window: "peak"` |
| Anchors first (§7) | Sleep rules (including relative to prayers), fixed commitments with travel, prayer windows, ★ core |
| If-then (§8) | `ifThen` on blocks, `add_if_then`, WOOP in `prompts/review.md` |
| Feedback (§9) | Today ✓ ½ ✗, `src/core/report.ts`: core score, streaks, weakest block |
| Plan moves (§10) | Versioned plans with profile snapshots; `add_lesson` |
| System owns logistics (§11) | `src/core/scheduler.ts`; `.ics` export |
