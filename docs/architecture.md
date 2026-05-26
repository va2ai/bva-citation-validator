# Architecture

This document explains how the validation pipeline is wired together, where
each responsibility lives in the code, and why each layer exists. The README
gives the elevator pitch; this file is the map for someone reading the
source.

## Pipeline overview

```
                          ┌──────────────────────────────┐
                          │ lib/context.js               │
                          │   RETRIEVAL_CONTEXT fixture  │
                          │   GROUNDED_PROMPT            │
                          │   UNGROUNDED_PROMPT          │
                          │   TEST_QUERIES               │
                          └──────────────┬───────────────┘
                                         │
                                         ▼
User query ──────► ┌──────────────────────────────────────┐
                   │ Step 1 — Grounded generation         │
                   │   validator.js / server.js           │
                   │   lib/providers.js (Claude / Gemini) │
                   └──────────────┬───────────────────────┘
                                  │ response text
                                  ▼
                   ┌──────────────────────────────────────┐
                   │ Step 2 — Structured claim extraction │
                   │   lib/extract.js                     │
                   │   output_config + JSON schema        │
                   └──────────────┬───────────────────────┘
                                  │ citations: [{type, identifier, claim}]
                                  ▼
                   ┌──────────────────────────────────────┐
                   │ Step 3 — Deterministic validation    │
                   │   lib/validate.js                    │
                   │   citationKey + sourceKeyMap         │
                   │   metadata.status / superseded_by    │
                   │   optional live API verification     │
                   └──────────────┬───────────────────────┘
                                  │ results[].status (VERIFIED, OUTDATED, ...)
                                  ▼
                   ┌──────────────────────────────────────┐
                   │ Step 4 — Adversarial critic          │
                   │   critic.js                          │
                   │   output_config + findings schema    │
                   └──────────────┬───────────────────────┘
                                  │ findings[].severity (high/medium/low)
                                  ▼
                   ┌──────────────────────────────────────┐
                   │ Step 5 (conditional) — Prompt advisor│
                   │   lib/prompt-advisor.js              │
                   │   Suggests rule additions + new prompt│
                   └──────────────┬───────────────────────┘
                                  │
                                  ▼
                   ┌──────────────────────────────────────┐
                   │ lib/logger.js                        │
                   │   Append session to logs/sessions.jsonl│
                   └──────────────────────────────────────┘
```

## Step 1 — Grounded generation

**Files:** `validator.js`, `server.js`, `lib/providers.js`, `lib/context.js`

Both the CLI and the GUI build the prompt by concatenating
`RETRIEVAL_CONTEXT[*].content` and asking the user's question. Each retrieved
record arrives wrapped in `[SOURCE_START: <id>] ... [SOURCE_END: <id>]`
tags. The model receives the source text **and** the source identity in a
form that is easy to preserve verbatim. This is the cheapest defense against
"context-boundary" misattribution.

The system prompt comes from one of:

* `GROUNDED_PROMPT` — exported by `lib/context.js`. Built by reading the
  optimizer-produced `system-prompt.txt` if present (gitignored), otherwise
  falling back to the hardcoded `DEFAULT_GROUNDED_PROMPT`.
* `UNGROUNDED_PROMPT` — same prompt with the grounding rules removed. This
  is the demonstration mode; it produces the failure modes the validator is
  built to catch.
* A custom prompt POSTed from the GUI prompt editor.

`lib/providers.js` wraps Anthropic and Google so the generation model is
swappable. Extraction, critic, and advisor calls always go through
Anthropic with Haiku for cost.

## Step 2 — Structured claim extraction

**File:** `lib/extract.js`

Extraction is a separate LLM pass — not a regex pass. A regex on CFR-shaped
strings would miss claims that paraphrase the identifier and would over-fire
on stray section numbers in the source text.

The pass uses Anthropic's `output_config` with a JSON schema:

```json
{
  "type": "object",
  "properties": {
    "citations": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "type":       { "enum": ["cfr", "bva", "cavc", "usc"] },
          "identifier": { "type": "string" },
          "claim":      { "type": "string" }
        },
        "required": ["type", "identifier", "claim"],
        "additionalProperties": false
      }
    }
  },
  "required": ["citations"],
  "additionalProperties": false
}
```

The schema rejects free-text output, so downstream code does not have to
parse JSON from prose. Duplicate `(type, identifier)` pairs are dropped.
`claim` is a one-sentence summary that the critic and advisor consume.

