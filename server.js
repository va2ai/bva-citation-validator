#!/usr/bin/env node
import 'dotenv/config';
/**
 * Web GUI for the Post-Generation Citation Validator.
 * Usage: ANTHROPIC_API_KEY=sk-... node server.js
 * Optional: BVA_API_URL=https://your-api.run.app node server.js
 */

import { createServer } from "http";
import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import Anthropic from "@anthropic-ai/sdk";
import { runCritic } from "./critic.js";
import { createSession, logStep, finalizeSession } from "./lib/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const client = new Anthropic();
const BVA_API = process.env.BVA_API_URL || null;
const PORT = process.env.PORT || 4000;

// ---------------------------------------------------------------------------
// Retrieval context (same as validator.js)
// ---------------------------------------------------------------------------

const RETRIEVAL_CONTEXT = [
  {
    source_id: "38 CFR § 4.130",
    tool: "bva_cfr_section",
    metadata: {
      effective_date: "2021-08-10",
      status: "active",
      superseded_by: null,
      last_verified: "2026-03-20",
    },
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
    metadata: {
      effective_date: "2021-08-10",
      status: "active",
      superseded_by: null,
      last_verified: "2026-03-20",
    },
    content: `[SOURCE_START: 38 CFR § 4.125]
Diagnosis of mental disorders.

(a) If the diagnosis of a mental disorder does not conform to DSM-5 or is not supported by the findings on the examination report, the rating agency shall return the report to the examiner to substantiate the diagnosis.

(b) If the diagnosis of a mental disorder is changed, the rating agency shall determine whether the new diagnosis represents progression of the prior diagnosis, correction of an error in the prior diagnosis, or development of a new and separate condition. If it is not clear from the available records what the change of diagnosis represents, the rating agency should return the report to the examiner for a determination.
[SOURCE_END: 38 CFR § 4.125]`,
  },
  {
    source_id: "38 CFR § 3.304(f)",
    tool: "bva_cfr_section",
    metadata: {
      effective_date: "2018-08-06",
      status: "active",
      superseded_by: null,
      last_verified: "2026-03-20",
    },
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
    metadata: {
      decision_date: "2021-09-14",
      status: "active",
      superseded_by: null,
      last_verified: "2026-03-20",
    },
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
    metadata: {
      decision_date: "2022-03-22",
      status: "superseded",
      superseded_by: "BVA 24-01234",
      last_verified: "2026-03-20",
    },
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
    metadata: {
      decision_date: "2023-02-10",
      status: "active",
      superseded_by: null,
      last_verified: "2026-03-20",
    },
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

const UNGROUNDED_PROMPT = `You are a VA disability claims research assistant. Answer the question thoroughly using the provided materials AND your own knowledge of VA law. Include as many specific BVA citation numbers, CFR sections, and CAVC case references as possible to make the answer authoritative. If you know of additional relevant cases or regulations beyond what is provided, include them.`;

const EXTRACTION_PROMPT = `Extract every legal citation from the following AI-generated response about VA disability claims. Return a JSON array where each element has:
- "type": one of "cfr", "bva", "cavc", "usc"
- "identifier": the exact citation string as it appears in the text
- "claim": a one-sentence summary of what the response claims about this citation

Return ONLY valid JSON. No markdown fences, no commentary.

Response to extract from:
`;

// ---------------------------------------------------------------------------
// Validation logic
// ---------------------------------------------------------------------------

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
    if (r.metadata) {
      metadata.set(r.source_id, r.metadata);
    }
  }
  return metadata;
}

async function verifyViaApi(citation) {
  if (!BVA_API) return null;
  try {
    if (citation.type === "cfr") {
      const match = citation.identifier.match(/(\d+)\.(\d+)/);
      if (!match) return null;
      const res = await fetch(`${BVA_API}/rag/search?q=${encodeURIComponent(`38 CFR ${match[1]}.${match[2]}`)}&source=cfr&top_k=3`);
      if (!res.ok) {
        const res2 = await fetch(`${BVA_API}/cfr/search?q=${encodeURIComponent(`${match[1]}.${match[2]}`)}&part=${match[1]}`);
        if (!res2.ok) return { exists: false };
        const data2 = await res2.json();
        return { exists: (data2.results?.length || 0) > 0 };
      }
      const data = await res.json();
      return { exists: (data.results?.length || 0) > 0 };
    }
    if (citation.type === "bva") {
      const numMatch = citation.identifier.match(/(\d{2}-\d{4,6})/);
      const searchTerm = numMatch ? numMatch[1] : citation.identifier;
      const res = await fetch(`${BVA_API}/search`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: searchTerm, page: 1 }),
      });
      if (!res.ok) return { exists: false };
      const data = await res.json();
      return { exists: data.results?.some((r) => r.case_number === searchTerm || r.title === searchTerm) || false };
    }
    if (citation.type === "cavc") {
      const numMatch = citation.identifier.match(/(\d{2}-\d{2,6})/);
      if (numMatch) {
        const res = await fetch(`${BVA_API}/cavc/search?case_number=${numMatch[1]}`);
        if (!res.ok) return { exists: false };
        const data = await res.json();
        return { exists: (data.cases?.length || 0) > 0 };
      }
      const partyMatch = citation.identifier.match(/^(\w+)\s+v\./);
      if (partyMatch) {
        const res = await fetch(`${BVA_API}/cavc/search?party_name=${encodeURIComponent(partyMatch[1])}`);
        if (!res.ok) return { exists: false };
        const data = await res.json();
        return { exists: (data.cases?.length || 0) > 0 };
      }
    }
  } catch { /* ignore */ }
  return null;
}

