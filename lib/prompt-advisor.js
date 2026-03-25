/**
 * Prompt Advisor
 *
 * Analyzes critic findings and validation results to suggest specific
 * improvements to the system prompt that would prevent the same issues
 * in future generations.
 */

const ADVICE_SCHEMA = {
  type: "object",
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          rule: {
            type: "string",
            description: "A concise rule to add to the system prompt (imperative form)",
          },
          rationale: {
            type: "string",
            description: "Why this rule is needed, based on the issues found",
          },
          priority: {
            type: "string",
            enum: ["high", "medium", "low"],
            description: "How important this rule is based on severity and frequency of issues it prevents",
          },
          addresses: {
            type: "array",
            items: { type: "string" },
            description: "Which critic findings or validation failures this rule would prevent",
          },
        },
        required: ["rule", "rationale", "priority", "addresses"],
        additionalProperties: false,
      },
      description: "Suggested additions to the system prompt. Empty array if no improvements needed.",
    },
    updated_prompt: {
      type: "string",
      description: "The full updated system prompt with all suggested rules integrated naturally into the existing structure",
    },
  },
  required: ["suggestions", "updated_prompt"],
  additionalProperties: false,
};

const ADVISOR_PROMPT = `You are a prompt engineer specializing in grounded generation for legal citation systems.

You will receive:
1. The current system prompt used for generation
2. Critic findings (subtle issues the critic caught in the AI's response)
3. Validation results (citation-level verification: VERIFIED, OUTDATED, NOT_IN_SOURCES, HALLUCINATED, UNGROUNDED)

Your task: analyze the issues found and suggest specific, actionable rules to add to the system prompt that would PREVENT these same issues in future generations.

Guidelines:
- Each suggestion should be a concrete rule, not vague guidance
- Rules should be specific enough to be testable
- Don't duplicate rules already in the current prompt
- Focus on patterns — if the critic found an overstated claim, suggest a rule about hedging language
- If validation found OUTDATED citations used without caveats, suggest a temporal awareness rule
- Prioritize rules that prevent HIGH severity issues
- The updated_prompt should integrate new rules naturally into the existing prompt structure, not just append them
- Keep the prompt concise — every rule should earn its place`;

/**
 * Analyze critic findings and validation results to suggest prompt improvements.
 *
 * @param {string} currentPrompt - The current system prompt
 * @param {Array} criticFindings - Findings from the adversarial critic [{sentence, issue, severity, suggestion}]
 * @param {Array} validationResults - Results from cross-reference validation [{status, identifier, claim, detail}]
 * @param {object} client - Anthropic client instance
 * @param {string} [model] - Model to use (defaults to haiku)
 * @returns {Promise<{suggestions: Array, updated_prompt: string, usage: object}>}
 */
export async function suggestPromptUpdates(currentPrompt, criticFindings, validationResults, client, model) {
  const advisorModel = model || "claude-haiku-4-5-20251001";

  const findingsSummary = criticFindings.length > 0
    ? criticFindings.map((f) =>
        `[${f.severity.toUpperCase()}] ${f.issue}\n  Sentence: "${f.sentence}"\n  Suggestion: ${f.suggestion}`
      ).join("\n\n")
    : "No critic findings.";

  const validationSummary = validationResults
    .map((r) => `[${r.status}] ${r.identifier}: ${r.claim}`)
    .join("\n");

  const response = await client.messages.create({
    model: advisorModel,
    max_tokens: 4096,
    output_config: {
      format: {
        type: "json_schema",
        schema: ADVICE_SCHEMA,
      },
    },
    messages: [
      {
        role: "user",
        content: `${ADVISOR_PROMPT}

CURRENT SYSTEM PROMPT:
${currentPrompt}

CRITIC FINDINGS:
${findingsSummary}

VALIDATION RESULTS:
${validationSummary}`,
      },
    ],
  });

  const result = JSON.parse(response.content[0].text);

  return {
    suggestions: result.suggestions,
    updated_prompt: result.updated_prompt,
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    },
  };
}
