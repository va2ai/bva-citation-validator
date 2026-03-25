/**
 * Structured Citation Extraction via output_config JSON Schema
 *
 * Uses the Claude API's structured responses feature (output_config) to force
 * the model to return valid JSON matching a defined schema. This is the
 * dedicated API for structured output — no tool_use workaround needed.
 */

const CITATION_SCHEMA = {
  type: "object",
  properties: {
    citations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["cfr", "bva", "cavc", "usc"],
            description: "The type of legal citation",
          },
          identifier: {
            type: "string",
            description:
              "The exact citation string as it appears in the text",
          },
          claim: {
            type: "string",
            description:
              "A one-sentence summary of what the response claims about this citation",
          },
        },
        required: ["type", "identifier", "claim"],
      },
      description: "Array of all legal citations found in the response",
    },
  },
  required: ["citations"],
};

const EXTRACTION_PROMPT = `Extract every legal citation from the following AI-generated response about VA disability claims.

For each citation, identify:
- type: "cfr" for Code of Federal Regulations, "bva" for Board of Veterans' Appeals decisions, "cavc" for Court of Appeals for Veterans Claims cases, "usc" for United States Code
- identifier: the exact citation string as it appears in the text
- claim: a one-sentence summary of what the response claims about this citation

Response to extract from:
`;

/**
 * Extract citations from a response using the structured responses API.
 *
 * @param {string} responseText - The AI-generated response to extract from
 * @param {object} client - Anthropic client instance
 * @param {string} [model] - Model to use (defaults to haiku)
 * @returns {Promise<{citations: Array, usage: object}>}
 */
export async function extractCitations(responseText, client, model) {
  const extractionModel = model || "claude-haiku-4-5-20251001";

  const response = await client.messages.create({
    model: extractionModel,
    max_tokens: 4096,
    output_config: {
      format: {
        type: "json_schema",
        schema: CITATION_SCHEMA,
      },
    },
    messages: [
      {
        role: "user",
        content: EXTRACTION_PROMPT + responseText,
      },
    ],
  });

  let citations = JSON.parse(response.content[0].text).citations;

  // Deduplicate by identifier
  const seen = new Set();
  citations = citations.filter((c) => {
    const key = `${c.type}:${c.identifier}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    citations,
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    },
  };
}
