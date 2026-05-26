# Failure Modes

Hallucinations in retrieval-grounded LLM systems rarely look broken. They
look confident. This document enumerates the failure modes the validator is
built to catch, the production-log evidence each one was derived from, and
how each one is currently detected in this repository.

These categories came out of failure analysis on a separate, private
production system. The taxonomy and the controls are reusable; the specific
hit rates from that system are not measured here. See `PROOF.md` for the
scoping boundary.

## 1. Context-boundary hallucination

**Symptom.** The model references a concept that appears in one retrieved
source but attaches it to the identifier of an adjacent source.

**Why it happens.** Without explicit boundaries, the model treats the
context as a continuous prose blob. Adjacent CFR sections share vocabulary
("rating", "diagnosis", "stressor"), so when the model is generating a
sentence about a concept, the nearest plausible identifier in working
memory may not be the correct one.

**Production-log signature.** Responses that confidently attribute the DSM-5
diagnostic-conformance requirement (which lives in § 4.125) to the adjacent
§ 4.130 rating-schedule section.

**Control.** Sentinel tags around each retrieved record:

```
[SOURCE_START: 38 CFR § 4.125]
...
[SOURCE_END: 38 CFR § 4.125]
```

The boundary is a syntactic feature the model can preserve verbatim. In the
fixture, this collapses boundary-misattribution rate dramatically. See test
`fixes.js` "Test 1a/1b" and regression case
`tests/regression/cases/001-context-boundary.json`.

**Limitation.** Tags help, but a model can still pull a real-looking
identifier from training. That is failure mode 2, caught at Step 3.

## 2. Interpolated identifier

**Symptom.** The model emits a plausible-looking identifier — CFR section,
BVA docket, CAVC case — that was never in the retrieved source packet.
Often the identifier is real and exists somewhere in the corpus, just not
in the packet for this query. Sometimes it is wholly fabricated.

**Why it happens.** Identifiers like "38 CFR § 4.X" or "BVA YY-NNNNN"
follow tight patterns the model knows. Without a grounding constraint, the
model treats "produce a citation here" as a generation task and confabulates
a pattern-conformant string.

**Production-log signature.** Responses that include CFR sections, CAVC
cases, or BVA dockets in a confident citation style when the retrieval
packet contained no such record.

**Control.** Two-layered:

1. The grounded system prompt forbids constructing or recalling
   identifiers from prior knowledge and requires verbatim use of source
   tags.
2. `lib/validate.js` post-checks every extracted citation against the
   canonical-key set of the source packet. Identifiers that pass extraction
   but fail validation are surfaced as `NOT_IN_SOURCES` (or `UNGROUNDED` /
   `HALLUCINATED` when the live API distinguishes the two).

See `fixes.js` "Test 2a/2b" and regression cases
`002-interpolated-identifier.json` and `004-fabricated-docket.json`.

**Limitation.** The prompt is advisory; the deterministic layer is what
actually catches the failure. Removing the prompt-side constraint while
keeping the validator still catches the issue; removing the validator
makes the system trust-but-verify with no verify.

## 3. Temporal staleness

**Symptom.** The citation exists, but it has been superseded, amended,
retired, or otherwise rendered non-current. The model cites it as if it
were live authority.

**Why it happens.** LLM training cutoffs and retrieval ranking by relevance
both ignore "is this still good law?". A superseded BVA decision can still
score high on semantic similarity to the query and still match string
patterns at extraction time.

**Production-log signature.** Responses that quote a superseded BVA rating
decision as if it were still controlling, or cite a CFR section under its
pre-amendment language.

**Control.** Each entry in `RETRIEVAL_CONTEXT` carries metadata:

```json
{
  "effective_date": "2022-03-22",
  "status": "superseded",
  "superseded_by": "BVA 24-01234",
  "last_verified": "2026-03-20"
}
```

When `lib/validate.js` matches a citation to a source whose metadata is
non-active, the status becomes `OUTDATED` and the detail string names the
superseding authority. The advisor uses these cases to suggest temporal-
awareness rules in the prompt (e.g. "explicitly state when a cited decision
has been superseded and identify the superseding authority").

See regression case `003-outdated-citation.json`.

**Limitation.** Metadata is only as fresh as your retrieval index.
`last_verified` is a hint, not a guarantee. Production deployments should
also enforce a max-age on retrieved records.

## 4. Aggregation / reasoning error

**Symptom.** The model computes, compares, ranks, or infers something
beyond what the source packet supports. The individual citations may all
be real and grounded; the *conclusion drawn across them* is not.

**Why it happens.** Asking an LLM to "rank these by favorability" or
"summarize across these cases" turns generation into an analytical task
with no ground truth. The model produces a plausible aggregation that does
not match any retrievable computation.

**Production-log signature.** Responses that present invented numeric
scores, rank-ordering, or "X is more relevant than Y" claims that no
retrieved record actually states.

**Controls.** Two:

1. **Retrieval-first pre-computation.** For queries known to be aggregation-
   heavy, the server pre-computes the answer and provides it as a
   `[PRECOMPUTED_RESULT: ...]` block, and the prompt instructs the model
   to narrate without re-ranking. See `fixes.js` "Fix 4" for a worked
   example.
2. **Adversarial critic.** `critic.js` is explicitly prompted to look for
   "aggregation errors — response combines data from multiple sources in
   ways that create new (unverified) claims" and to flag overstated
   conclusions.

**Limitation.** The critic is an LLM. It catches representative cases but
should not be treated as a guarantee. The pre-computation pattern is
stronger when applicable.

## 5. Misleading use of a real citation

**Symptom.** Every cited identifier appears in the source packet. The
extraction layer is happy. The deterministic validator is happy. But the
sentence the citation is *used to support* says something the source does
not actually say.

**Why it happens.** This is the limit of string-match validation. The
validator confirms a citation exists; it cannot confirm the response uses
the citation honestly.

**Production-log signature.** Responses that cite a service-connection
decision to support a rating-methodology claim, or that present a
discretionary "resolving reasonable doubt" grant as a broad evidentiary
rule.

**Control.** The adversarial critic is the explicit defense here. The
critic prompt enumerates this category as "misleading context" and asks
for the offending sentence plus a suggestion. The advisor in turn proposes
prompt rules like:

> When citing a BVA decision to exemplify a legal principle or regulatory
> rule, explicitly verify that the decision actually addresses that
> principle.

(That is one of the rules the optimizer produced against this fixture —
see `docs/eval-notes.md`.)

**Limitation.** Critic recall is not measured here. Treat it as a useful
second opinion, not a guarantee.

## What this list does not cover

The validator and critic check whether the response is grounded in the
retrieved source packet and used the sources honestly. They do **not**
check:

* Whether the retrieved source packet is itself complete or correct.
* Whether the user's question is answerable from the available corpus.
* Whether the legal analysis is correct.
* Whether the cited authority is the *right* authority for the user's
  fact pattern.

The right framing is: this pipeline catches grounding failures before they
reach a user. Everything past grounding remains a human judgment.
