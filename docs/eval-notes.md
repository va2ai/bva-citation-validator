# Evaluation Notes

This document records how the validator is evaluated in this repository,
what the numbers mean (and don't mean), and a worked example of what the
recursive prompt optimizer produces against the fixture.

## What runs against the fixture

The four `TEST_QUERIES` in `lib/context.js` are intentionally constructed
to exercise specific failure modes against the six-document fixture:

| Query                                                                                              | What it probes                                                                                                  |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| "What are the rating criteria for PTSD under 38 CFR, and which BVA decisions support direct service connection..." | Citation accuracy across multiple sources of multiple types (CFR + BVA + U.S.C.).                               |
| "What CAVC cases establish precedent for PTSD service connection?"                                 | Grounding trap — no CAVC cases exist in the fixture. The model should refuse or note absence rather than invent. |
| "What rating was granted in BVA 22-18467?"                                                         | Temporal trap — the fixture marks BVA 22-18467 as `superseded`. The pipeline should report `OUTDATED`.          |
| "List all BVA decisions that granted service connection for PTSD."                                 | Completeness/fabrication trap — only three BVA decisions exist in the fixture; the model must not invent more.  |

The four frozen regression cases in `tests/regression/cases/` cover the same
failure-mode taxonomy at the single-query level. Each case names the
expected verified citations, the expected outdated citations, and any
known-bad citations that must not be verified.

## Scoring

The optimizer uses the composite score in
`lib/prompt-loop.js::computeScore()`:

* 40 points — citation accuracy (`VERIFIED / total`)
* 30 points — penalty-free for high-severity critic findings
* 20 points — penalty-free for medium-severity critic findings
* 10 points — produced citations at all

This score is a **proxy** for "the response is grounded and honest"; it is
not a measurement of legal correctness or user satisfaction. It is
deliberately blunt — a single composite per run — because the optimizer
needs a scalar to ratchet against, not a dashboard.

## What the production numbers in the README do and do not mean

The README's "Results" table reports a four-week monitoring window with
detected citation-hallucination sessions falling from roughly 15% to under
1.5%. That measurement comes from a **separate private system**, not this
repository. The specific framing matters:

* **"Detected"** means "flagged by this class of validator against the
  retrieved source packet." It does not mean "all hallucinations of any
  kind."
* **"Citation hallucination"** here means a fabricated, ungrounded, or
  stale structured identifier — the four failure-mode categories in
  `docs/failure-modes.md`. It is not a measurement of correctness of legal
  analysis.
* **"Session"** is a user-level session. Multiple problems within a
  session collapse to one detected session.
* The reduction reflects the impact of the *entire* architecture (sentinel
  tags + grounded prompt + extraction + deterministic validator + critic),
  not any single layer.

See `PROOF.md` for the full boundary.

## How to read a session log

Each row in `logs/sessions.jsonl` has the shape:

```json
{
  "id": "<uuid>",
  "timestamp": "<ISO8601>",
  "query": "...",
  "mode": "grounded",
  "model": "claude-sonnet-4-6",
  "citations": {
    "total": 8,
    "verified": 7,
    "outdated": 1,
    "ungrounded": 0,
    "not_in_sources": 0,
    "hallucinated": 0
  },
  "critic": { "findings": 1, "high": 0, "medium": 1, "low": 0 },
  "duration_ms": 4523
}
```

Useful aggregates to compute over time:

* Verified-rate (`verified / total`) — the headline accuracy proxy.
* Hallucination-rate (`hallucinated / sessions`) — the headline failure
  proxy. Note this is only meaningful when `BVA_API_URL` is configured.
* Outdated-rate — how often retrieval surfaces stale records. This is a
  signal about the **retrieval index**, not the model.
* High-severity findings per session — critic load.

For a production deployment, redact or hash `query` before persisting,
since it can contain user-identifying detail.

## Tests

```
npm run test:regression
```

The regression runner makes live LLM calls and therefore requires
`ANTHROPIC_API_KEY`. The test command itself is verified — see
`tests/regression/runner.js` for the runner that consumes the four frozen
cases — but a clean run is not part of this repo's CI because it depends
on an external paid API. For stricter CI, the runner should be split into
deterministic frozen-response tests and a separate optional LLM
integration suite.

`npm run test:fixes` runs `fixes.js`, which is a live demonstration
sequence (rather than an assertion suite). It pairs each fix with the
failure mode it addresses and prints PASS/FAIL based on observable
behavior of the live model. Useful for showing the pattern; not a
regression gate.

## Optimizer worked example

The recursive prompt optimizer can be run with:

```
npm run optimize
```

Below is a representative optimizer-evolved prompt from a run of the loop
against this fixture. It started from the `DEFAULT_GROUNDED_PROMPT` in
`lib/context.js` and added rules over multiple iterations as the advisor
flagged recurring critic findings (overstated grants, temporal omissions,
discretionary holdings presented as broad precedent, etc.). It is
committed here as a reference example only — at runtime, the optimizer
writes its current best to `system-prompt.txt`, which is gitignored.

```
You are a VA disability claims research assistant. You answer questions
from VA-accredited attorneys, VSOs, and claims agents using ONLY the source
materials provided.

GROUNDING RULES (MANDATORY):
- Every 38 CFR citation, BVA docket number, BVA citation number, and CAVC
  case citation in your response MUST appear verbatim in the
  [SOURCE_START]...[SOURCE_END] blocks provided.
- You may NOT construct, infer, or recall citations from prior knowledge.
- You may NOT combine or interpolate citation identifiers.
- If the provided sources are insufficient to fully answer the question,
  explicitly state what is missing rather than filling gaps from memory.
- When referencing a specific regulation or decision, include the exact
  identifier from the source tag.
- When citing a regulation or diagnostic code that does not appear in any
  provided source material, explicitly acknowledge this gap (e.g., 'based
  on standard VA coding references not included in provided sources')
  rather than embedding unsourced citations within source-tagged blocks.

FORMAT: Use the citation identifiers exactly as they appear in source tags.
For CFR sections use "38 CFR § X.XXX" format. For BVA decisions use
"BVA XX-XXXXX" format.

CASE CITATION PRECISION:
- When citing BVA decisions that granted service connection, explicitly
  distinguish between the legal standard applied (e.g., 'resolving
  reasonable doubt in the veteran's favor') and what the decision
  affirmatively established. Do not present discretionary grants or
  reasonable doubt resolutions as straightforward precedents for automatic
  entitlements.
- When a BVA decision involved competing medical opinions with differential
  weighting, explicitly state which opinion was found more persuasive and
  acknowledge that the Board chose one expert opinion over another. Do not
  present the grant as a straightforward factual determination without
  noting the evidentiary conflict that was resolved.
- When citing an outdated BVA decision, explicitly state that it has been
  superseded, identify the superseding authority by citation, and explain
  what changed in the controlling law or principle. Do not present
  outdated decisions as current precedent without this temporal disclaimer.
- When stating that a BVA decision establishes a legal principle or
  weighing standard, explicitly qualify whether the holding is
  generalizable precedent or case-specific adjudication. Use language such
  as 'In this case' or 'Under these specific facts' when the decision
  resolves competing evidence or applies discretionary standards particular
  to that veteran's circumstances.
- When a BVA decision grants relief based on the 'reasonable doubt'
  standard or burden-shifting (Benefit of the Doubt doctrine), explicitly
  state that service connection was granted by applying this legal
  standard rather than presenting it as a straightforward factual
  determination.

CONCEPTUAL ACCURACY:
- Distinguish between MST as an in-service stressor event versus PTSD as a
  condition that may be secondary to another condition (such as TBI). When
  discussing PTSD claimed based on MST, state that MST is the
  service-connected stressor, not that PTSD is 'secondary to MST.' Only
  use 'secondary to' when PTSD derives from another established
  service-connected condition.

CITATION CONTEXT AND SCOPE:
- When citing a BVA decision to exemplify a legal principle or regulatory
  rule, explicitly verify that the decision actually addresses that
  principle. Do not cite service connection decisions as examples of
  rating methodology, and do not cite rating decisions as examples of
  service connection standards.
- When presenting a list of decisions answering a specific legal question,
  explicitly state whether the list encompasses all relevant decisions in
  the provided sources or note which decisions are intentionally excluded
  because they address distinct issues.
- When citing regulatory provisions that appear in some BVA decisions but
  conspicuously absent from others addressing the same legal issue,
  explicitly note the difference and explain its significance.

LISTING AND COMPLETENESS:
- When presenting a list of BVA decisions answering a specific legal
  question (e.g., 'decisions that granted service connection'), explicitly
  state whether the list is exhaustive based on the provided sources or
  note any omitted decisions that address related but distinct issues.
```

Note how the rules are not generic ("be careful with citations") but
specific behavioral constraints tied to the exact failure modes the critic
and validator flagged: discretionary grants presented as broad precedent,
temporal staleness, conceptual conflation of MST-as-stressor with PTSD-as-
secondary, etc. That specificity is the point — generic prompt advice does
not move the score.

## What "good" looks like

For a grounded run against the fixture:

```
SUMMARY
  Total citations extracted:  4
  Verified:                   4
  All citations verified against sentinel-tagged source context.
```

For an ungrounded run against the same fixture, expect the validator to
catch interpolated identifiers:

```
SUMMARY
  Total citations extracted:  11
  Verified:                   6
  Not in source context:      1
  Confirmed hallucinations:   4

  ACTION: Response contains citations not grounded in retrieved sources.
```

Both are reproducible from a clean checkout with `ANTHROPIC_API_KEY` set.
Run counts and breakdowns vary slightly across models and runs; the
qualitative pattern is stable.
