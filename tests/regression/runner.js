#!/usr/bin/env node
/**
 * Regression Test Runner
 *
 * Runs frozen failure cases against the citation validator pipeline to verify
 * that fixes continue to hold. Each case defines expected citation outcomes
 * that are checked against the validation results.
 *
 * Usage: node tests/regression/runner.js
 * Exit code: 0 = all pass, 1 = regression detected
 */

import { readdir, readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import Anthropic from "@anthropic-ai/sdk";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CASES_DIR = join(__dirname, "cases");

const client = new Anthropic();

// ---------------------------------------------------------------------------
// Shared retrieval context and logic (mirrors validator.js)
// ---------------------------------------------------------------------------

const RETRIEVAL_CONTEXT = [
  {
    source_id: "38 CFR § 4.130",
    tool: "bva_cfr_section",
    metadata: { effective_date: "2021-08-10", status: "active", superseded_by: null, last_verified: "2026-03-20" },
    content: `[SOURCE_START: 38 CFR § 4.130]
Schedule of ratings — Mental disorders.

The nomenclature employed in this portion of the rating schedule is based upon the American Psychiatric Association's Diagnostic and Statistical Manual of Mental Disorders, Fifth Edition (DSM-5). Rating agencies must be thoroughly familiar with this manual to properly implement the directives in § 4.125 through § 4.130.

When evaluating a mental disorder, the rating agency shall consider the frequency, severity, and duration of psychiatric symptoms, the length of remissions, and the veteran's capacity for adjustment during periods of remission. The rating agency shall assign an evaluation based on all the evidence of record that bears on occupational and social impairment rather than solely on the examiner's assessment of the level of disability at the moment of the examination.

General Rating Formula for Mental Disorders:
- 100% — Total occupational and social impairment
- 70% — Occupational and social impairment, with deficiencies in most areas
- 50% — Occupational and social impairment with reduced reliability and productivity
- 30% — Occupational and social impairment with occasional decrease in work efficiency
- 10% — Occupational and social impairment due to mild or transient symptoms
- 0% — A mental condition has been formally diagnosed, but symptoms are not severe enough

Diagnostic codes: 9201-9440
[SOURCE_END: 38 CFR § 4.130]`,
  },
  {
    source_id: "38 CFR § 4.125",
    tool: "bva_cfr_section",
    metadata: { effective_date: "2021-08-10", status: "active", superseded_by: null, last_verified: "2026-03-20" },
    content: `[SOURCE_START: 38 CFR § 4.125]
Diagnosis of mental disorders.

(a) If the diagnosis of a mental disorder does not conform to DSM-5 or is not supported by the findings on the examination report, the rating agency shall return the report to the examiner to substantiate the diagnosis.

(b) If the diagnosis of a mental disorder is changed, the rating agency shall determine whether the new diagnosis represents progression of the prior diagnosis, correction of an error in the prior diagnosis, or development of a new and separate condition. If it is not clear from the available records what the change of diagnosis represents, the rating agency should return the report to the examiner for a determination.
[SOURCE_END: 38 CFR § 4.125]`,
  },
  {
    source_id: "38 CFR § 3.304(f)",
    tool: "bva_cfr_section",
    metadata: { effective_date: "2018-08-06", status: "active", superseded_by: null, last_verified: "2026-03-20" },
    content: `[SOURCE_START: 38 CFR § 3.304(f)]
Post-traumatic stress disorder.

Service connection for post-traumatic stress disorder requires medical evidence diagnosing the condition in accordance with § 4.125(a) of this chapter; a link, established by medical evidence, between current symptoms and an in-service stressor; and credible supporting evidence that the claimed in-service stressor occurred.

If the evidence establishes that the veteran engaged in combat with the enemy and the claimed stressor is related to that combat, in the absence of clear and convincing evidence to the contrary, and provided that the claimed stressor is consistent with the circumstances, conditions, or hardships of the veteran's service, the veteran's lay testimony alone may establish the occurrence of the claimed in-service stressor.

For claims involving military sexual trauma (MST), evidence from sources other than the veteran's service records may corroborate the veteran's account of the stressor incident, including records from law enforcement authorities, rape crisis centers, mental health counseling centers, hospitals, or physicians.
[SOURCE_END: 38 CFR § 3.304(f)]`,
  },
  {
    source_id: "BVA 21-53274",
    tool: "bva_search",
    metadata: { decision_date: "2021-09-14", status: "active", superseded_by: null, last_verified: "2026-03-20" },
    content: `[SOURCE_START: BVA 21-53274]
BOARD OF VETERANS' APPEALS
Citation Nr: 21-53274
Docket No. 19-27831
Decision Date: 09/14/2021

ISSUE: Entitlement to service connection for PTSD, claimed as secondary to military sexual trauma (MST).

FINDINGS OF FACT:
1. The Veteran served on active duty from March 2004 to August 2008.
2. The record contains credible evidence corroborating the claimed MST stressor.
3. A VA examiner diagnosed PTSD under DSM-5 criteria and linked it to the in-service MST stressor.

CONCLUSION OF LAW:
The criteria for service connection for PTSD have been met. 38 U.S.C. §§ 1110, 5107; 38 C.F.R. §§ 3.102, 3.303, 3.304(f).

ORDER: Service connection for PTSD is granted.
[SOURCE_END: BVA 21-53274]`,
  },
  {
    source_id: "BVA 22-18467",
    tool: "bva_search",
    metadata: { decision_date: "2022-03-22", status: "superseded", superseded_by: "BVA 24-01234", last_verified: "2026-03-20" },
    content: `[SOURCE_START: BVA 22-18467]
BOARD OF VETERANS' APPEALS
Citation Nr: 22-18467
Docket No. 20-14552
Decision Date: 03/22/2022

ISSUE: Entitlement to an initial rating in excess of 50 percent for service-connected PTSD.

FINDINGS OF FACT:
1. Throughout the appeal period, the Veteran's PTSD has been manifested by occupational and social impairment with deficiencies in most areas, including work, family relations, and mood.
2. The evidence does not show total occupational and social impairment at any point during the appeal period.

CONCLUSION OF LAW:
The criteria for a 70 percent rating, but no higher, for PTSD have been met. 38 U.S.C. §§ 1155, 5107; 38 C.F.R. §§ 4.7, 4.130, Diagnostic Code 9411.

ORDER: A 70 percent rating for PTSD is granted, subject to the laws and regulations governing the payment of monetary benefits.
[SOURCE_END: BVA 22-18467]`,
  },
  {
    source_id: "BVA 23-09881",
    tool: "bva_search",
    metadata: { decision_date: "2023-02-10", status: "active", superseded_by: null, last_verified: "2026-03-20" },
    content: `[SOURCE_START: BVA 23-09881]
BOARD OF VETERANS' APPEALS
Citation Nr: 23-09881
Docket No. 21-30045
Decision Date: 02/10/2023

ISSUE: Entitlement to service connection for PTSD with cognitive residuals secondary to traumatic brain injury (TBI).

FINDINGS OF FACT:
1. The Veteran sustained a documented TBI from an IED blast during deployment to Afghanistan in 2010.
2. A private neuropsychologist provided a nexus opinion linking current PTSD symptoms with cognitive overlay to the in-service TBI.
3. The VA examiner's negative opinion failed to account for the Veteran's documented TBI and is afforded less probative weight.

CONCLUSION OF LAW:
Resolving reasonable doubt in the Veteran's favor, the criteria for service connection for PTSD with cognitive residuals secondary to TBI have been met. 38 U.S.C. §§ 1110, 5107; 38 C.F.R. §§ 3.102, 3.303, 3.310.

ORDER: Service connection for PTSD with cognitive residuals secondary to TBI is granted.
[SOURCE_END: BVA 23-09881]`,
  },
];

const GROUNDED_PROMPT = `You are a VA disability claims research assistant. You answer questions from VA-accredited attorneys, VSOs, and claims agents using ONLY the source materials provided.

GROUNDING RULES (MANDATORY):
- Every 38 CFR citation, BVA docket number, BVA citation number, and CAVC case citation in your response MUST appear verbatim in the [SOURCE_START]...[SOURCE_END] blocks provided.
- You may NOT construct, infer, or recall citations from prior knowledge.
- You may NOT combine or interpolate citation identifiers.
- If the provided sources are insufficient to fully answer the question, explicitly state what is missing rather than filling gaps from memory.
- When referencing a specific regulation or decision, include the exact identifier from the source tag.

FORMAT: Use the citation identifiers exactly as they appear in source tags. For CFR sections use "38 CFR § X.XXX" format. For BVA decisions use "BVA XX-XXXXX" format.`;

const EXTRACTION_PROMPT = `Extract every legal citation from the following AI-generated response about VA disability claims. Return a JSON array where each element has:
- "type": one of "cfr", "bva", "cavc", "usc"
- "identifier": the exact citation string as it appears in the text
- "claim": a one-sentence summary of what the response claims about this citation

Return ONLY valid JSON. No markdown fences, no commentary.

Response to extract from:
`;

function getSourceIds() {
  const ids = new Set();
  for (const r of RETRIEVAL_CONTEXT) {
    const match = r.content.match(/\[SOURCE_START:\s*(.+?)\]/);
    if (match) ids.add(match[1].trim());
    for (const m of r.content.matchAll(/38\s+C\.?F\.?R\.?\s*§?\s*§?\s*([\d]+\.[\d]+(?:\([a-z]\))?)/gi))
      ids.add(`38 CFR § ${m[1]}`);
    for (const m of r.content.matchAll(/(?:Citation Nr|BVA)[:\s]*([\d]{2}-[\d]{4,6})/gi))
      ids.add(`BVA ${m[1]}`);
    for (const m of r.content.matchAll(/38\s+U\.S\.C\.\s*§+\s*([\d]+)/gi))
      ids.add(`38 U.S.C. § ${m[1]}`);
  }
  return ids;
}

function getSourceMetadata() {
  const metadata = new Map();
  for (const r of RETRIEVAL_CONTEXT) {
    if (r.metadata) metadata.set(r.source_id, r.metadata);
  }
  return metadata;
}

// ---------------------------------------------------------------------------
// Run a single validation pipeline (grounded mode)
// ---------------------------------------------------------------------------

async function runPipeline(query) {
  const contextBlock = RETRIEVAL_CONTEXT.map((r) => r.content).join("\n\n");

  // Step 1: Generation
  const genResponse = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    system: GROUNDED_PROMPT,
    messages: [{ role: "user", content: `RETRIEVED SOURCE MATERIALS:\n\n${contextBlock}\n\n---\n\nQUESTION: ${query}` }],
  });
  const responseText = genResponse.content[0].text;

  // Step 2: Extraction
  const extResponse = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4096,
    messages: [{ role: "user", content: EXTRACTION_PROMPT + responseText }],
  });

  let citations;
  try {
    let raw = extResponse.content[0].text.trim().replace(/^```json?\s*/i, "").replace(/\s*```$/i, "");
    citations = JSON.parse(raw);
  } catch {
    try {
      let raw = extResponse.content[0].text.trim().replace(/^```json?\s*/i, "").replace(/\s*```$/i, "");
      const lastBrace = raw.lastIndexOf("}");
      citations = JSON.parse(raw.slice(0, lastBrace + 1) + "]");
    } catch {
      citations = [];
    }
  }

  const seen = new Set();
  citations = citations.filter((c) => {
    const key = `${c.type}:${c.identifier}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Step 3: Validation
  const knownIds = getSourceIds();
  const sourceMetadata = getSourceMetadata();
  const results = [];

  for (const citation of citations) {
    const result = { ...citation, status: "UNKNOWN", detail: "" };
    const id = citation.identifier.trim();
    const normalize = (s) =>
      s.replace(/C\.?F\.?R\.?/gi, "CFR").replace(/U\.S\.C\./gi, "USC")
        .replace(/§+/g, "§").replace(/Citation\s*N[or]\.\s*/gi, "").replace(/\s+/g, " ").trim();

    let foundInSources = false;
    let matchedSourceId = null;
    for (const known of knownIds) {
      if (normalize(id).includes(normalize(known)) || normalize(known).includes(normalize(id))) {
        foundInSources = true;
        for (const r of RETRIEVAL_CONTEXT) {
          if (r.source_id === known || r.content.includes(`[SOURCE_START: ${known}]`)) {
            matchedSourceId = r.source_id;
            break;
          }
        }
        break;
      }
    }
    if (!foundInSources && citation.type === "bva") {
      const numMatch = id.match(/(\d{2}-\d{4,6})/);
      if (numMatch) {
        for (const known of knownIds) {
          if (known.includes(numMatch[1])) {
            foundInSources = true;
            for (const r of RETRIEVAL_CONTEXT) {
              if (r.source_id.includes(numMatch[1])) { matchedSourceId = r.source_id; break; }
            }
            break;
          }
        }
      }
    }

    if (foundInSources) {
      const meta = matchedSourceId ? sourceMetadata.get(matchedSourceId) : null;
      if (meta && meta.status !== "active") {
        result.status = "OUTDATED";
        result.detail = `Citation found in sources but ${meta.status}`;
        if (meta.superseded_by) result.detail += ` — superseded by ${meta.superseded_by}`;
      } else {
        result.status = "VERIFIED";
        result.detail = "Citation found in sentinel-tagged source context";
      }
    } else {
      result.status = "NOT_IN_SOURCES";
      result.detail = "Citation NOT found in any [SOURCE_START]...[SOURCE_END] block";
    }

    results.push(result);
  }

  return { responseText, citations, results };
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

async function runTests() {
  const files = (await readdir(CASES_DIR)).filter((f) => f.endsWith(".json")).sort();
  const testResults = [];
  let passed = 0;
  let failed = 0;

  console.log("═".repeat(80));
  console.log("  REGRESSION TEST SUITE");
  console.log("═".repeat(80));
  console.log();

  for (const file of files) {
    const testCase = JSON.parse(await readFile(join(CASES_DIR, file), "utf-8"));
    console.log(`─ Case ${testCase.id}: ${testCase.name}`);
    console.log(`  Fix: ${testCase.fix_applied} | Mode: ${testCase.failure_mode}`);

    try {
      const { results } = await runPipeline(testCase.query);
      const normalize = (s) =>
        s.replace(/C\.?F\.?R\.?/gi, "CFR").replace(/U\.S\.C\./gi, "USC")
          .replace(/§+/g, "§").replace(/\s+/g, " ").trim();

      let casePass = true;

      // Check expected verified citations
      if (testCase.expected_verified) {
        for (const expected of testCase.expected_verified) {
          const found = results.some(
            (r) => r.status === "VERIFIED" && normalize(r.identifier).includes(normalize(expected))
          );
          if (!found) {
            console.log(`  FAIL: Expected VERIFIED citation "${expected}" not found`);
            casePass = false;
          }
        }
      }

      // Check expected outdated citations
      if (testCase.expected_outdated) {
        for (const expected of testCase.expected_outdated) {
          const found = results.some(
            (r) => r.status === "OUTDATED" && normalize(r.identifier).includes(normalize(expected))
          );
          if (!found) {
            console.log(`  FAIL: Expected OUTDATED citation "${expected}" not found`);
            casePass = false;
          }
        }
      }

      // Check that known bad citations are flagged (NOT_IN_SOURCES or HALLUCINATED)
      if (testCase.known_bad_citations) {
        for (const bad of testCase.known_bad_citations) {
          const found = results.find(
            (r) => normalize(r.identifier).includes(normalize(bad))
          );
          if (found && found.status === "VERIFIED") {
            console.log(`  FAIL: Known bad citation "${bad}" was VERIFIED (should be flagged)`);
            casePass = false;
          }
        }
      }

      // Check expected NOT_IN_SOURCES by type
      if (testCase.expected_not_in_sources_types) {
        for (const type of testCase.expected_not_in_sources_types) {
          const ofType = results.filter((r) => r.type === type);
          const allFlagged = ofType.every((r) => r.status !== "VERIFIED");
          if (!allFlagged && ofType.length > 0) {
            console.log(`  FAIL: Expected all "${type}" citations to be flagged, but some were VERIFIED`);
            casePass = false;
          }
        }
      }

      if (casePass) {
        console.log(`  PASS`);
        passed++;
      } else {
        failed++;
      }

      testResults.push({ id: testCase.id, name: testCase.name, pass: casePass });
    } catch (err) {
      console.log(`  ERROR: ${err.message}`);
      failed++;
      testResults.push({ id: testCase.id, name: testCase.name, pass: false, error: err.message });
    }

    console.log();
  }

  console.log("═".repeat(80));
  console.log(`  RESULTS: ${passed} passed, ${failed} failed (${files.length} total)`);
  console.log("═".repeat(80));

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
