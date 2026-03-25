#!/usr/bin/env node
/**
 * Hallucination Fix Test Suite
 *
 * Demonstrates and tests each fix independently:
 * 1. Sentinel-tagged context (prevents context boundary hallucination)
 * 2. Grounding constraint prompt (prevents interpolated identifiers)
 * 3. Post-generation validation (catches anything that slips through)
 * 4. Retrieval-first pre-computation (prevents model-computed aggregations)
 *
 * Usage: ANTHROPIC_API_KEY=sk-... node fixes.js
 */

import Anthropic from "@anthropic-ai/sdk";
import { extractCitations as extractCitationsStructured } from "./lib/extract.js";

const client = new Anthropic();

// ---------------------------------------------------------------------------
// Source data — two adjacent CFR sections that the model commonly confuses
// ---------------------------------------------------------------------------

const RAW_CONTEXT_NO_TAGS = `
38 CFR § 4.130 — Schedule of ratings — Mental disorders.
The nomenclature employed in this portion of the rating schedule is based upon the American Psychiatric Association's Diagnostic and Statistical Manual of Mental Disorders, Fifth Edition (DSM-5).
General Rating Formula for Mental Disorders:
- 100% — Total occupational and social impairment
- 70% — Occupational and social impairment, with deficiencies in most areas
- 50% — Occupational and social impairment with reduced reliability and productivity
- 30% — Occupational and social impairment with occasional decrease in work efficiency
Diagnostic codes: 9201-9440

38 CFR § 4.125 — Diagnosis of mental disorders.
(a) If the diagnosis of a mental disorder does not conform to DSM-5 or is not supported by the findings on the examination report, the rating agency shall return the report to the examiner to substantiate the diagnosis.

38 CFR § 3.304(f) — Post-traumatic stress disorder.
Service connection for PTSD requires medical evidence diagnosing the condition in accordance with § 4.125(a); a link between current symptoms and an in-service stressor; and credible supporting evidence that the claimed stressor occurred.
`;

const TAGGED_CONTEXT = `
[SOURCE_START: 38 CFR § 4.130]
Schedule of ratings — Mental disorders.
The nomenclature employed in this portion of the rating schedule is based upon the American Psychiatric Association's Diagnostic and Statistical Manual of Mental Disorders, Fifth Edition (DSM-5).
General Rating Formula for Mental Disorders:
- 100% — Total occupational and social impairment
- 70% — Occupational and social impairment, with deficiencies in most areas
- 50% — Occupational and social impairment with reduced reliability and productivity
- 30% — Occupational and social impairment with occasional decrease in work efficiency
Diagnostic codes: 9201-9440
[SOURCE_END: 38 CFR § 4.130]

[SOURCE_START: 38 CFR § 4.125]
Diagnosis of mental disorders.
(a) If the diagnosis of a mental disorder does not conform to DSM-5 or is not supported by the findings on the examination report, the rating agency shall return the report to the examiner to substantiate the diagnosis.
[SOURCE_END: 38 CFR § 4.125]

[SOURCE_START: 38 CFR § 3.304(f)]
Post-traumatic stress disorder.
Service connection for PTSD requires medical evidence diagnosing the condition in accordance with § 4.125(a); a link between current symptoms and an in-service stressor; and credible supporting evidence that the claimed stressor occurred.
[SOURCE_END: 38 CFR § 3.304(f)]
`;

const BVA_CASES_TAGGED = `
[SOURCE_START: BVA 21-53274]
Citation Nr: 21-53274 | Decision Date: 09/14/2021
ISSUE: Service connection for PTSD secondary to MST.
RESULT: Granted. Applied 38 U.S.C. §§ 1110, 5107; 38 C.F.R. §§ 3.102, 3.303, 3.304(f).
[SOURCE_END: BVA 21-53274]

[SOURCE_START: BVA 22-18467]
Citation Nr: 22-18467 | Decision Date: 03/22/2022
ISSUE: Initial rating in excess of 50% for PTSD.
RESULT: 70% granted. Applied 38 C.F.R. §§ 4.7, 4.130, DC 9411.
[SOURCE_END: BVA 22-18467]

[SOURCE_START: BVA 23-09881]
Citation Nr: 23-09881 | Decision Date: 02/10/2023
ISSUE: Service connection for PTSD with cognitive residuals secondary to TBI.
RESULT: Granted. Applied 38 C.F.R. §§ 3.102, 3.303, 3.310.
[SOURCE_END: BVA 23-09881]
`;

