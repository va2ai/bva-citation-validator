#!/usr/bin/env node
import 'dotenv/config';
/**
 * Post-Generation Citation Validator
 *
 * Demonstrates the hallucination detection pipeline described in the bid:
 * 1. Sentinel-tagged retrieval context from BVA MCP tools
 * 2. Grounded generation with citation constraints
 * 3. Structured citation extraction via second LLM pass
 * 4. Cross-reference validation against source data
 *
 * Usage: ANTHROPIC_API_KEY=sk-... node validator.js
 * Optional: BVA_API_URL=https://your-bva-api.run.app node validator.js
 */

import Anthropic from "@anthropic-ai/sdk";
import { runCritic } from "./critic.js";
import { extractCitations } from "./lib/extract.js";
import { createSession, logStep, finalizeSession } from "./lib/logger.js";
import { RETRIEVAL_CONTEXT, GROUNDED_PROMPT, UNGROUNDED_PROMPT, TEST_QUERIES, buildContext } from "./lib/context.js";
import { validateCitations } from "./lib/validate.js";
import { suggestPromptUpdates } from "./lib/prompt-advisor.js";
import { runPromptLoop } from "./lib/prompt-loop.js";

const client = new Anthropic();
const BVA_API = process.env.BVA_API_URL || null;

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

