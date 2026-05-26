# Post-Generation Hallucination Validator

A production-derived validation architecture for detecting unsupported citations, identifiers, and source-dependent claims in LLM responses generated from structured retrieval data.

This repository demonstrates a five-layer reliability pattern for high-stakes RAG and agentic systems: sentinel-tagged source packets, grounded generation constraints, structured claim extraction, deterministic source cross-reference, adversarial critique, and regression testing.

The demo is implemented for veterans-law citation validation because fabricated or stale citations can materially harm legal research and claims analysis. The same architecture applies to any system where an LLM answers from structured records: legal research, healthcare operations, insurance workflows, compliance systems, ecommerce catalogs, financial analytics, and internal enterprise reporting.

> **Boundary:** this project validates whether generated responses are grounded in provided source material. It does not determine legal correctness, predict claim outcomes, provide legal advice, or replace attorney / accredited representative review.

## Production Context

This validator was built from failure analysis in a separate private system — a multi-agent legal-research platform for veterans-law workflows backed by a large BVA-decision corpus and related authorities.

In internal production monitoring over a four-week window, the architecture reduced detected citation-hallucination sessions from roughly **15%** to **below 1.5%** under the project's validation criteria.

That metric is intentionally scoped: it counts sessions in which this class of validator flagged fabricated, ungrounded, or stale structured references. It is not a measurement of legal correctness, user satisfaction, or universal hallucination elimination, and the numbers do not come from this repository — they come from the private system this architecture was distilled from. See [PROOF.md](./PROOF.md) for the full boundary on what is and is not reproducible here, and [docs/eval-notes.md](./docs/eval-notes.md) for how the metric is defined.

## The Problem

LLM hallucinations rarely look broken.

They look confident.

In production RAG systems, the dangerous failure mode is not gibberish. It is a response that cites a plausible section number, assigns the right fact to the wrong source, or draws a conclusion the retrieved data never supported.

In regulated workflows, that can ship unnoticed unless a post-generation validation layer checks the answer before it reaches the user.

Through production log analysis, four recurring failure modes appeared:

1. **Context-boundary hallucination** — the model correctly references a concept from one retrieved source but assigns it the identifier of an adjacent source.
2. **Interpolated identifiers** — the model constructs plausible-looking citation numbers, docket numbers, section numbers, SKU IDs, or record IDs that were never retrieved.
3. **Temporal staleness** — the cited authority or record exists, but has been superseded, amended, retired, or otherwise made stale.
4. **Aggregation / reasoning errors** — the model computes, compares, or infers something beyond what the source packet supports.

The common feature: the answer reads as authoritative even when the grounding is wrong.

## Design Principle

> The model may draft the answer, but it does not get final authority over whether the answer is grounded.

This repo uses LLMs where they are useful — generation, extraction, and adversarial review — but the core grounding decision is deterministic wherever possible.

The extraction pass identifies candidate claims. The validator then checks those claims against sentinel-tagged source records, metadata, and optional live API verification.

## Five-Layer Architecture

### 1. Sentinel-Tagged Retrieval

Each retrieved record is wrapped with explicit source boundaries:

```text
[SOURCE_START: 38 CFR § 4.130]
...source text...
[SOURCE_END: 38 CFR § 4.130]
```

The model receives both the content and the source identity in a format that is easy to preserve. This reduces adjacent-record bleed and source misattribution.

### 2. Grounding-Constrained Generation

The system prompt requires every legal citation, identifier, docket number, figure, or source-dependent claim to be supported by the tagged source packet.

If the source material is insufficient, the model is instructed to say what is missing instead of filling gaps from prior knowledge.

### 3. Structured Claim Extraction

A lightweight extraction pass converts prose into machine-checkable JSON. In this demo, the extractor pulls legal citations from the generated response:

* CFR citations
* BVA citation numbers
* CAVC references
* U.S.C. references
* The specific claim being made about each citation

In another domain, the same step could extract ICD-10 codes, SKU IDs, dollar figures, ticker symbols, date ranges, invoice numbers, or account identifiers.

### 4. Deterministic Cross-Reference Validation

Extracted claims are checked against:

* the sentinel-tagged source packet
* source metadata
* temporal status fields such as `status`, `effective_date`, and `superseded_by`
* optional live API / database verification

Possible statuses include:

| Status           | Meaning                                                                               |
| ---------------- | ------------------------------------------------------------------------------------- |
| `VERIFIED`       | Citation or identifier appears in the provided source packet.                         |
| `NOT_IN_SOURCES` | Citation was generated but not present in retrieved sources.                          |
| `UNGROUNDED`     | Citation exists in the live corpus but was not part of the retrieved source packet.   |
| `HALLUCINATED`   | Citation is absent from the retrieved sources and cannot be verified through the API. |
| `OUTDATED`       | Citation exists but is marked stale, superseded, or otherwise not current.            |

### 5. Adversarial Critic + Regression Monitoring

A separate critic pass reviews the answer for errors that exact matching may miss:

* unsupported conclusions
* misleading citation use
* overbroad interpretations
* temporal assumptions
* aggregation errors

