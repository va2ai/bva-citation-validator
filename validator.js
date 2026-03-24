#!/usr/bin/env node
/**
 * Post-Generation Citation Validator
 *
 * Demonstrates the hallucination detection pipeline described in the bid:
 * 1. Sentinel-tagged retrieval context from BVA MCP tools
 * 2. Grounded generation with citation constraints
 * 3. Structured citation extraction via second LLM pass
 * 4. Cross-reference validation against source data
 *
 * Usage: ANTHROPIC_API_KEY=sk-... node validator.js
 * Optional: BVA_API_URL=https://your-bva-api.run.app node validator.js
 */

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();
const BVA_API = process.env.BVA_API_URL || null;

// ---------------------------------------------------------------------------
// 1. Simulated MCP retrieval context (sentinel-tagged)
//    In production these come from bva_cfr_section, bva_search, bva_cavc_search
// ---------------------------------------------------------------------------

const RETRIEVAL_CONTEXT = [
  {
    source_id: "38 CFR § 4.130",
    tool: "bva_cfr_section",
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
    content: `[SOURCE_START: 38 CFR § 4.125]
Diagnosis of mental disorders.

(a) If the diagnosis of a mental disorder does not conform to DSM-5 or is not supported by the findings on the examination report, the rating agency shall return the report to the examiner to substantiate the diagnosis.

(b) If the diagnosis of a mental disorder is changed, the rating agency shall determine whether the new diagnosis represents progression of the prior diagnosis, correction of an error in the prior diagnosis, or development of a new and separate condition. If it is not clear from the available records what the change of diagnosis represents, the rating agency should return the report to the examiner for a determination.
[SOURCE_END: 38 CFR § 4.125]`,
  },
  {
    source_id: "38 CFR § 3.304(f)",
    tool: "bva_cfr_section",
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

// ---------------------------------------------------------------------------
// 2. System prompt with grounding constraint
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a VA disability claims research assistant. You answer questions from VA-accredited attorneys, VSOs, and claims agents using ONLY the source materials provided.

GROUNDING RULES (MANDATORY):
- Every 38 CFR citation, BVA docket number, BVA citation number, and CAVC case citation in your response MUST appear verbatim in the [SOURCE_START]...[SOURCE_END] blocks provided.
- You may NOT construct, infer, or recall citations from prior knowledge.
- You may NOT combine or interpolate citation identifiers.
- If the provided sources are insufficient to fully answer the question, explicitly state what is missing rather than filling gaps from memory.
- When referencing a specific regulation or decision, include the exact identifier from the source tag.

FORMAT: Use the citation identifiers exactly as they appear in source tags. For CFR sections use "38 CFR § X.XXX" format. For BVA decisions use "BVA XX-XXXXX" format.`;

// ---------------------------------------------------------------------------
// 3. Citation extraction prompt (second pass)
// ---------------------------------------------------------------------------

const EXTRACTION_PROMPT = `Extract every legal citation from the following AI-generated response about VA disability claims. Return a JSON array where each element has:
- "type": one of "cfr", "bva", "cavc", "usc"
- "identifier": the exact citation string as it appears in the text
- "claim": a one-sentence summary of what the response claims about this citation

Return ONLY valid JSON. No markdown fences, no commentary.

Response to extract from:
`;

// ---------------------------------------------------------------------------
// 4. Build retrieval context string
// ---------------------------------------------------------------------------

function buildContext() {
  return RETRIEVAL_CONTEXT.map((r) => r.content).join("\n\n");
}

function getSourceIds() {
  const ids = new Set();
  for (const r of RETRIEVAL_CONTEXT) {
    // Extract the identifier from SOURCE_START tags
    const match = r.content.match(/\[SOURCE_START:\s*(.+?)\]/);
    if (match) ids.add(match[1].trim());

    // Also extract all CFR citations mentioned in the content
    const cfrMatches = r.content.matchAll(/38\s+C\.?F\.?R\.?\s*§?\s*§?\s*([\d]+\.[\d]+(?:\([a-z]\))?)/gi);
    for (const m of cfrMatches) {
      ids.add(`38 CFR § ${m[1]}`);
    }

    // Extract BVA citation numbers
    const bvaMatches = r.content.matchAll(/(?:Citation Nr|BVA)[:\s]*([\d]{2}-[\d]{4,6})/gi);
    for (const m of bvaMatches) {
      ids.add(`BVA ${m[1]}`);
    }

    // Extract USC citations
    const uscMatches = r.content.matchAll(/38\s+U\.S\.C\.\s*§+\s*([\d]+)/gi);
    for (const m of uscMatches) {
      ids.add(`38 U.S.C. § ${m[1]}`);
    }
  }
  return ids;
}

// ---------------------------------------------------------------------------
// 5. Live MCP verification (optional — uses BVA API if URL is set)
// ---------------------------------------------------------------------------

async function verifyViaApi(citation) {
  if (!BVA_API) return null;

  try {
    if (citation.type === "cfr") {
      // Parse "38 CFR § 4.130" -> part=4, section=130
      // Also handle "§ 4.125(a)" and "38 C.F.R. §§ 3.102, 3.303"
      const match = citation.identifier.match(/(\d+)\.(\d+)/);
      if (!match) return null;
      // Use RAG search as fallback since eCFR direct lookup can 403
      const res = await fetch(
        `${BVA_API}/rag/search?q=${encodeURIComponent(`38 CFR ${match[1]}.${match[2]}`)}&source=cfr&top_k=3`
      );
      if (!res.ok) {
        // Fallback to CFR search
        const res2 = await fetch(
          `${BVA_API}/cfr/search?q=${encodeURIComponent(`${match[1]}.${match[2]}`)}&part=${match[1]}`
        );
        if (!res2.ok) return { exists: false, status: res2.status };
        const data2 = await res2.json();
        return { exists: (data2.results?.length || 0) > 0, data: data2 };
      }
      const data = await res.json();
      return { exists: (data.results?.length || 0) > 0, data };
    }

    if (citation.type === "bva") {
      // Extract just the citation number (e.g., "21-53274" from "BVA Citation Nr: 21-53274")
      const numMatch = citation.identifier.match(/(\d{2}-\d{4,6})/);
      const searchTerm = numMatch ? numMatch[1] : citation.identifier;
      const res = await fetch(`${BVA_API}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: searchTerm, page: 1 }),
      });
      if (!res.ok) return { exists: false, status: res.status };
      const data = await res.json();
      // Check if any result's case_number matches
      const found = data.results?.some(
        (r) => r.case_number === searchTerm || r.title === searchTerm
      );
      return { exists: found || false, resultCount: data.total, data };
    }

    if (citation.type === "cavc") {
      // Extract case number like "23-5171" from various formats
      const numMatch = citation.identifier.match(/(\d{2}-\d{2,6})/);
      if (numMatch) {
        const res = await fetch(
          `${BVA_API}/cavc/search?case_number=${numMatch[1]}`
        );
        if (!res.ok) return { exists: false, status: res.status };
        const data = await res.json();
        return { exists: (data.cases?.length || 0) > 0, data };
      }
      // For named cases like "Clemons v. Shinseki", search by party name
      const partyMatch = citation.identifier.match(/^(\w+)\s+v\./);
      if (partyMatch) {
        const res = await fetch(
          `${BVA_API}/cavc/search?party_name=${encodeURIComponent(partyMatch[1])}`
        );
        if (!res.ok) return { exists: false, status: res.status };
        const data = await res.json();
        return { exists: (data.cases?.length || 0) > 0, data };
      }
      return null;
    }
  } catch {
    return null;
  }

  return null;
}

