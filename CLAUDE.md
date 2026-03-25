# CLAUDE.md

## What This Is

BVA Citation Validator — a hallucination detection system for LLM-generated VA disability law citations with recursive self-improvement. It validates citations (CFR sections, BVA decisions, CAVC cases) against sentinel-tagged source contexts, catching fabricated, ungrounded, and outdated references, then automatically optimizes the system prompt to prevent future issues.

## Commands

```bash
npm install                  # install dependencies
npm start                    # web GUI at http://localhost:4000
npm run cli                  # CLI pipeline (grounded mode)
npm run validate:ungrounded  # shows what validator catches
npm run optimize             # recursive prompt optimization
npm test                     # runs test:fixes then test:regression
```

**Required env:** `ANTHROPIC_API_KEY` (loaded from `.env` via dotenv)
**Optional env:** `GOOGLE_API_KEY` or `GEMINI_API_KEY` (for Gemini models), `BVA_API_URL` (live citation verification API), `PORT` (default 4000)

## Architecture

### Validation Pipeline (per query)

1. **Grounded Generation** — LLM generates a response constrained by a system prompt requiring all citations to appear verbatim in sentinel-tagged `[SOURCE_START]...[SOURCE_END]` context blocks
2. **Citation Extraction** — Haiku extracts all verifiable claims as structured JSON via `output_config` schema enforcement
3. **Cross-Reference Validation** — String matching with normalization + temporal metadata checks + optional live API verification
4. **Adversarial Critic** — Haiku reviews for subtle issues (overstated claims, unsupported conclusions, temporal assumptions) that string matching misses
5. **Prompt Advisor** (conditional) — If issues found, suggests system prompt improvements with full updated prompt text
6. **Session Logging** — Structured JSONL output to `logs/sessions.jsonl`

### Recursive Prompt Optimization (Autoresearch Pattern)

`lib/prompt-loop.js` implements a ratchet loop for system prompt self-improvement:

- Runs the full pipeline across 4 test queries per iteration
- Computes a composite score (0-100) weighting citation accuracy and critic findings
- **Ratchet**: keeps prompt if score improved, reverts if not
- History-aware advisor suggests new rules, avoiding previously failed approaches
- Converges when: perfect score, stagnant for 3 iterations, or max iterations reached

**Validation statuses:** VERIFIED, OUTDATED, NOT_IN_SOURCES, UNGROUNDED (in API but not sources), HALLUCINATED (not in sources or API)

## Key Conventions

- No build step — pure Node.js ES modules
- All tests require a live Anthropic API key; no mocking
- `lib/providers.js` abstracts Anthropic and Google models behind a unified `generate()` API; generation model is configurable in the GUI; extraction, critic, and advisor use Haiku for cost
- All LLM extraction/critic/advisor calls use `output_config` with JSON schema + `additionalProperties: false`
