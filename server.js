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
import { extractCitations } from "./lib/extract.js";
import { createSession, logStep, finalizeSession } from "./lib/logger.js";
import { RETRIEVAL_CONTEXT, GROUNDED_PROMPT, UNGROUNDED_PROMPT, buildContext } from "./lib/context.js";
import { validateCitations } from "./lib/validate.js";
import { suggestPromptUpdates } from "./lib/prompt-advisor.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const client = new Anthropic();
const BVA_API = process.env.BVA_API_URL || null;
const PORT = process.env.PORT || 4000;

const VALID_MODELS = ["claude-sonnet-4-6", "claude-haiku-4-5-20251001", "claude-opus-4-6", "claude-sonnet-4-5"];

async function runValidation(query, grounded, model, customPrompt) {
  const genModel = VALID_MODELS.includes(model) ? model : "claude-sonnet-4-6";
  const extModel = "claude-haiku-4-5-20251001"; // always use haiku for extraction (cheap + fast)
  const steps = [];
  const contextBlock = buildContext();
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

  // Step 2: Extraction (via tool-use structured output)
  const { citations, usage: extUsage } = await extractCitations(responseText, client, extModel);

  steps.push({
    step: "extraction",
    data: {
      count: citations.length,
      tokens: extUsage,
    },
  });

  // Step 3: Validation
  const results = await validateCitations(citations, BVA_API);

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

  // Step 5: Prompt advisor
  const hasIssues = criticResult.findings.length > 0 ||
    results.some((r) => r.status !== "VERIFIED");

  if (hasIssues) {
    const advice = await suggestPromptUpdates(sysPrompt, criticResult.findings, results, client);
    steps.push({
      step: "prompt_advisor",
      data: {
        suggestions: advice.suggestions,
        updated_prompt: advice.updated_prompt,
        tokens: advice.usage,
      },
    });
  }

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