async function run() {
  const ungounded = process.argv.includes("--ungrounded");
  const query =
    process.argv.find((a) => !a.startsWith("-") && a !== process.argv[0] && a !== process.argv[1]) ||
    "What are the rating criteria for PTSD under 38 CFR, and which BVA decisions support direct service connection for PTSD secondary to MST or TBI? Include specific citation numbers.";

  const session = createSession(query, ungounded ? "ungrounded" : "grounded", "claude-sonnet-4-6");

  console.log("═".repeat(80));
  console.log("  POST-GENERATION CITATION VALIDATOR");
  console.log("  BVA Legal Intelligence Platform");
  console.log("═".repeat(80));
  console.log();
  console.log(`Query: ${query}`);
  console.log(`Session: ${session.id}`);
  if (ungounded) {
    console.log();
    console.log(
      "  ** UNGROUNDED MODE: system prompt constraint removed to demonstrate **"
    );
    console.log(
      "  ** what happens WITHOUT the grounding rule — expect hallucinations  **"
    );
  }
  console.log();

  // --- Step 1: Grounded generation ---
  console.log("─".repeat(80));
  console.log(
    ungounded
      ? "STEP 1: UNGROUNDED generation (no citation constraint)"
      : "STEP 1: Grounded generation with sentinel-tagged context"
  );
  console.log("─".repeat(80));
  console.log(`  Sources loaded: ${RETRIEVAL_CONTEXT.length} documents`);
  console.log(
    `  Source IDs: ${RETRIEVAL_CONTEXT.map((r) => r.source_id).join(", ")}`
  );
  console.log();

  const contextBlock = buildContext();

  const systemPrompt = ungounded ? UNGROUNDED_PROMPT : GROUNDED_PROMPT;

  const generationResponse = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `RETRIEVED SOURCE MATERIALS:\n\n${contextBlock}\n\n---\n\nQUESTION: ${query}`,
      },
    ],
  });

  const responseText = generationResponse.content[0].text;

  console.log("GENERATED RESPONSE:");
  console.log("┌" + "─".repeat(78) + "┐");
  for (const line of responseText.split("\n")) {
    // Wrap long lines
    const chunks = line.match(/.{1,76}/g) || [""];
    for (const chunk of chunks) {
      console.log(`│ ${chunk.padEnd(76)} │`);
    }
  }
  console.log("└" + "─".repeat(78) + "┘");
  console.log();

  logStep(session, "generation", {
    model: generationResponse.model,
    tokens: { input: generationResponse.usage.input_tokens, output: generationResponse.usage.output_tokens },
  });

  // --- Step 2: Citation extraction (second LLM pass via tool use) ---
  console.log("─".repeat(80));
  console.log("STEP 2: Structured citation extraction (tool-use schema enforcement)");
  console.log("─".repeat(80));

  const { citations, usage: extractionUsage } = await extractCitations(responseText, client);

  console.log(`  Extracted ${citations.length} citations from response`);
  console.log();

  logStep(session, "extraction", {
    count: citations.length,
    tokens: extractionUsage,
  });

  // --- Step 3: Cross-reference validation ---
  console.log("─".repeat(80));
  console.log("STEP 3: Cross-reference validation against source data");
  console.log("─".repeat(80));
  console.log();

  const results = await validateCitations(citations, BVA_API);

  logStep(session, "validation", {
    total: results.length,
    verified: results.filter((r) => r.status === "VERIFIED").length,
    outdated: results.filter((r) => r.status === "OUTDATED").length,
    not_in_sources: results.filter((r) => r.status === "NOT_IN_SOURCES").length,
    hallucinated: results.filter((r) => r.status === "HALLUCINATED").length,
    ungrounded: results.filter((r) => r.status === "UNGROUNDED").length,
  });

  // --- Step 4: Adversarial critic review ---
  console.log("─".repeat(80));
  console.log("STEP 4: Adversarial critic review (third LLM pass)");
  console.log("─".repeat(80));
  console.log();

  const criticResult = await runCritic(contextBlock, responseText, results, client);

  if (criticResult.findings.length === 0) {
    console.log("  No issues found — critic confirms response quality.");
  } else {
    for (const f of criticResult.findings) {
      const sev =
        f.severity === "high" ? "  HIGH" : f.severity === "medium" ? "  MED " : "  LOW ";
      console.log(`${sev}  ${f.issue}`);
      console.log(`        Sentence: "${f.sentence}"`);
      console.log(`        Suggestion: ${f.suggestion}`);
      console.log();
    }
  }

  console.log(
    `  Critic tokens: ${criticResult.usage.input_tokens} in / ${criticResult.usage.output_tokens} out`
  );
  console.log();

  logStep(session, "critic", {
    findings: criticResult.findings.length,
    high: criticResult.findings.filter((f) => f.severity === "high").length,
    medium: criticResult.findings.filter((f) => f.severity === "medium").length,
    low: criticResult.findings.filter((f) => f.severity === "low").length,
    tokens: criticResult.usage,
  });

  // --- Step 5: Prompt advisor (suggest system prompt improvements) ---
  const hasIssues = criticResult.findings.length > 0 ||
    results.some((r) => r.status !== "VERIFIED");

  if (hasIssues) {
    console.log("─".repeat(80));
    console.log("STEP 5: Prompt advisor — suggested system prompt improvements");
    console.log("─".repeat(80));
    console.log();

    const advice = await suggestPromptUpdates(systemPrompt, criticResult.findings, results, client);

    if (advice.suggestions.length === 0) {
      console.log("  No prompt improvements suggested.");
    } else {
      for (const s of advice.suggestions) {
        const pri = s.priority === "high" ? "  HIGH" : s.priority === "medium" ? "  MED " : "  LOW ";
        console.log(`${pri}  ${s.rule}`);
        console.log(`        Rationale: ${s.rationale}`);
        console.log(`        Addresses: ${s.addresses.join(", ")}`);
        console.log();
      }
      console.log("  SUGGESTED UPDATED PROMPT:");
      console.log("┌" + "─".repeat(78) + "┐");
      for (const line of advice.updated_prompt.split("\n")) {
        const chunks = line.match(/.{1,76}/g) || [""];
        for (const chunk of chunks) {
          console.log(`│ ${chunk.padEnd(76)} │`);
        }
      }
      console.log("└" + "─".repeat(78) + "┘");
    }

    console.log();
    console.log(
      `  Advisor tokens: ${advice.usage.input_tokens} in / ${advice.usage.output_tokens} out`
    );
    console.log();

    logStep(session, "prompt_advisor", {
      suggestions: advice.suggestions.length,
      tokens: advice.usage,
    });
  }

  // --- Step 6: Report ---
  console.log("─".repeat(80));
  console.log("VALIDATION REPORT");
  console.log("─".repeat(80));
  console.log();

  const verified = results.filter((r) => r.status === "VERIFIED");
  const outdated = results.filter((r) => r.status === "OUTDATED");
  const ungrounded = results.filter((r) => r.status === "UNGROUNDED");
  const notInSources = results.filter((r) => r.status === "NOT_IN_SOURCES");
  const hallucinated = results.filter((r) => r.status === "HALLUCINATED");

  for (const r of results) {
    const icon =
      r.status === "VERIFIED"
        ? "  PASS"
        : r.status === "OUTDATED"
          ? "  STALE"
          : r.status === "HALLUCINATED"
            ? "  FAIL"
            : r.status === "UNGROUNDED"
              ? "  LEAK"
              : "  WARN";
    console.log(`${icon}  [${r.type.toUpperCase()}] ${r.identifier}`);
    console.log(`        Claim: ${r.claim}`);
    console.log(`        ${r.detail}`);
    if (r.api_verified !== undefined) {
      console.log(`        API verified: ${r.api_verified}`);
    }
    console.log();
  }

  console.log("═".repeat(80));
  console.log("  SUMMARY");
  console.log("═".repeat(80));
  console.log(`  Total citations extracted:  ${results.length}`);
  console.log(`  Verified (source + API):    ${verified.length}`);
  if (outdated.length > 0) {
    console.log(`  Outdated (superseded):      ${outdated.length}  <- source no longer current`);
  }
  if (ungrounded.length > 0) {
    console.log(`  Ungrounded (real but leaked):${ungrounded.length}  <- model used training knowledge`);
  }
  console.log(`  Not in source context:      ${notInSources.length}`);
  if (hallucinated.length > 0) {
    console.log(`  Confirmed hallucinations:   ${hallucinated.length}  <- fabricated citations`);
  }
  console.log();

  if (notInSources.length > 0 || hallucinated.length > 0 || ungrounded.length > 0 || outdated.length > 0) {
    console.log(
      "  ACTION: Response contains citations not grounded in retrieved sources."
    );
    console.log(
      "  In production, this triggers: regeneration with stricter prompt OR"
    );
    console.log("  validation warning surfaced to the practitioner.");
  } else {
    console.log("  All citations verified against sentinel-tagged source context.");
  }

  console.log();
  console.log(`  Model: ${generationResponse.model}`);
  console.log(
    `  Generation tokens: ${generationResponse.usage.input_tokens} in / ${generationResponse.usage.output_tokens} out`
  );
  console.log(
    `  Extraction tokens: ${extractionUsage.input_tokens} in / ${extractionUsage.output_tokens} out`
  );
  console.log(
    `  Critic tokens:     ${criticResult.usage.input_tokens} in / ${criticResult.usage.output_tokens} out`
  );
  console.log();

  // Finalize session log
  session.citations = {
    total: results.length,
    verified: verified.length,
    outdated: outdated.length,
    ungrounded: ungrounded.length,
    not_in_sources: notInSources.length,
    hallucinated: hallucinated.length,
  };
  session.critic = {
    findings: criticResult.findings.length,
    high: criticResult.findings.filter((f) => f.severity === "high").length,
    medium: criticResult.findings.filter((f) => f.severity === "medium").length,
    low: criticResult.findings.filter((f) => f.severity === "low").length,
  };
  await finalizeSession(session);
  console.log(`  Session logged: ${session.id}`);
  console.log();
}