Known failure cases are frozen into regression tests so fixes do not silently regress.

## Validator Types

| Validator                  | Catches                                                    | Method                                                                                  |
| -------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Source-grounding validator | Fabricated identifiers, wrong source attribution           | Deterministic match against sentinel-tagged source IDs and extracted source identifiers |
| Temporal validator         | Superseded or stale authority                              | Metadata and optional API status check                                                  |
| Critic pass                | Unsupported reasoning or misleading use of a real citation | LLM review against the source packet and validation report                              |

## What This Demonstrates

This repository is not just a prompt-engineering demo. It demonstrates a production reliability pattern for LLM systems that must answer from structured data:

* failure-mode analysis from real logs
* sentinel-tagged source packet design
* grounded generation constraints
* structured claim extraction
* deterministic source cross-reference
* temporal validity checking
* optional live API verification
* adversarial reasoning review
* frozen-case regression tests
* JSONL monitoring for ongoing drift detection

## Architecture

```text
User Query
    │
    ▼
┌─────────────────────────┐
│ Retrieval Layer          │  ← API / tool calls fetch relevant records
│ Sentinel-tagged sources  │     with source IDs and temporal metadata
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ Grounded Generation      │  ← System prompt constrains citations
│ Anthropic / Claude       │     to provided source packet
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ Structured Extractor     │  ← LLM extracts citations / claims
│ Lightweight pass         │     into typed JSON
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ Cross-Reference          │  ← Deterministic grounding check
│ Validator                │     + metadata + optional live API
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ Adversarial Critic       │  ← Reviews unsupported reasoning
│ Lightweight pass         │     and misleading citation use
└────────────┬────────────┘
             │
         ┌───┴───┐
         │       │
       PASS    FAIL
         │       │
    Return    Regenerate,
    response  block, or warn
```

## Domain Mapping

| This Demo                       | Same Pattern in Another System                                                         |
| ------------------------------- | -------------------------------------------------------------------------------------- |
| CFR / BVA / CAVC citations      | ICD-10 codes, CPT codes, SKU IDs, ticker symbols, invoice IDs                          |
| Sentinel-tagged legal documents | Sentinel-tagged JSON payloads, database rows, search results, API records              |
| Citation extractor              | Claim extractor for figures, dates, IDs, percentages, or record references             |
| BVA API verification            | Your product API, database, search index, warehouse, or policy engine                  |
| Temporal legal metadata         | Effective dates, product status, policy version, account status, market data timestamp |
| Adversarial legal critic        | Domain-specific reviewer for unsupported conclusions                                   |

The architecture is identifier-agnostic. Swap the extractor schema and verification endpoint; the failure modes are largely the same.

## Running the Demo

Install dependencies and copy the environment template:

```bash
npm install
cp .env.example .env   # then edit .env and set ANTHROPIC_API_KEY
```

Run the web GUI:

```bash
node server.js
# Open http://localhost:4000
```

Run with optional live verification API:

```bash
BVA_API_URL=https://your-api.example.com node server.js
```

Run from CLI:

```bash
# Grounded mode (uses the rules in lib/context.js)
node validator.js

# Ungrounded mode: demonstrates what the validator catches
node validator.js --ungrounded

# With live API verification
BVA_API_URL=https://your-api.example.com node validator.js --ungrounded
```

The `BVA_API_URL` endpoint is optional and is the integration point for live verification against a corpus index. Without it, validation runs against the sentinel-tagged source packet only and unverified citations surface as `NOT_IN_SOURCES` instead of being split into `UNGROUNDED` vs `HALLUCINATED`.

## GUI Features

The local web interface includes:

* example query dropdown
* grounded vs. ungrounded comparison mode
* model selector
* system prompt editor
* structured extraction output
* validation report with status categories
* adversarial critic panel
* session logging to `logs/sessions.jsonl`
* prompt optimization workflow for testing prompt revisions against regression queries

## Example Output

Grounded mode should keep the answer tied to the retrieved source packet:

```text
SUMMARY
  Total citations extracted:  4
  Verified:                   4
  All citations verified against sentinel-tagged source context.
```

Ungrounded mode commonly produces the same class of interpolated-identifier failures observed in production logs: plausible-looking citations or record IDs that do not appear in the retrieved source packet.

```text
SUMMARY
  Total citations extracted:  11
  Verified:                   6
  Not in source context:      1
  Confirmed hallucinations:   4

  ACTION: Response contains citations not grounded in retrieved sources.
  In production, this triggers regeneration, blocking, or a validation warning.
```

## Project Structure