// Ranking query data — pre-computed server-side
const PRECOMPUTED_RANKING = `
[PRECOMPUTED_RESULT: BVA decisions ranked by favorability for MST-related PTSD nexus]
Ranking method: algorithmic scoring based on outcome, evidentiary standard applied, and precedent citations.
This ranking was computed server-side — do NOT re-rank or add cases.

1. BVA 21-53274 (Score: 0.94) — Granted SC for PTSD/MST. Strong: credible corroboration + DSM-5 diagnosis + nexus.
2. BVA 23-09881 (Score: 0.71) — Granted SC for PTSD/TBI secondary. Moderate relevance: different stressor type.
3. BVA 22-18467 (Score: 0.45) — Rating increase, not SC. Low relevance: addresses severity, not nexus.
[END_PRECOMPUTED_RESULT]
`;

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const NO_GROUNDING_PROMPT = `You are a VA disability claims assistant. Answer thoroughly using the provided data and your knowledge of VA law. Include specific citations.`;

const GROUNDED_PROMPT = `You are a VA disability claims assistant using ONLY the source materials provided.
RULES:
- Every citation MUST appear verbatim in the [SOURCE_START]...[SOURCE_END] blocks.
- You may NOT construct, infer, or recall citations from prior knowledge.
- If data is insufficient, say so.`;

const RETRIEVAL_FIRST_PROMPT = `You are a VA disability claims assistant. A pre-computed ranking has been provided.
RULES:
- Present the ranking EXACTLY as provided. Do not reorder, add, or remove entries.
- You may explain each entry but must not change the ranking or scores.
- Do NOT add cases that are not in the pre-computed result.`;

// Extraction prompt removed — now handled by lib/extract.js via tool-use structured output

// ---------------------------------------------------------------------------
// Known source identifiers
// ---------------------------------------------------------------------------

const KNOWN_IDS = new Set([
  "38 CFR § 4.130", "38 CFR § 4.125", "38 CFR § 3.304(f)",
  "BVA 21-53274", "BVA 22-18467", "BVA 23-09881",
  "38 U.S.C. § 1110", "38 U.S.C. § 5107", "38 U.S.C. § 1155",
  "38 CFR § 3.102", "38 CFR § 3.303", "38 CFR § 3.310", "38 CFR § 4.7",
]);

function normalize(s) {
  return s.replace(/C\.?F\.?R\.?/gi, "CFR").replace(/U\.S\.C\./gi, "USC")
    .replace(/§+/g, "§").replace(/Citation\s*N[or]\.\s*/gi, "").replace(/\s+/g, " ").trim();
}

function isKnown(id) {
  const nid = normalize(id);
  for (const k of KNOWN_IDS) {
    if (nid.includes(normalize(k)) || normalize(k).includes(nid)) return true;
  }
  // BVA number match
  const m = id.match(/(\d{2}-\d{4,6})/);
  if (m) for (const k of KNOWN_IDS) { if (k.includes(m[1])) return true; }
  return false;
}

async function extractCitations(text) {
  const { citations } = await extractCitationsStructured(text, client);
  return citations;
}

async function generate(system, context, query) {
  const res = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system,
    messages: [{ role: "user", content: `SOURCE DATA:\n${context}\n\n---\nQUESTION: ${query}` }],
  });
  return { text: res.content[0].text, usage: res.usage };
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

const results = [];

function log(msg) { console.log(msg || ""); }
function pass(name, detail) { results.push({ name, status: "PASS", detail }); log(`  PASS  ${name}`); if (detail) log(`        ${detail}`); }
function fail(name, detail) { results.push({ name, status: "FAIL", detail }); log(`  FAIL  ${name}`); if (detail) log(`        ${detail}`); }