// ---------------------------------------------------------------------------
// Optimize mode: recursive prompt self-improvement loop
// ---------------------------------------------------------------------------

async function optimize() {
  const maxIterations = parseInt(process.argv.find((a) => a.startsWith("--max="))?.split("=")[1] || "10", 10);
  const resume = process.argv.includes("--resume");

  console.log("═".repeat(80));
  console.log("  RECURSIVE PROMPT OPTIMIZER (Autoresearch Pattern)");
  console.log("  BVA Legal Intelligence Platform");
  console.log("═".repeat(80));
  console.log();
  console.log(`  Max iterations: ${maxIterations}`);
  console.log(`  Test queries: ${TEST_QUERIES.length}`);
  console.log(`  Starting prompt length: ${GROUNDED_PROMPT.length} chars`);
  if (resume) console.log(`  Resume: picking up from last incomplete run`);
  console.log();

  const result = await runPromptLoop({
    initialPrompt: GROUNDED_PROMPT,
    queries: TEST_QUERIES,
    client,
    apiUrl: BVA_API,
    maxIterations,
    resume,
    onIteration: (iter) => {
      const delta = iter.iteration > 0
        ? ` (${iter.improved ? "+" : ""}${(iter.score - (result?.history?.[iter.iteration - 1]?.score ?? iter.score)).toFixed(2)})`
        : "";
      console.log(
        `  Iteration ${iter.iteration}: score=${iter.score}${delta} | ` +
        `citations=${iter.totalCitations} findings=${iter.totalFindings} ` +
        `${iter.improved ? "KEPT" : "REVERTED"}`
      );
      if (iter.convergedReason) {
        console.log(`  -> Converged: ${iter.convergedReason}`);
      }
    },
  });

  console.log();
  console.log("═".repeat(80));
  console.log("  OPTIMIZATION RESULTS");
  console.log("═".repeat(80));
  console.log(`  Iterations:    ${result.totalIterations}`);
  console.log(`  Initial score: ${result.initialScore}`);
  console.log(`  Best score:    ${result.bestScore}`);
  console.log(`  Improvement:   ${(result.bestScore - result.initialScore).toFixed(2)} points`);
  console.log();
  console.log("  OPTIMIZED PROMPT:");
  console.log("┌" + "─".repeat(78) + "┐");
  for (const line of result.bestPrompt.split("\n")) {
    const chunks = line.match(/.{1,76}/g) || [""];
    for (const chunk of chunks) {
      console.log(`│ ${chunk.padEnd(76)} │`);
    }
  }
  console.log("└" + "─".repeat(78) + "┘");
  console.log();

  // Show iteration history
  console.log("  ITERATION HISTORY:");
  for (const h of result.history) {
    const marker = h.improved ? " *" : "  ";
    console.log(`${marker} [${h.iteration}] score=${h.score} ${h.convergedReason ? `(${h.convergedReason})` : ""}`);
  }
  console.log();
}

if (process.argv.includes("--optimize")) {
  optimize().catch((err) => {
    console.error("Fatal error:", err.message);
    process.exit(1);
  });
} else {
  run().catch((err) => {
    console.error("Fatal error:", err.message);
    process.exit(1);
  });
}
