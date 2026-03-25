# Post-Generation Hallucination Validator

A production-tested approach to detecting and preventing LLM hallucinations in systems that answer user queries from structured data. Built for a multi-agent legal intelligence platform where fabricated citations in AI responses could directly harm veterans' disability claims.

This repo demonstrates the diagnostic tooling and fixes — the same infrastructure used in production to drop citation hallucination rates from ~15% to under 1.5% of sessions.

## The Problem

When an LLM answers questions using retrieved data (JSON payloads, API results, database records), it can return confidently stated figures, identifiers, or conclusions that aren't supported by the underlying data. These hallucinations are especially dangerous when users act on the outputs without manual verification.

In my system, I identified four distinct failure modes through systematic log analysis:

**1. Context boundary hallucination** — The model correctly references a concept from one data source but assigns it the identifier of an adjacent one. The retrieved payload has the right data; the model just misattributes which record it came from.

**2. Interpolated identifiers** — When the retriever returns 3-5 results as context, the model occasionally generates additional "supporting" records that don't exist — constructing plausible-looking identifiers from patterns internalized during training.

**3. Temporal staleness** — The model cites real cases or regulations that have been overturned, superseded, or updated. The citation technically exists but is no longer valid authority.

**4. Aggregation/reasoning errors** — The model draws conclusions, computes comparisons, or makes inferences that go beyond what the sources explicitly state. Subtle and hard to catch with simple pattern matching.

All four failure modes produce responses that read as authoritative. Without a verification layer, there's no signal that anything is wrong.

## The Fix: Five-Layer Architecture

### Layer 1: Sentinel-Tagged Context
Instead of passing raw data to the model, each retrieved record is wrapped with explicit boundary markers:

```
[SOURCE_START: record_id_123]
{ ...payload data... }
[SOURCE_END: record_id_123]
```

This gives the model unambiguous anchoring points, eliminating the context boundary attribution problem almost entirely.

### Layer 2: Grounding Constraint in the System Prompt
A hard rule requiring every identifier in the response to appear verbatim in the source tags. The model must say "insufficient data" rather than fill gaps from training knowledge.

### Layer 3: Post-Generation Validation
Every response goes through a second lightweight LLM pass:
1. **Extract** — A structured extraction call pulls all verifiable claims (identifiers, figures, references) into a typed JSON array
2. **Cross-reference** — Each extracted claim is checked against the source data provided to the model, including temporal metadata (status, effective date, superseded_by)
3. **Verify** — Optionally, claims are verified against the live data source (API, database) to catch edge cases
4. **Act** — Failed responses are either regenerated with a stricter prompt or returned with a validation warning

### Layer 4: Adversarial Critic Pass
A third LLM pass reviews the response against the source data and validation report to catch subtle issues that pattern matching misses:
- Claims that go beyond what sources support
- Unsupported conclusions or reasoning
- Citations used in misleading context
- Temporal assumptions (assuming current validity without checking)

### Layer 5: Regression Testing & Monitoring
Frozen failure cases from real production incidents are re-run against the pipeline to verify fixes continue to hold. Structured JSON logging tracks every session for ongoing monitoring.

## How This Maps to Your Stack

| This Demo | Your Pipeline |
|---|---|
| Anthropic API (Claude) | Anthropic API (same) |
| Node.js + `@anthropic-ai/sdk` | Node.js (same) |
| Sentinel-tagged legal documents | Sentinel-tagged JSON payloads from your API |
| Citation extraction (CFR, BVA, CAVC) | Claim extraction (dollar figures, SKU IDs, percentages, date ranges) |
| BVA API verification | Your platform API verification |
| Regulatory identifiers | Financial identifiers and metrics |

The architecture is identical — swap the domain-specific extractors and the verification endpoints, and this runs against your pipeline directly.

## Running the Demo

```bash
npm install
```

### Web GUI (recommended)

```bash
ANTHROPIC_API_KEY=sk-... node server.js
# Open http://localhost:4000
```

With live BVA API verification:
```bash
ANTHROPIC_API_KEY=sk-... BVA_API_URL=https://your-api.run.app node server.js
```

The GUI provides:
- **Example query dropdown** — pre-built queries covering PTSD rating criteria, MST evidence, TBI secondary connection, cross-case comparison
- **Model selector** — switch between Claude Sonnet 4.6, Haiku 4.5, Opus 4.6, or Sonnet 4.5
- **System prompt editor** — view and customize both the grounded and ungrounded system prompts in real time
- **Compare Both** — runs grounded and ungrounded side-by-side so you can see the hallucination delta
- **Validation report** — each citation color-coded: green (VERIFIED), red (HALLUCINATED), amber (NOT_IN_SOURCES), purple (UNGROUNDED), orange (OUTDATED)
- **Critic review panel** — adversarial findings with severity badges (HIGH/MEDIUM/LOW)
- **Session logging** — each run logged to `logs/sessions.jsonl` for monitoring

### CLI

```bash
# Grounded (with hallucination guardrails)
ANTHROPIC_API_KEY=sk-... node validator.js

# Ungrounded (demonstrates what the validator catches)
ANTHROPIC_API_KEY=sk-... node validator.js --ungrounded

# With live API verification
ANTHROPIC_API_KEY=sk-... BVA_API_URL=https://your-api.run.app node validator.js --ungrounded
```