```text
bva-citation-validator/
├── validator.js                 # CLI pipeline
├── server.js                    # Local web GUI server
├── critic.js                    # Adversarial critic module
├── fixes.js                     # Fix demonstration suite (live, not assertion-based)
├── package.json
├── README.md
├── PROOF.md                     # Scoping boundary: what is reproducible here
├── .env.example
├── docs/
│   ├── architecture.md          # How the pipeline is wired together
│   ├── failure-modes.md         # The four hallucination categories the validator catches
│   └── eval-notes.md            # Scoring, test command, optimizer worked example
├── lib/
│   ├── context.js               # Simulated retrieval context and prompts
│   ├── extract.js               # Structured citation extraction
│   ├── validate.js              # Cross-reference validation
│   ├── logger.js                # JSONL session logging
│   ├── providers.js             # Anthropic / Gemini provider abstraction
│   ├── prompt-advisor.js        # Prompt improvement suggestions
│   └── prompt-loop.js           # Recursive prompt optimization loop
├── public/
│   ├── index.html               # Web GUI markup
│   ├── css/styles.css
│   └── js/                      # app.js, optimize.js, render.js, utils.js
└── tests/
    └── regression/
        ├── runner.js
        └── cases/
            ├── 001-context-boundary.json
            ├── 002-interpolated-identifier.json
            ├── 003-outdated-citation.json
            └── 004-fabricated-docket.json
```

## Monitoring

Each validation session is written as structured JSONL:

```json
{
  "id": "uuid",
  "timestamp": "2026-03-20T00:00:00.000Z",
  "query": "...",
  "mode": "grounded",
  "model": "claude-sonnet-4-6",
  "citations": {
    "total": 8,
    "verified": 7,
    "outdated": 1,
    "hallucinated": 0
  },
  "critic": {
    "findings": 1,
    "high": 0,
    "medium": 1,
    "low": 0
  },
  "duration_ms": 4523
}
```

For real deployments, logs should be redacted or hashed before storing sensitive user queries or source material.

## Regression Testing

Frozen failure cases live in `tests/regression/cases/`.

Run:

```bash
npm run test:regression
```

Each case defines:

* the failure mode
* the query that triggers it
* expected verified citations
* expected outdated citations
* known bad citations that must not be verified
* the fix expected to catch the issue

The current regression runner uses live LLM calls and therefore requires `ANTHROPIC_API_KEY`. For stricter CI, split this into deterministic frozen-response tests and optional LLM integration tests. See [docs/eval-notes.md](./docs/eval-notes.md) for the test command and scoring notes.

## Results

These are detection-rate figures from a four-week monitoring window in the private system this architecture was distilled from, **not** measurements produced by this repository. They are reported here because the architecture is the artifact and the numbers are what motivated each layer.

| Metric                                         |                    Before |                            After |
| ---------------------------------------------- | ------------------------: | -------------------------------: |
| Detected sessions with citation hallucinations |                      ~15% |                            <1.5% |
| Context-boundary misattributions               |                    Common | Near zero after sentinel tagging |
| Interpolated identifiers                       |                Occasional |  Caught by validator / API check |
| Outdated or superseded citations               |     Previously undetected |         Flagged through metadata |
| Unsupported reasoning using real citations     | Previously hard to detect |          Surfaced by critic pass |

These are detection-rate results under this project's validation definitions. They do not imply general legal correctness or universal hallucination elimination, and they are not reproducible from this repo. See [PROOF.md](./PROOF.md) and [docs/eval-notes.md](./docs/eval-notes.md) for the boundary.

## How I Would Apply This to Another Codebase

1. **Trace the source-to-answer path**

   * Identify how API results, database rows, or JSON payloads enter the prompt.
   * Locate places where adjacent records, summaries, or aggregation payloads may blur together.

2. **Extract verifiable claims from bad sessions**

   * Pull identifiers, figures, percentages, dates, and conclusions from negative chat logs.
   * Compare each claim against the original payload supplied to the model.

3. **Classify failure modes**

   * wrong source attribution
   * fabricated identifiers
   * stale or superseded records
   * incorrect aggregation or comparison
   * unsupported reasoning beyond the data

4. **Implement targeted controls**

   * sentinel tags for source attribution
   * grounding constraints for identifier discipline
   * precomputed metrics for aggregation-heavy queries
   * post-generation validation before display
   * warnings, blocking, or regeneration on failed validation

5. **Turn failures into regression tests**

   * Freeze real bad outputs as test cases.
   * Verify that every fix catches the original failure.
   * Track validation outcomes in session logs for drift monitoring.

## Security Notes

This is a reference implementation and local demo server. Before exposing it publicly:

* add authentication
* add request body limits
* add rate limiting
* redact or hash logged queries
* separate deterministic CI tests from live LLM integration tests
* harden citation normalization to avoid substring false positives

## Tech Stack

* Node.js
* Anthropic SDK
* Claude structured-output extraction
* Optional Gemini generation support in the provider abstraction
* JSONL logging
* Local HTTP server
* Regression-test fixtures

## Further Reading In This Repo

* [PROOF.md](./PROOF.md) — what is and is not reproducible from this codebase.
* [docs/architecture.md](./docs/architecture.md) — wiring of the five-layer pipeline, with file-by-file responsibilities.
* [docs/failure-modes.md](./docs/failure-modes.md) — the four hallucination categories the pipeline is designed to catch, with the production-log signature of each.
* [docs/eval-notes.md](./docs/eval-notes.md) — scoring formula, test invocation, and an example of an optimizer-evolved prompt.

## License

No license file is included yet. Add a license before encouraging external reuse.