## Step 3 — Deterministic cross-reference validation

**File:** `lib/validate.js`

This is the load-bearing layer. The principle is:

> The LLM may draft the answer, but it does not get final authority over
> whether the answer is grounded.

The validator does three things:

1. **Canonical-key matching.** `citationKey(type, raw)` reduces each
   citation to a structured key — `cfr:38:4.130`, `bva:21-53274`, etc. The
   same function is applied to each entry in `RETRIEVAL_CONTEXT` to build a
   `sourceKeyMap`. Matching is exact key equality. This deliberately avoids
   substring matching, which previously produced false positives such as
   "38 CFR § 4.13" matching "38 CFR § 4.130".
2. **Metadata check.** Each retrieval entry carries `status`,
   `effective_date`, `superseded_by`, and `last_verified`. If a citation
   matches a source but the source's metadata says it is non-active, the
   status becomes `OUTDATED` and the detail string names the superseding
   authority.
3. **Optional live API check.** If `BVA_API_URL` is set, citations that
   fail the source-packet check are queried against the live corpus.
   A citation that exists in the live corpus but was never in the source
   packet is `UNGROUNDED` (the model used training knowledge, not retrieval).
   A citation that exists nowhere is `HALLUCINATED`.

Final statuses, in order of severity:

| Status           | Means                                              |
| ---------------- | -------------------------------------------------- |
| `VERIFIED`       | Found in source packet, metadata active.           |
| `OUTDATED`       | Found in source packet, metadata says superseded.  |
| `UNGROUNDED`     | Not in source packet, exists in live API.          |
| `NOT_IN_SOURCES` | Not in source packet, live API not configured.     |
| `HALLUCINATED`   | Not in source packet, live API confirms no match.  |

## Step 4 — Adversarial critic

**File:** `critic.js`

The critic is intentionally a different concern than validation. Validation
asks "does this string appear?" The critic asks "does the response use this
string honestly?" It receives the source packet, the response, and the
validation report, and returns structured findings with severities.

The critic is an LLM and is therefore fallible. It is best understood as a
second opinion that surfaces issues the deterministic layer cannot reach:
overstated claims, temporal assumptions, aggregation across sources,
discretionary holdings presented as broad precedent.

## Step 5 — Prompt advisor (conditional)

**File:** `lib/prompt-advisor.js`

This step only runs when Step 3 or Step 4 reports problems. The advisor
sees the current prompt, the critic findings, and the validation report,
and proposes new rules plus a full updated prompt. It is also history-aware
when invoked from the optimizer: it sees which previous rules were kept
and which were reverted, and it is told to avoid repeating failed
approaches.

## Recursive prompt optimization

**File:** `lib/prompt-loop.js`

`runPromptLoop()` is a ratchet loop:

1. Run the full pipeline across each query in `TEST_QUERIES`.
2. Score the run with `computeScore()` — 40% citation accuracy + 30% no
   high-severity findings + 20% no medium-severity findings + 10% non-trivial
   output.
3. Keep the new prompt if the score improved, revert otherwise.
4. Persist `{ bestPrompt, bestScore, history, ledger }` to
   `optimize/state.json` for crash recovery.
5. Ask the advisor for the next candidate. Stop on perfect score, three
   stagnant iterations, or three consecutive declines.

The optimizer also writes the current best prompt to `system-prompt.txt`,
which `lib/context.js` loads on next start. This file is gitignored so the
committed default prompt remains the reference.

## Session logging

**File:** `lib/logger.js`

Every validation creates a session UUID and appends a single JSON line to
`logs/sessions.jsonl` with citations, critic findings, token counts, and
duration. The README's "Monitoring" section shows the schema. The file is
gitignored.

For real deployments, user queries and source material should be redacted
or hashed before logging.

## Why the layers are separate

* **Generation and validation are separated** because if the model is both
  drafter and judge, the judgment is biased toward whatever it just wrote.
* **Extraction and validation are separated** because string matching needs
  a deterministic input and an LLM is the right tool for prose → JSON.
* **Critic and validator are separated** because one asks "did the string
  appear?" and the other asks "is the response honest?" Those are different
  failure modes and the critic would dilute the validator's signal if
  combined.
* **Advisor is conditional** because every cycle of "advise on what just
  worked fine" wastes tokens and dilutes the optimizer's signal.
