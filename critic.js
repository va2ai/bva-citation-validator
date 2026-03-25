/**
 * Adversarial Critic Pass
 *
 * Third LLM pass that challenges the generated response by reviewing it
 * against the source data and validation results. Catches subtle issues
 * that the extraction + cross-reference validator may miss:
 * - Claims that go beyond what sources support
 * - Unsupported conclusions or reasoning
 * - Citations used in misleading context
 * - Temporal assumptions (assuming current validity without checking)
 *
 * Uses the Claude API's structured responses feature (output_config) to
 * guarantee valid JSON matching a defined schema.
 */

const FINDINGS_SCHEMA = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sentence: {
            type: "string",
            description:
              "The problematic sentence from the response (quoted exactly)",
          },
          issue: {
            type: "string",
            description: "Description of the problem",
          },
          severity: {
            type: "string",
            enum: ["high", "medium", "low"],
            description: "Severity level of the issue",
          },
          suggestion: {
            type: "string",
            description: "What should be done to fix it",
          },
        },
        required: ["sentence", "issue", "severity", "suggestion"],
        additionalProperties: false,
      },
      description:
        "Array of issues found. Empty array if no issues detected.",
    },
  },
  required: ["findings"],
  additionalProperties: false,
};

const CRITIC_PROMPT = `You are a legal citation auditor specializing in VA disability claims. Your job is to find problems that a simple citation-matching validator would MISS.

You will receive:
1. The source documents that were provided to the AI
2. The AI's response
3. The validation report (which citations were verified vs flagged)

Your task: identify subtle issues where the response may mislead even though the citations technically exist in the sources.

Look for:
1. **Overstated claims** — response states something more definitively than the source supports
2. **Unsupported conclusions** — response draws inferences not explicitly in the sources
3. **Misleading context** — a citation is real but used to support a claim the source doesn't actually make
4. **Temporal assumptions** — response assumes a regulation or decision is current without noting potential staleness
5. **Aggregation errors** — response combines data from multiple sources in ways that create new (unverified) claims

Return your findings as structured JSON. Use an empty findings array if no issues are found.`;

/**
 * Run the adversarial critic pass.
 *
 * @param {string} sources - The sentinel-tagged source context
 * @param {string} response - The generated response text
 * @param {Array} validationResults - Results from the cross-reference validation
 * @param {object} client - Anthropic client instance
 * @param {string} [model] - Model to use (defaults to haiku for cost)
 * @returns {Promise<{findings: Array, usage: object}>}
 */
export async function runCritic(sources, response, validationResults, client, model) {
  const criticModel = model || "claude-haiku-4-5-20251001";

  const validationSummary = validationResults
    .map((r) => `[${r.status}] ${r.identifier}: ${r.claim}${r.detail ? ` (${r.detail})` : ""}`)
    .join("\n");

  const criticResponse = await client.messages.create({
    model: criticModel,
    max_tokens: 4096,
    output_config: {
      format: {
        type: "json_schema",
        schema: FINDINGS_SCHEMA,
      },
    },
    messages: [
      {
        role: "user",
        content: `${CRITIC_PROMPT}

SOURCE DATA PROVIDED TO THE MODEL:
${sources}

MODEL'S RESPONSE:
${response}

VALIDATION REPORT:
${validationSummary}`,
      },
    ],
  });

  const findings = JSON.parse(criticResponse.content[0].text).findings;

  return {
    findings,
    usage: {
      input_tokens: criticResponse.usage.input_tokens,
      output_tokens: criticResponse.usage.output_tokens,
    },
  };
}
