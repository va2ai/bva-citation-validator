/**
 * Shared citation validation logic.
 *
 * Provides normalize(), verifyViaApi(), and validateCitations() used
 * by the CLI, web GUI, and test harness.
 */

import { RETRIEVAL_CONTEXT, getSourceIds, getSourceMetadata } from "./context.js";

// ---------------------------------------------------------------------------
// Citation string normalization
// ---------------------------------------------------------------------------

export function normalize(s) {
  return s
    .replace(/C\.?F\.?R\.?/gi, "CFR")
    .replace(/U\.S\.C\./gi, "USC")
    .replace(/§+/g, "§")
    .replace(/Citation\s*N[or]\.\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Canonical citation keys
//
// Substring matching on raw identifiers produced false positives — e.g.
// "38 CFR § 4.13" would match "38 CFR § 4.130". Each citation is reduced to a
// structured key built from its type-specific anchor (part.section for CFR,
// docket number for BVA, etc.), then compared via exact key equality.
// ---------------------------------------------------------------------------

export function citationKey(type, raw) {
  if (!raw) return null;
  const text = String(raw).trim();

  if (type === "cfr") {
    const m = text.match(/(\d+)\s*C\.?F\.?R\.?\s*§?\s*(\d+)\.(\d+[a-z]?)(\([a-z0-9]+\))?/i)
      || text.match(/(\d+)\.(\d+[a-z]?)(\([a-z0-9]+\))?/);
    if (!m) return null;
    // Either 4-group form (with title) or 3-group form (bare section)
    const title = m.length === 5 ? m[1] : "38";
    const part = m.length === 5 ? m[2] : m[1];
    const section = m.length === 5 ? m[3] : m[2];
    const sub = (m.length === 5 ? m[4] : m[3]) || "";
    return `cfr:${title}:${part}.${section}${sub.toLowerCase()}`;
  }

  if (type === "usc") {
    const m = text.match(/(\d+)\s*U\.?S\.?C\.?\s*§+\s*([\dA-Za-z.\-]+)/i)
      || text.match(/§+\s*([\dA-Za-z.\-]+)/);
    if (!m) return null;
    if (m.length === 3) return `usc:${m[1]}:${m[2]}`;
    return `usc:38:${m[1]}`;
  }

  if (type === "bva") {
    const m = text.match(/(\d{2}-\d{4,6})/);
    return m ? `bva:${m[1]}` : null;
  }

  if (type === "cavc") {
    const num = text.match(/(\d{2}-\d{2,6})/);
    if (num) return `cavc:${num[1]}`;
    const party = text.match(/^([A-Za-z][A-Za-z.'\- ]*?)\s+v\.\s+([A-Za-z][A-Za-z.'\- ]*)/i);
    if (party) return `cavc:${party[1].trim().toLowerCase()}-v-${party[2].trim().toLowerCase()}`;
    return null;
  }

  return null;
}

function inferType(rawId) {
  if (/C\.?F\.?R\.?/i.test(rawId)) return "cfr";
  if (/U\.?S\.?C\.?/i.test(rawId)) return "usc";
  if (/^\s*BVA\b/i.test(rawId) || /Citation\s*Nr/i.test(rawId)) return "bva";
  if (/\bv\.\s/i.test(rawId)) return "cavc";
  if (/^\d{2}-\d{4,6}$/.test(rawId.trim())) return "bva";
  return null;
}

export function buildSourceKeyMap() {
  const map = new Map(); // canonical key -> RETRIEVAL_CONTEXT entry source_id
  for (const r of RETRIEVAL_CONTEXT) {
    const type = inferType(r.source_id);
    if (type) {
      const key = citationKey(type, r.source_id);
      if (key) map.set(key, r.source_id);
    }
  }
  for (const id of getSourceIds()) {
    const type = inferType(id);
    if (!type) continue;
    const key = citationKey(type, id);
    if (!key || map.has(key)) continue;
    // Resolve back to the containing retrieval entry
    for (const r of RETRIEVAL_CONTEXT) {
      if (r.source_id === id || r.content.includes(id)) {
        map.set(key, r.source_id);
        break;
      }
    }
    if (!map.has(key)) map.set(key, id);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Live MCP verification (optional — uses BVA API if URL is set)
// ---------------------------------------------------------------------------

export async function verifyViaApi(citation, apiUrl) {
  if (!apiUrl) return null;

  try {
    if (citation.type === "cfr") {
      const match = citation.identifier.match(/(\d+)\.(\d+)/);
      if (!match) return null;
      const res = await fetch(
        `${apiUrl}/rag/search?q=${encodeURIComponent(`38 CFR ${match[1]}.${match[2]}`)}&source=cfr&top_k=3`
      );
      if (!res.ok) {
        const res2 = await fetch(
          `${apiUrl}/cfr/search?q=${encodeURIComponent(`${match[1]}.${match[2]}`)}&part=${match[1]}`
        );
        if (!res2.ok) return { exists: false, status: res2.status };
        const data2 = await res2.json();
        return { exists: (data2.results?.length || 0) > 0, data: data2 };
      }
      const data = await res.json();
      return { exists: (data.results?.length || 0) > 0, data };
    }

    if (citation.type === "bva") {
      const numMatch = citation.identifier.match(/(\d{2}-\d{4,6})/);
      const searchTerm = numMatch ? numMatch[1] : citation.identifier;
      const res = await fetch(`${apiUrl}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: searchTerm, page: 1 }),
      });
      if (!res.ok) return { exists: false, status: res.status };
      const data = await res.json();
      const found = data.results?.some(
        (r) => r.case_number === searchTerm || r.title === searchTerm
      );
      return { exists: found || false, resultCount: data.total, data };
    }

    if (citation.type === "cavc") {
      const numMatch = citation.identifier.match(/(\d{2}-\d{2,6})/);
      if (numMatch) {
        const res = await fetch(`${apiUrl}/cavc/search?case_number=${numMatch[1]}`);
        if (!res.ok) return { exists: false, status: res.status };
        const data = await res.json();
        return { exists: (data.cases?.length || 0) > 0, data };
      }
      const partyMatch = citation.identifier.match(/^(\w+)\s+v\./);
      if (partyMatch) {
        const res = await fetch(
          `${apiUrl}/cavc/search?party_name=${encodeURIComponent(partyMatch[1])}`
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
// Cross-reference validation loop
// ---------------------------------------------------------------------------

/**
 * Validate extracted citations against source context and optional live API.
 *
 * @param {Array} citations - Extracted citations [{type, identifier, claim}]
 * @param {string|null} apiUrl - Optional BVA API URL for live verification
 * @returns {Promise<Array>} Results with status/detail per citation
 */
export async function validateCitations(citations, apiUrl) {
  const sourceMetadata = getSourceMetadata();
  const sourceKeyMap = buildSourceKeyMap();
  const results = [];

  for (const citation of citations) {
    const result = { ...citation, status: "UNKNOWN", detail: "" };
    const id = citation.identifier.trim();

    let foundInSources = false;
    let matchedSourceId = null;

    const key = citationKey(citation.type, id);
    if (key && sourceKeyMap.has(key)) {
      foundInSources = true;
      matchedSourceId = sourceKeyMap.get(key);
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
      result.detail = "Citation NOT found in any [SOURCE_START]...[SOURCE_END] block — possible hallucination";
    }

    // Optional: live API verification
    if (apiUrl) {
      const apiResult = await verifyViaApi(citation, apiUrl);
      if (apiResult) {
        result.api_verified = apiResult.exists;
        if (!apiResult.exists && result.status === "NOT_IN_SOURCES") {
          result.status = "HALLUCINATED";
          result.detail += " | API lookup confirms: no match found";
        } else if (apiResult.exists && result.status === "NOT_IN_SOURCES") {
          result.status = "UNGROUNDED";
          result.detail += " | EXISTS in live API — model used training knowledge instead of sources";
        } else if (apiResult.exists && result.status === "VERIFIED") {
          result.detail += " | Also confirmed via live API";
        }
      }
    }

    results.push(result);
  }

  return results;
}