### What you'll see

**Grounded mode** — all citations verified, model stays anchored to source data:
```
SUMMARY
  Total citations extracted:  4
  Verified (source + API):    4
  All citations verified against sentinel-tagged source context.
```

**Ungrounded mode** — validator catches fabricated citations:
```
SUMMARY
  Total citations extracted:  11
  Verified (source + API):    6
  Not in source context:      1
  Confirmed hallucinations:   4   <- fabricated citations

  ACTION: Response contains citations not grounded in retrieved sources.
  In production, this triggers: regeneration with stricter prompt OR
  validation warning surfaced to the practitioner.
```

The hallucinations are the exact "interpolated identifier" failure mode — the model generates plausible-looking CAVC case references and CFR sections from training knowledge, none of which appeared in the source context. The live API confirms they don't exist in the corpus either.

## Project Structure

```
bva-citation-validator/
├── validator.js              # CLI pipeline (5-step: generate → extract → validate → critic → report)
├── server.js                 # Web GUI server (serves index.html + /validate API)
├── critic.js                 # Adversarial critic module (third LLM pass)
├── fixes.js                  # Fix demonstration test suite
├── index.html                # Web GUI (6-step display with critic panel)
├── package.json
├── README.md
├── lib/
│   └── logger.js             # Structured JSON session logging
├── logs/
│   └── .gitkeep              # Session logs written here (gitignored)
└── tests/
    └── regression/
        ├── runner.js          # Regression test runner
        └── cases/
            ├── 001-context-boundary.json
            ├── 002-interpolated-identifier.json
            ├── 003-outdated-citation.json
            └── 004-fabricated-docket.json
```

## Architecture

```
User Query
    │
    ▼
┌─────────────────────────┐
│  Retrieval Layer         │  ← MCP tools / API calls fetch relevant data
│  (sentinel-tagged)       │     with temporal metadata (status, dates)
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│  Grounded Generation     │  ← System prompt with citation constraints
│  (Anthropic API)         │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│  Citation Extractor      │  ← Second LLM pass: structured extraction
│  (lightweight pass)      │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│  Cross-Reference         │  ← Check each claim against source data
│  Validator               │     + temporal status + optional live API
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│  Adversarial Critic      │  ← Third LLM pass: challenges reasoning,
│  (lightweight pass)      │     catches subtle errors validator misses
└────────────┬────────────┘
             │
         ┌───┴───┐
         │       │
      PASS     FAIL
         │       │
    Return    Regenerate or
    response  flag warning
```

## Monitoring & Regression Testing

### Structured Logging
Every validation session is logged to `logs/sessions.jsonl` as structured JSON:
```json
{
  "id": "uuid",
  "timestamp": "2026-03-20T...",
  "query": "...",
  "mode": "grounded",
  "model": "claude-sonnet-4-6",
  "citations": { "total": 8, "verified": 7, "outdated": 1, "hallucinated": 0 },
  "critic": { "findings": 1, "high": 0, "medium": 1, "low": 0 },
  "duration_ms": 4523
}
```

### Regression Test Suite
Frozen failure cases in `tests/regression/cases/` are re-run to verify fixes hold:
```bash
npm run test:regression
```

Each case defines expected citation outcomes (verified, outdated, flagged) and which fix should catch the failure mode. CI-friendly exit codes (0 = pass, 1 = regression).

## Results

Validated over a 4-week window after deployment:

| Metric | Before | After |
|---|---|---|
| Sessions with citation hallucinations | ~15% | <1.5% |
| Context boundary misattributions | Common | Near zero (sentinel tags) |
| Interpolated identifiers | Occasional | Caught by validator |
| Outdated/superseded citations | Undetected | Flagged by temporal validation |
| Subtle reasoning errors | Undetected | Caught by critic pass |

## What I'd Do on Your Codebase

1. **Audit the query pipeline** — trace how JSON payloads flow from your API through the prompt to the model response. Identify where the model has opportunities to fabricate (large payloads with adjacent records, aggregation queries, comparison queries).

2. **Analyze the negative chat records** — build an extraction pipeline to pull every verifiable claim from flagged sessions and cross-reference against the source payloads. Categorize failure modes (wrong figures, fabricated SKUs, incorrect aggregations, hallucinated trends).

3. **Implement fixes per failure mode** — sentinel tagging for attribution errors, grounding constraints for interpolation, pre-computation for aggregation queries (the model explains computed results, it doesn't compute), post-generation validation as the safety net.

4. **Add test coverage** — the `--ungrounded` mode in this demo is the pattern: for each failure mode, a test that deliberately provokes it and verifies the fix catches it.

5. **Run the validator against session logs** — the same diagnostic tooling that identifies problems becomes the ongoing monitoring layer. New failure modes surface automatically.

## Related Repositories

- [bvaapi2](https://github.com/va2ai/bvaapi2) — The BVA Decision Search API and MCP server (FastAPI, GCP Cloud Run) that this validator integrates with
- [bva-decision-intelligence](https://github.com/va2ai/bva-decision-intelligence) — Multi-agent research platform with Citation QA agent
