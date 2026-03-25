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
  const knownIds = getSourceIds();
  const sourceMetadata = getSourceMetadata();
  const results = [];

  for (const citation of citations) {
    const result = { ...citation, status: "UNKNOWN", detail: "" };
    const id = citation.identifier.trim();

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

    // For BVA citations, also try matching just the docket number
    if (!foundInSources && citation.type === "bva") {
      const numMatch = id.match(/(\d{2}-\d{4,6})/);
      if (numMatch) {
        for (const known of knownIds) {
          if (known.includes(numMatch[1])) {
            foundInSources = true;
            for (const r of RETRIEVAL_CONTEXT) {
              if (r.source_id.includes(numMatch[1])) {
                matchedSourceId = r.source_id;
                break;
              }
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