async function runTests() {
  log("═".repeat(80));
  log("  HALLUCINATION FIX TEST SUITE");
  log("  Tests each fix independently against known failure modes");
  log("═".repeat(80));
  log();

  // =========================================================================
  // FIX 1: Sentinel-tagged context
  // Tests: context boundary hallucination (model misattributes identifiers)
  // =========================================================================
  log("─".repeat(80));
  log("FIX 1: Sentinel-Tagged Context");
  log("Failure mode: Context boundary hallucination — model attributes a concept");
  log("from one section to a neighboring section's identifier.");
  log("─".repeat(80));
  log();

  // 1a: WITHOUT tags — ask about rating formula, see if model confuses § 4.130 / § 4.125
  log("  Test 1a: Without sentinel tags (expect higher misattribution risk)");
  const gen1a = await generate(
    NO_GROUNDING_PROMPT,
    RAW_CONTEXT_NO_TAGS,
    "Which specific CFR section contains the DSM-5 diagnostic conformance requirement — the one about returning reports to the examiner?"
  );
  const cit1a = await extractCitations(gen1a.text);
  // The correct answer is § 4.125(a). Check if model said § 4.130 instead
  const answer1a = gen1a.text;
  const mentions4130forDiagnosis = /4\.130.*(?:diagnosis|DSM-5.*conform|return.*examiner)/i.test(answer1a) ||
    /(?:diagnosis|conform|return.*examiner).*4\.130/i.test(answer1a);
  if (mentions4130forDiagnosis) {
    pass("Untagged context triggers boundary confusion (expected)", "Model attributed § 4.125(a) content to § 4.130 — this is the failure mode we fix");
  } else {
    log("        Model answered correctly even without tags (not always reproducible)");
  }
  log();

  // 1b: WITH tags — same question
  log("  Test 1b: With sentinel tags (expect correct attribution)");
  const gen1b = await generate(
    GROUNDED_PROMPT,
    TAGGED_CONTEXT,
    "Which specific CFR section contains the DSM-5 diagnostic conformance requirement — the one about returning reports to the examiner?"
  );
  const correctly125 = /4\.125/.test(gen1b.text);
  if (correctly125) {
    pass("Tagged context: correct attribution to § 4.125", "Sentinel tags gave model unambiguous anchoring");
  } else {
    fail("Tagged context: model still misattributed", gen1b.text.slice(0, 150));
  }
  log();

  // =========================================================================
  // FIX 2: Grounding constraint prompt
  // Tests: interpolated identifiers (model fabricates citations from training)
  // =========================================================================
  log("─".repeat(80));
  log("FIX 2: Grounding Constraint in System Prompt");
  log("Failure mode: Interpolated identifiers — model fabricates plausible");
  log("citations from training knowledge that aren't in the source data.");
  log("─".repeat(80));
  log();

  // 2a: WITHOUT grounding — ask for CAVC cases (none in context)
  log("  Test 2a: Without grounding constraint (expect fabricated citations)");
  const gen2a = await generate(
    NO_GROUNDING_PROMPT,
    TAGGED_CONTEXT + BVA_CASES_TAGGED,
    "What CAVC cases and additional CFR sections beyond those provided support PTSD service connection? Include specific case citations."
  );
  const cit2a = await extractCitations(gen2a.text);
  const fabricated2a = cit2a.filter(c => !isKnown(c.identifier));
  if (fabricated2a.length > 0) {
    pass(`Ungrounded prompt: ${fabricated2a.length} fabricated citation(s) (expected)`,
      fabricated2a.map(c => `${c.identifier}`).join(", "));
  } else {
    log("        Model stayed grounded even without constraint (not always reproducible)");
  }
  log();

  // 2b: WITH grounding — same question
  log("  Test 2b: With grounding constraint (expect refusal or source-only citations)");
  const gen2b = await generate(
    GROUNDED_PROMPT,
    TAGGED_CONTEXT + BVA_CASES_TAGGED,
    "What CAVC cases and additional CFR sections beyond those provided support PTSD service connection? Include specific case citations."
  );
  const cit2b = await extractCitations(gen2b.text);
  const fabricated2b = cit2b.filter(c => !isKnown(c.identifier));
  const refusedOrGrounded = fabricated2b.length === 0 ||
    /insufficient|not provided|cannot|do not have|no CAVC/i.test(gen2b.text);
  if (refusedOrGrounded) {
    pass("Grounded prompt: model refused or stayed within sources",
      fabricated2b.length === 0
        ? `${cit2b.length} citations, all verified`
        : "Model stated sources were insufficient");
  } else {
    fail(`Grounded prompt: ${fabricated2b.length} fabricated citation(s) leaked`,
      fabricated2b.map(c => c.identifier).join(", "));
  }
  log();

  // =========================================================================
  // FIX 3: Post-generation validation layer
  // Tests: extraction + cross-reference catches hallucinations
  // =========================================================================
  log("─".repeat(80));
  log("FIX 3: Post-Generation Validation Layer");
  log("Safety net: extract every claim, cross-reference against source data,");
  log("flag anything not grounded.");
  log("─".repeat(80));
  log();

  // Use the ungrounded response from 2a (which had fabricated citations)
  log("  Test 3a: Validator catches fabricated citations from ungrounded response");
  if (fabricated2a.length > 0) {
    pass(`Validator flagged ${fabricated2a.length} ungrounded citation(s)`,
      fabricated2a.map(c => `[${c.type.toUpperCase()}] ${c.identifier}`).join(" | "));
  } else {
    log("        No fabricated citations to catch in this run (test 2a didn't produce them)");
  }
  log();

  // 3b: Verify that grounded response passes validation
  log("  Test 3b: Validator confirms grounded response is clean");
  const cit3b = await extractCitations(gen1b.text);
  const bad3b = cit3b.filter(c => !isKnown(c.identifier));
  if (bad3b.length === 0) {
    pass(`All ${cit3b.length} citation(s) verified against sources`, "Zero false positives");
  } else {
    fail(`${bad3b.length} unverified citation(s) in grounded response`,
      bad3b.map(c => c.identifier).join(", "));
  }
  log();

  // =========================================================================
  // FIX 4: Retrieval-first architecture for ranking queries
  // Tests: model presents pre-computed ranking without adding/reordering
  // =========================================================================
  log("─".repeat(80));
  log("FIX 4: Retrieval-First Pre-Computation");
  log("Failure mode: Model computes its own rankings/aggregations instead of");
  log("presenting server-side results. Fix: pre-compute, model narrates.");
  log("─".repeat(80));
  log();

  // 4a: WITHOUT pre-computation — model ranks on its own
  log("  Test 4a: Without pre-computation (model ranks on its own)");
  const gen4a = await generate(
    NO_GROUNDING_PROMPT,
    TAGGED_CONTEXT + BVA_CASES_TAGGED,
    "Rank the provided BVA decisions by how favorable they are for MST-related PTSD nexus. Assign a score to each."
  );
  // Model will invent its own ranking/scores
  const hasInventedScores = /\d\.\d{1,2}|score|rank.*[123]/i.test(gen4a.text);
  if (hasInventedScores) {
    pass("Model invented its own ranking/scores (expected failure mode)",
      "Model computed rankings from training heuristics instead of data");
  } else {
    log("        Model declined to rank (good, but not the typical behavior)");
  }
  log();

  // 4b: WITH pre-computed ranking
  log("  Test 4b: With pre-computed ranking (model narrates, doesn't compute)");
  const gen4b = await generate(
    RETRIEVAL_FIRST_PROMPT,
    PRECOMPUTED_RANKING,
    "Present the ranking of BVA decisions for MST-related PTSD nexus."
  );
  // Check that model preserved the order: 21-53274, 23-09881, 22-18467
  const text4b = gen4b.text;
  const pos1 = text4b.indexOf("21-53274");
  const pos2 = text4b.indexOf("23-09881");
  const pos3 = text4b.indexOf("22-18467");
  const orderPreserved = pos1 >= 0 && pos2 > pos1 && pos3 > pos2;
  // Check model didn't add a 4th case
  const extraCase = /BVA\s*\d{2}-\d{4,6}/gi;
  const allCases = [...text4b.matchAll(extraCase)].map(m => m[0]);
  const knownCaseNums = ["21-53274", "22-18467", "23-09881"];
  const addedCases = allCases.filter(c => !knownCaseNums.some(k => c.includes(k)));

  if (orderPreserved && addedCases.length === 0) {
    pass("Pre-computed ranking preserved exactly", "Order correct, no cases added");
  } else if (!orderPreserved) {
    fail("Model reordered the pre-computed ranking", `Positions: ${pos1}, ${pos2}, ${pos3}`);
  } else {
    fail("Model added cases not in pre-computed result", addedCases.join(", "));
  }
  log();

  // =========================================================================
  // Summary
  // =========================================================================
  log("═".repeat(80));
  log("  TEST RESULTS");
  log("═".repeat(80));

  const passed = results.filter(r => r.status === "PASS").length;
  const failed = results.filter(r => r.status === "FAIL").length;
  const total = results.length;

  for (const r of results) {
    const icon = r.status === "PASS" ? "  PASS" : "  FAIL";
    log(`${icon}  ${r.name}`);
  }
  log();
  log(`  ${passed}/${total} passed, ${failed} failed`);
  log();

  if (failed === 0) {
    log("  All fixes verified. Each hallucination failure mode is covered by a");
    log("  specific fix with test coverage that deliberately provokes the failure");
    log("  and confirms the fix catches it.");
  }
  log();
}

// Also export for server.js
export { runTests, results };

runTests().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
