# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

BVA Citation Validator — a five-layer hallucination detection system for LLM-generated VA disability law citations. It validates citations (CFR sections, BVA decisions, CAVC cases) against sentinel-tagged source contexts, catching fabricated, ungrounded, and outdated references.

## Commands

```bash
# Install dependencies
npm install

# Run web GUI (http://localhost:4000)
npm start                    # or: node server.js

# Run CLI pipeline
npm run cli                  # grounded mode
npm run validate:ungrounded  # shows what validator catches

# Run all tests (requires ANTHROPIC_API_KEY)
npm test                     # runs test:fixes then test:regression

# Run individual test suites
npm run test:fixes           # fix demonstration suite (fixes.js)
npm run test:regression      # frozen failure regression cases (tests/regression/runner.js)
```

**Required env:** `ANTHROPIC_API_KEY`
**Optional env:** `BVA_API_URL` (live citation verification API), `PORT` (default 4000)

## Architecture

The pipeline runs 3 sequential LLM calls per validation:

1. **Grounded Generation** — Claude generates a response constrained by a system prompt that requires all citations to appear verbatim in sentinel-tagged `[SOURCE_START]...[SOURCE_END]` context blocks
2. **Citation Extraction** — A second LLM call (Haiku) extracts all verifiable claims as structured JSON
3. **Cross-Reference Validation** — String matching with normalization checks each extracted citation against source IDs; temporal validation checks metadata (status, superseded_by); optional live API verification
4. **Adversarial Critic** — A third LLM call (Haiku) reviews the response for subtle issues (overstated claims, unsupported conclusions, temporal assumptions) that string matching misses
5. **Session Logging** — Structured JSONL output to `logs/sessions.jsonl`

**Validation statuses:** VERIFIED, OUTDATED, NOT_IN_SOURCES, UNGROUNDED (in API but not sources), HALLUCINATED (not in sources or API)

## Key Files

- **`validator.js`** — CLI pipeline: contains `RETRIEVAL_CONTEXT` (6 hardcoded sources with metadata), `run()` main pipeline, `normalize()` for citation matching, `verifyViaApi()` for optional live checks
- **`server.js`** — HTTP server + `/validate` API endpoint; duplicates RETRIEVAL_CONTEXT and validation logic from validator.js
- **`critic.js`** — Adversarial critic module; `runCritic()` returns findings with severity levels
- **`lib/logger.js`** — Session logging: `createSession()`, `logStep()`, `finalizeSession()`
- **`index.html`** — Web GUI: model selection, system prompt editor, compare-both mode, color-coded citation results
- **`fixes.js`** — Demonstrates each fix layer in isolation with before/after comparisons
- **`tests/regression/cases/*.json`** — 4 frozen failure cases testing sentinel tags, grounding constraint, temporal validation, and fabricated docket detection

## Key Patterns

- **Shared RETRIEVAL_CONTEXT** — validator.js, server.js, and tests/regression/runner.js all define identical source data; keep them in sync when modifying
- **Citation normalization** — `normalize()` handles C.F.R./CFR, U.S.C./USC, § variants, whitespace; bidirectional substring matching with docket number fallback for BVA citations
- **No build step** — Pure Node.js ES modules, single dependency (`@anthropic-ai/sdk`)
- **Models** — Generation uses Sonnet 4.6 by default (configurable); extraction and critic use Haiku 4.5 for cost optimization
- **Tests hit the Anthropic API** — All tests require a live API key; no mocking