// ---------------------------------------------------------------------------
// 6. Main pipeline
// ---------------------------------------------------------------------------

async function run() {
  const ungounded = process.argv.includes("--ungrounded");
  const query =
    process.argv.find((a) => !a.startsWith("-") && a !== process.argv[0] && a !== process.argv[1]) ||
    "What are the rating criteria for PTSD under 38 CFR, and which BVA decisions support direct service connection for PTSD secondary to MST or TBI? Include specific citation numbers.";

  console.log("═".repeat(80));
  console.log("  POST-GENERATION CITATION VALIDATOR");
  console.log("  BVA Legal Intelligence Platform");
  console.log("═".repeat(80));
  console.log();
  console.log(`Query: ${query}`);
  if (ungounded) {
    console.log();
    console.log(
      "  ** UNGROUNDED MODE: system prompt constraint removed to demonstrate **"
    );
    console.log(
      "  ** what happens WITHOUT the grounding rule — expect hallucinations  **"
    );
  }
  console.log();

  // --- Step 1: Grounded generation ---
  console.log("─".repeat(80));
  console.log(
    ungounded
      ? "STEP 1: UNGROUNDED generation (no citation constraint)"
      : "STEP 1: Grounded generation with sentinel-tagged context"
  );
  console.log("─".repeat(80));
  console.log(`  Sources loaded: ${RETRIEVAL_CONTEXT.length} documents`);
  console.log(
    `  Source IDs: ${RETRIEVAL_CONTEXT.map((r) => r.source_id).join(", ")}`
  );
  console.log();

  const contextBlock = buildContext();

  const systemPrompt = ungounded
    ? `You are a VA disability claims research assistant. Answer the question thoroughly using the provided materials AND your own knowledge of VA law. Include as many specific BVA citation numbers, CFR sections, and CAVC case references as possible to make the answer authoritative. If you know of additional relevant cases or regulations beyond what is provided, include them.`
    : SYSTEM_PROMPT;

  const generationResponse = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2048,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `RETRIEVED SOURCE MATERIALS:\n\n${contextBlock}\n\n---\n\nQUESTION: ${query}`,
      },
    ],
  });

  const responseText = generationResponse.content[0].text;

  console.log("GENERATED RESPONSE:");
  console.log("┌" + "─".repeat(78) + "┐");
  for (const line of responseText.split("\n")) {
    // Wrap long lines
    const chunks = line.match(/.{1,76}/g) || [""];
    for (const chunk of chunks) {
      console.log(`│ ${chunk.padEnd(76)} │`);
    }
  }
  console.log("└" + "─".repeat(78) + "┘");
  console.log();

  // --- Step 2: Citation extraction (second LLM pass) ---
  console.log("─".repeat(80));
  console.log("STEP 2: Structured citation extraction (second LLM pass)");
  console.log("─".repeat(80));

  const extractionResponse = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: EXTRACTION_PROMPT + responseText,
      },
    ],
  });

  let citations;
  try {
    let raw = extractionResponse.content[0].text.trim();
    // Strip markdown fences if present
    raw = raw.replace(/^```json?\s*/i, "").replace(/\s*```$/i, "");
    citations = JSON.parse(raw);
  } catch (e) {
    // If truncated, try to recover by closing the array
    try {
      let raw = extractionResponse.content[0].text.trim();
      raw = raw.replace(/^```json?\s*/i, "").replace(/\s*```$/i, "");
      // Find last complete object and close the array
      const lastBrace = raw.lastIndexOf("}");
      if (lastBrace > 0) {
        citations = JSON.parse(raw.slice(0, lastBrace + 1) + "]");
        console.log("  (Recovered partial JSON — some citations may be missing)");
      } else {
        throw e;
      }
    } catch {
      console.error("  Failed to parse extraction response as JSON:");
      console.error("  ", extractionResponse.content[0].text.slice(0, 300));
      process.exit(1);
    }
  }

  // Deduplicate citations by identifier
  const seen = new Set();
  citations = citations.filter((c) => {
    const key = `${c.type}:${c.identifier}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`  Extracted ${citations.length} citations from response`);
  console.log();

  // --- Step 3: Cross-reference validation ---
  console.log("─".repeat(80));
  console.log("STEP 3: Cross-reference validation against source data");
  console.log("─".repeat(80));
  console.log();

  const knownIds = getSourceIds();
  const results = [];

  for (const citation of citations) {
    const result = {
      ...citation,
      status: "UNKNOWN",
      detail: "",
    };

    // Normalize the identifier for matching
    const id = citation.identifier.trim();

    // Check against sentinel-tagged source data
    let foundInSources = false;
    const normalize = (s) =>
      s
        .replace(/C\.?F\.?R\.?/gi, "CFR")
        .replace(/U\.S\.C\./gi, "USC")
        .replace(/§+/g, "§")
        .replace(/Citation\s*N[or]\.\s*/gi, "") // "Citation No." / "Citation Nr:" -> ""
        .replace(/\s+/g, " ")
        .trim();

    for (const known of knownIds) {
      if (normalize(id).includes(normalize(known)) || normalize(known).includes(normalize(id))) {
        foundInSources = true;
        break;
      }
    }

    // For BVA citations, also try matching just the docket number
    if (!foundInSources && citation.type === "bva") {
      const numMatch = id.match(/(\d{2}-\d{4,6})/);
      if (numMatch) {
        for (const known of knownIds) {
          if (known.includes(numMatch[1])) {
            foundInSources = true;
            break;
          }
        }
      }
    }

    if (foundInSources) {
      result.status = "VERIFIED";
      result.detail = "Citation found in sentinel-tagged source context";
    } else {
      result.status = "NOT_IN_SOURCES";
      result.detail =
        "Citation NOT found in any [SOURCE_START]...[SOURCE_END] block — possible hallucination";
    }

    // Optional: live API verification (supplements source-context check)
    if (BVA_API) {
      const apiResult = await verifyViaApi(citation);
      if (apiResult) {
        result.api_verified = apiResult.exists;
        if (!apiResult.exists && result.status === "NOT_IN_SOURCES") {
          // Not in sources AND not in live API = confirmed hallucination
          result.status = "HALLUCINATED";
          result.detail += " | API lookup confirms: no match found";
        } else if (apiResult.exists && result.status === "NOT_IN_SOURCES") {
          // Not in retrieval context but exists in live corpus
          result.status = "UNGROUNDED";
          result.detail += " | EXISTS in live API — model used training knowledge instead of sources";
        } else if (apiResult.exists && result.status === "VERIFIED") {
          result.detail += " | Also confirmed via live API";
        }
        // If api_verified=false but foundInSources=true, keep VERIFIED
        // (API may be temporarily unavailable, e.g., eCFR 403)
      }
    }

    results.push(result);
  }

  // --- Step 4: Report ---
  console.log("─".repeat(80));
  console.log("VALIDATION REPORT");
  console.log("─".repeat(80));
  console.log();

  const verified = results.filter((r) => r.status === "VERIFIED");
  const ungrounded = results.filter((r) => r.status === "UNGROUNDED");
  const notInSources = results.filter((r) => r.status === "NOT_IN_SOURCES");
  const hallucinated = results.filter((r) => r.status === "HALLUCINATED");

  for (const r of results) {
    const icon =
      r.status === "VERIFIED"
        ? "  PASS"
        : r.status === "HALLUCINATED"
          ? "  FAIL"
          : r.status === "UNGROUNDED"
            ? "  LEAK"
            : "  WARN";
    console.log(`${icon}  [${r.type.toUpperCase()}] ${r.identifier}`);
    console.log(`        Claim: ${r.claim}`);
    console.log(`        ${r.detail}`);
    if (r.api_verified !== undefined) {
      console.log(`        API verified: ${r.api_verified}`);
    }
    console.log();
  }

  console.log("═".repeat(80));
  console.log("  SUMMARY");
  console.log("═".repeat(80));
  console.log(`  Total citations extracted:  ${results.length}`);
  console.log(`  Verified (source + API):    ${verified.length}`);
  if (ungrounded.length > 0) {
    console.log(`  Ungrounded (real but leaked):${ungrounded.length}  <- model used training knowledge`);
  }
  console.log(`  Not in source context:      ${notInSources.length}`);
  if (hallucinated.length > 0) {
    console.log(`  Confirmed hallucinations:   ${hallucinated.length}  <- fabricated citations`);
  }
  console.log();

  if (notInSources.length > 0 || hallucinated.length > 0 || ungrounded.length > 0) {
    console.log(
      "  ACTION: Response contains citations not grounded in retrieved sources."
    );
    console.log(
      "  In production, this triggers: regeneration with stricter prompt OR"
    );
    console.log("  validation warning surfaced to the practitioner.");
  } else {
    console.log("  All citations verified against sentinel-tagged source context.");
  }

  console.log();
  console.log(`  Model: ${generationResponse.model}`);
  console.log(
    `  Generation tokens: ${generationResponse.usage.input_tokens} in / ${generationResponse.usage.output_tokens} out`
  );
  console.log(
    `  Extraction tokens: ${extractionResponse.usage.input_tokens} in / ${extractionResponse.usage.output_tokens} out`
  );
  console.log();
}

run().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