const VALID_MODELS = ["claude-sonnet-4-6", "claude-haiku-4-5-20251001", "claude-opus-4-6", "claude-sonnet-4-5"];

async function runValidation(query, grounded, model, customPrompt) {
  const genModel = VALID_MODELS.includes(model) ? model : "claude-sonnet-4-6";
  const extModel = "claude-haiku-4-5-20251001"; // always use haiku for extraction (cheap + fast)
  const steps = [];
  const contextBlock = RETRIEVAL_CONTEXT.map((r) => r.content).join("\n\n");
  const sources = RETRIEVAL_CONTEXT.map((r) => r.source_id);
  const session = createSession(query, grounded ? "grounded" : "ungrounded", genModel);

  steps.push({ step: "sources", data: { sources, count: sources.length } });

  // Step 1: Generation
  const sysPrompt = customPrompt || (grounded ? GROUNDED_PROMPT : UNGROUNDED_PROMPT);
  const genResponse = await client.messages.create({
    model: genModel,
    max_tokens: 2048,
    system: sysPrompt,
    messages: [{ role: "user", content: `RETRIEVED SOURCE MATERIALS:\n\n${contextBlock}\n\n---\n\nQUESTION: ${query}` }],
  });
  const responseText = genResponse.content[0].text;
  steps.push({
    step: "generation",
    data: {
      text: responseText,
      model: genResponse.model,
      tokens: { input: genResponse.usage.input_tokens, output: genResponse.usage.output_tokens },
    },
  });

  // Step 2: Extraction
  const extResponse = await client.messages.create({
    model: extModel,
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

  steps.push({
    step: "extraction",
    data: {
      count: citations.length,
      tokens: { input: extResponse.usage.input_tokens, output: extResponse.usage.output_tokens },
    },
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
        if (meta.superseded_by) {
          result.detail += ` — superseded by ${meta.superseded_by}`;
        }
      } else {
        result.status = "VERIFIED";
        result.detail = "Citation found in sentinel-tagged source context";
      }
    } else {
      result.status = "NOT_IN_SOURCES";
      result.detail = "Citation NOT found in any [SOURCE_START]...[SOURCE_END] block";
    }

    if (BVA_API) {
      const apiResult = await verifyViaApi(citation);
      if (apiResult) {
        result.api_verified = apiResult.exists;
        if (!apiResult.exists && !foundInSources) {
          result.status = "HALLUCINATED";
          result.detail += " | API confirms: no match";
        } else if (apiResult.exists && !foundInSources) {
          result.status = "UNGROUNDED";
          result.detail += " | Exists in API — model used training knowledge";
        } else if (apiResult.exists && foundInSources) {
          result.detail += " | Also confirmed via live API";
        }
      }
    }
    results.push(result);
  }

  steps.push({ step: "validation", data: { results } });

  // Step 4: Adversarial critic review
  const criticResult = await runCritic(contextBlock, responseText, results, client);
  steps.push({
    step: "critic",
    data: {
      findings: criticResult.findings,
      tokens: criticResult.usage,
    },
  });

  const verified = results.filter((r) => r.status === "VERIFIED").length;
  const outdated = results.filter((r) => r.status === "OUTDATED").length;
  const ungrounded = results.filter((r) => r.status === "UNGROUNDED").length;
  const notInSources = results.filter((r) => r.status === "NOT_IN_SOURCES").length;
  const hallucinated = results.filter((r) => r.status === "HALLUCINATED").length;

  steps.push({
    step: "summary",
    data: { total: results.length, verified, outdated, ungrounded, notInSources, hallucinated, liveApi: !!BVA_API, sessionId: session.id },
  });

  // Finalize session log
  session.citations = { total: results.length, verified, outdated, ungrounded, not_in_sources: notInSources, hallucinated };
  session.critic = {
    findings: criticResult.findings.length,
    high: criticResult.findings.filter((f) => f.severity === "high").length,
    medium: criticResult.findings.filter((f) => f.severity === "medium").length,
    low: criticResult.findings.filter((f) => f.severity === "low").length,
  };
  logStep(session, "complete", { total: results.length, verified, outdated, ungrounded, notInSources, hallucinated });
  await finalizeSession(session);

  return steps;
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const server = createServer(async (req, res) => {
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    const html = await readFile(join(__dirname, "index.html"), "utf-8");
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
    return;
  }

  if (req.method === "POST" && req.url === "/validate") {
    let body = "";
    for await (const chunk of req) body += chunk;
    try {
      const { query, grounded, model, systemPrompt } = JSON.parse(body);
      const result = await runValidation(query, grounded, model, systemPrompt);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`Citation Validator GUI running at http://localhost:${PORT}`);
  if (BVA_API) console.log(`Live API verification: ${BVA_API}`);
  else console.log("No BVA_API_URL set — source-context validation only");
});
