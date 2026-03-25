# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

BVA Citation Validator — a hallucination detection system for LLM-generated VA disability law citations with recursive self-improvement. It validates citations (CFR sections, BVA decisions, CAVC cases) against sentinel-tagged source contexts, catching fabricated, ungrounded, and outdated references, then automatically optimizes the system prompt to prevent future issues.

## Commands

```bash
# Install dependencies
npm install

# Run web GUI (http://localhost:4000)
npm start                    # or: node server.js

# Run CLI pipeline
npm run cli                  # grounded mode
npm run validate:ungrounded  # shows what validator catches

# Recursive prompt optimization (autoresearch pattern)
npm run optimize             # or: node validator.js --optimize
node validator.js --optimize --max=5  # limit iterations

# Run all tests (requires ANTHROPIC_API_KEY)
npm test                     # runs test:fixes then test:regression

# Run individual test suites
npm run test:fixes           # fix demonstration suite (fixes.js)
npm run test:regression      # frozen failure regression cases (tests/regression/runner.js)
```

**Required env:** `ANTHROPIC_API_KEY` (loaded from `.env` via dotenv)
**Optional env:** `GOOGLE_API_KEY` or `GEMINI_API_KEY` (for Gemini models), `BVA_API_URL` (live citation verification API), `PORT` (default 4000)

## Architecture

### Validation Pipeline (per query)

4 sequential LLM calls:

1. **Grounded Generation** — Claude generates a response constrained by a system prompt requiring all citations to appear verbatim in sentinel-tagged `[SOURCE_START]...[SOURCE_END]` context blocks
2. **Citation Extraction** — Haiku extracts all verifiable claims as structured JSON via `output_config` schema enforcement
3. **Cross-Reference Validation** — String matching with normalization + temporal metadata checks + optional live API verification
4. **Adversarial Critic** — Haiku reviews for subtle issues (overstated claims, unsupported conclusions, temporal assumptions) that string matching misses
5. **Prompt Advisor** (conditional) — If issues found, suggests system prompt improvements with full updated prompt text
6. **Session Logging** — Structured JSONL output to `logs/sessions.jsonl`

### Recursive Prompt Optimization (Autoresearch Pattern)

`lib/prompt-loop.js` implements Karpathy's "ratchet loop" for system prompt self-improvement:

- Runs the full pipeline across 4 test queries per iteration
- Computes a single composite score (0-100) weighting citation accuracy and critic findings
- **Ratchet**: keeps prompt if score improved, reverts if not (like git reset on failure)
- History-aware advisor suggests new rules, avoiding previously failed approaches
- Converges when: perfect score, stagnant for 3 iterations, or max iterations reached
- Available via CLI (`--optimize`), web GUI ("Optimize Prompt" button), and API (`POST /optimize`)

**Validation statuses:** VERIFIED, OUTDATED, NOT_IN_SOURCES, UNGROUNDED (in API but not sources), HALLUCINATED (not in sources or API)

## Key Files

- **`lib/context.js`** — Single source of truth: RETRIEVAL_CONTEXT, GROUNDED_PROMPT, UNGROUNDED_PROMPT, TEST_QUERIES, helper functions
- **`lib/validate.js`** — normalize(), verifyViaApi(), validateCitations()
- **`lib/extract.js`** — extractCitations() via structured output schema
- **`lib/prompt-advisor.js`** — suggestPromptUpdates() with history-aware optimization
- **`lib/prompt-loop.js`** — computeScore(), checkConvergence(), runPromptLoop() (autoresearch pattern)
- **`lib/providers.js`** — Multi-provider LLM abstraction: unified `generate()` for Anthropic + Gemini models, `getProviderInfo()`, `MODEL_LIST`
- **`lib/logger.js`** — Session logging: createSession(), logStep(), finalizeSession()
- **`critic.js`** — Adversarial critic: runCritic() returns findings with severity levels
- **`validator.js`** — CLI entry point: `run()` for single validation, `optimize()` for recursive loop
- **`server.js`** — HTTP server: `POST /validate`, `POST /optimize` (streams NDJSON), `GET /`
- **`index.html`** — Web GUI: model selection, prompt editor, compare-both, optimize button, iteration progress
- **`fixes.js`** — Demonstrates each fix layer in isolation with before/after comparisons
- **`tests/regression/cases/*.json`** — 4 frozen failure cases

## Key Patterns

- **Shared modules in lib/** — Context, validation, extraction, and prompts are defined once and imported everywhere
- **Citation normalization** — `normalize()` handles C.F.R./CFR, U.S.C./USC, § variants, whitespace; bidirectional substring matching with docket number fallback
- **Structured output** — All LLM extraction/critic/advisor calls use `output_config` with JSON schema + `additionalProperties: false`
- **No build step** — Pure Node.js ES modules, dependencies: `@anthropic-ai/sdk`, `@google/generative-ai`, `dotenv`
- **Multi-provider** — `lib/providers.js` abstracts Anthropic and Google models behind a unified `generate()` API; generation model is configurable in the GUI; extraction, critic, and advisor use Haiku 4.5 for cost
- **Tests hit the Anthropic API** — All tests require a live API key; no mocking
