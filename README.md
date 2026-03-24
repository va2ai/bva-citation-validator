# Post-Generation Hallucination Validator

A production-tested approach to detecting and preventing LLM hallucinations in systems that answer user queries from structured data. Built for a multi-agent legal intelligence platform where fabricated citations in AI responses could directly harm veterans' disability claims.

This repo demonstrates the diagnostic tooling and fixes — the same infrastructure used in production to drop citation hallucination rates from ~15% to under 1.5% of sessions.

## The Problem

When an LLM answers questions using retrieved data (JSON payloads, API results, database records), it can return confidently stated figures, identifiers, or conclusions that aren't supported by the underlying data. These hallucinations are especially dangerous when users act on the outputs without manual verification.

In my system, I identified two distinct failure modes through systematic log analysis:

**1. Context boundary hallucination** — The model correctly references a concept from one data source but assigns it the identifier of an adjacent one. The retrieved payload has the right data; the model just misattributes which record it came from.

**2. Interpolated identifiers** — When the retriever returns 3-5 results as context, the model occasionally generates additional "supporting" records that don't exist — constructing plausible-looking identifiers from patterns internalized during training.

Both failure modes produce responses that read as authoritative. Without a verification layer, there's no signal that anything is wrong.

## The Fix: Three-Layer Approach

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
2. **Cross-reference** — Each extracted claim is checked against the source data provided to the model
3. **Verify** — Optionally, claims are verified against the live data source (API, database) to catch edge cases
4. **Act** — Failed responses are either regenerated with a stricter prompt or returned with a validation warning

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

### Grounded mode (with hallucination guardrails)
```bash
ANTHROPIC_API_KEY=sk-... node validator.js
```

All citations verified. The sentinel tags and grounding constraint keep the model anchored to source data:

```
SUMMARY
  Total citations extracted:  3
  Verified (source + API):    3
  All citations verified against sentinel-tagged source context.
```

### Ungrounded mode (demonstrates what the validator catches)
```bash
ANTHROPIC_API_KEY=sk-... node validator.js --ungrounded
```

Removes the grounding constraint to show the model interpolating citations from training knowledge:

```
SUMMARY
  Total citations extracted:  16
  Verified (source + API):    12
  Confirmed hallucinations:   4   <- fabricated citations

  ACTION: Response contains citations not grounded in retrieved sources.
  In production, this triggers: regeneration with stricter prompt OR
  validation warning surfaced to the practitioner.
```

The 4 confirmed hallucinations are the exact "interpolated identifier" failure mode — the model generated plausible-looking legal citations from patterns internalized during training, none of which appeared in the provided source context.

### With live API verification
```bash
ANTHROPIC_API_KEY=sk-... BVA_API_URL=https://your-api.run.app node validator.js --ungrounded
```

Adds a second verification layer: each extracted citation is checked against a live API to distinguish between fabricated identifiers (no match anywhere) and ungrounded-but-real identifiers (exist in the corpus but weren't in the retrieval context).

## Architecture

```
User Query
    │
    ▼
┌─────────────────────────┐
│  Retrieval Layer         │  ← MCP tools / API calls fetch relevant data
│  (sentinel-tagged)       │
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
│  Validator               │     + optional live API verification
└────────────┬────────────┘
             │
         ┌───┴───┐
         │       │
      PASS     FAIL
         │       │
    Return    Regenerate or
    response  flag warning
```

## Results

Validated over a 4-week window after deployment:

| Metric | Before | After |
|---|---|---|
| Sessions with citation hallucinations | ~15% | <1.5% |
| Context boundary misattributions | Common | Near zero (sentinel tags) |
| Interpolated identifiers | Occasional | Caught by validator |

## What I'd Do on Your Codebase

1. **Audit the query pipeline** — trace how JSON payloads flow from your API through the prompt to the model response. Identify where the model has opportunities to fabricate (large payloads with adjacent records, aggregation queries, comparison queries).

2. **Analyze the negative chat records** — build an extraction pipeline to pull every verifiable claim from flagged sessions and cross-reference against the source payloads. Categorize failure modes (wrong figures, fabricated SKUs, incorrect aggregations, hallucinated trends).

3. **Implement fixes per failure mode** — sentinel tagging for attribution errors, grounding constraints for interpolation, pre-computation for aggregation queries (the model explains computed results, it doesn't compute), post-generation validation as the safety net.

4. **Add test coverage** — the `--ungrounded` mode in this demo is the pattern: for each failure mode, a test that deliberately provokes it and verifies the fix catches it.

5. **Run the validator against session logs** — the same diagnostic tooling that identifies problems becomes the ongoing monitoring layer. New failure modes surface automatically.

## Related Repositories

- [bvaapi2](https://github.com/va2ai/bvaapi2) — The BVA Decision Search API and MCP server (FastAPI, GCP Cloud Run) that this validator integrates with
- [bva-decision-intelligence](https://github.com/va2ai/bva-decision-intelligence) — Multi-agent research platform with Citation QA agent
