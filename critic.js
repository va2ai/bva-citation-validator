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
 */

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

Return a JSON array of findings. Each finding has:
- "sentence": the problematic sentence from the response (quote it exactly)
- "issue": description of the problem
- "severity": "high" | "medium" | "low"
- "suggestion": what should be done to fix it

If no issues are found, return an empty array: []

Return ONLY valid JSON. No markdown fences, no commentary.`;

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

  let findings;
  try {
    let raw = criticResponse.content[0].text.trim();
    raw = raw.replace(/^```json?\s*/i, "").replace(/\s*```$/i, "");
    findings = JSON.parse(raw);
  } catch {
    try {
      let raw = criticResponse.content[0].text.trim();
      raw = raw.replace(/^```json?\s*/i, "").replace(/\s*```$/i, "");
      const lastBrace = raw.lastIndexOf("}");
      if (lastBrace > 0) {
        findings = JSON.parse(raw.slice(0, lastBrace + 1) + "]");
      } else {
        findings = [];
      }
    } catch {
      findings = [];
    }
  }

  return {
    findings,
    usage: {
      input_tokens: criticResponse.usage.input_tokens,
      output_tokens: criticResponse.usage.output_tokens,
    },
  };
}
