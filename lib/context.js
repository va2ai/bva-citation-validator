/**
 * Shared retrieval context and prompts.
 *
 * Single source of truth for the simulated MCP retrieval data and
 * system prompts used across the CLI, web GUI, and test harness.
 */

// ---------------------------------------------------------------------------
// Simulated MCP retrieval context (sentinel-tagged)
// In production these come from bva_cfr_section, bva_search, bva_cavc_search
// ---------------------------------------------------------------------------

export const RETRIEVAL_CONTEXT = [
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

// ---------------------------------------------------------------------------
// System prompts
// ---------------------------------------------------------------------------

export const GROUNDED_PROMPT = `You are a VA disability claims research assistant. You answer questions from VA-accredited attorneys, VSOs, and claims agents using ONLY the source materials provided.

GROUNDING RULES (MANDATORY):
- Every 38 CFR citation, BVA docket number, BVA citation number, and CAVC case citation in your response MUST appear verbatim in the [SOURCE_START]...[SOURCE_END] blocks provided.
- You may NOT construct, infer, or recall citations from prior knowledge.
- You may NOT combine or interpolate citation identifiers.
- If the provided sources are insufficient to fully answer the question, explicitly state what is missing rather than filling gaps from memory.
- When referencing a specific regulation or decision, include the exact identifier from the source tag.

FORMAT: Use the citation identifiers exactly as they appear in source tags. For CFR sections use "38 CFR § X.XXX" format. For BVA decisions use "BVA XX-XXXXX" format.`;

export const UNGROUNDED_PROMPT = `You are a VA disability claims research assistant. Answer the question thoroughly using the provided materials AND your own knowledge of VA law. Include as many specific BVA citation numbers, CFR sections, and CAVC case references as possible to make the answer authoritative. If you know of additional relevant cases or regulations beyond what is provided, include them.`;

// ---------------------------------------------------------------------------
// Test queries for multi-query prompt optimization
// ---------------------------------------------------------------------------

export const TEST_QUERIES = [
  // Broad: tests citation accuracy across multiple sources
  "What are the rating criteria for PTSD under 38 CFR, and which BVA decisions support direct service connection for PTSD secondary to MST or TBI? Include specific citation numbers.",
  // Grounding trap: no CAVC cases exist in sources — should refuse or note absence
  "What CAVC cases establish precedent for PTSD service connection?",
  // Temporal: BVA 22-18467 is superseded — should flag as outdated
  "What rating was granted in BVA 22-18467?",
  // Fabrication trap: only 3 BVA decisions in sources — should not invent more
  "List all BVA decisions that granted service connection for PTSD.",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function buildContext() {
  return RETRIEVAL_CONTEXT.map((r) => r.content).join("\n\n");
}

export function getSourceIds() {
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

export function getSourceMetadata() {
  const metadata = new Map();
  for (const r of RETRIEVAL_CONTEXT) {
    if (r.metadata) metadata.set(r.source_id, r.metadata);
  }
  return metadata;
}
