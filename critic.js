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
 * Uses tool-use structured output to guarantee valid JSON responses.
 */

const CRITIC_TOOL = {
  name: "record_findings",
  description:
    "Record all issues found during the adversarial review of the AI-generated response. Call this tool exactly once with the complete list of findings. Use an empty array if no issues are found.",
  input_schema: {
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
        },
        description:
          "Array of issues found. Empty array if no issues detected.",
      },
    },
    required: ["findings"],
  },
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

Use the record_findings tool to return your findings.`;

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
    tools: [CRITIC_TOOL],
    tool_choice: { type: "tool", name: "record_findings" },
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

  const toolUse = criticResponse.content.find((block) => block.type === "tool_use");
  const findings = toolUse?.input?.findings || [];

  return {
    findings,
    usage: {
      input_tokens: criticResponse.usage.input_tokens,
      output_tokens: criticResponse.usage.output_tokens,
    },
  };
}
