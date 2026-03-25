/**
 * Recursive Prompt Optimization Loop (Autoresearch Pattern)
 *
 * Implements Karpathy's "ratchet loop" for system prompt self-improvement:
 * 1. Run full validation pipeline with current prompt
 * 2. Score the result with a single composite metric
 * 3. Keep prompt if score improved, revert if not
 * 4. Use advisor to generate next prompt candidate (history-aware)
 * 5. Repeat until convergence or max iterations
 */

import { mkdir, readdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { extractCitations } from "./extract.js";
import { validateCitations } from "./validate.js";
import { buildContext } from "./context.js";
import { runCritic } from "../critic.js";
import { suggestPromptUpdates } from "./prompt-advisor.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OPTIMIZE_DIR = join(__dirname, "..", "optimize");

// ---------------------------------------------------------------------------
// Job IDs and persistence
// ---------------------------------------------------------------------------

function generateJobId() {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const rand = crypto.randomBytes(3).toString("hex");
  return `${ts}-${rand}`;
}

function jobDir(jobId) {
  return join(OPTIMIZE_DIR, jobId);
}

async function ensureJobDir(jobId) {
  await mkdir(jobDir(jobId), { recursive: true });
}

/**
 * Save optimization state for a specific job.
 * - optimize/<jobId>/prompt.txt — best prompt
 * - optimize/<jobId>/state.json — full state for resuming
 * Also updates optimize/latest.json pointer and global history.
 */
async function saveRun(jobId, result) {
  await ensureJobDir(jobId);
  const dir = jobDir(jobId);

  await writeFile(join(dir, "prompt.txt"), result.bestPrompt, "utf-8");
  await writeFile(join(dir, "state.json"), JSON.stringify({ ...result, jobId }, null, 2), "utf-8");

  // Update latest pointer
  await mkdir(OPTIMIZE_DIR, { recursive: true });
  await writeFile(join(OPTIMIZE_DIR, "latest.json"), JSON.stringify({ jobId, bestScore: result.bestScore, timestamp: new Date().toISOString() }), "utf-8");

  // Overwrite the active system prompt file so it's used on next run
  await writeFile(join(__dirname, "..", "system-prompt.txt"), result.bestPrompt, "utf-8");

  // Append to global history
  const summary = {
    jobId,
    timestamp: new Date().toISOString(),
    initialScore: result.initialScore,
    bestScore: result.bestScore,
    totalIterations: result.totalIterations,
    promptLength: result.bestPrompt.length,
    convergedReason: result.history[result.history.length - 1]?.convergedReason || null,
  };
  await writeFile(join(OPTIMIZE_DIR, "history.jsonl"), JSON.stringify(summary) + "\n", { flag: "a" });
}

/**
 * Load optimization state for a specific job.
 * Returns null if job doesn't exist.
 */
export async function loadJobState(jobId) {
  try {
    const data = await readFile(join(jobDir(jobId), "state.json"), "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/**
 * Load the latest job's state.
 * Returns null if no previous optimization exists.
 */
export async function loadPreviousState() {
  try {
    const latest = JSON.parse(await readFile(join(OPTIMIZE_DIR, "latest.json"), "utf-8"));
    return loadJobState(latest.jobId);
  } catch {
    return null;
  }
}

/**
 * Load the latest optimized prompt from disk.
 * Returns null if no previous optimization exists.
 */
export async function loadLatestPrompt() {
  try {
    const latest = JSON.parse(await readFile(join(OPTIMIZE_DIR, "latest.json"), "utf-8"));
    return await readFile(join(jobDir(latest.jobId), "prompt.txt"), "utf-8");
  } catch {
    return null;
  }
}

/**
 * List all optimization jobs.
 * Returns array of {jobId, bestScore, timestamp} sorted newest first.
 */
export async function listJobs() {
  try {
    const lines = (await readFile(join(OPTIMIZE_DIR, "history.jsonl"), "utf-8")).trim().split("\n");
    const jobs = lines.filter(Boolean).map((l) => JSON.parse(l));
    // Dedupe by jobId (keep latest entry per job)
    const byId = new Map();
    for (const j of jobs) byId.set(j.jobId, j);
    return [...byId.values()].reverse();
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Scoring: single composite metric (0-100)
// ---------------------------------------------------------------------------

/**
 * Compute a single score from validation results and critic findings.
 *
 * Weights:
 *   40% — citation accuracy (verified / total)
 *   30% — no high-severity critic findings
 *   20% — no medium-severity critic findings
 *   10% — produced citations at all (non-trivial response)
 *
 * @param {Array} validationResults - [{status, ...}]
 * @param {Array} criticFindings - [{severity, ...}]
 * @returns {number} Score 0-100
 */
export function computeScore(validationResults, criticFindings) {
  const total = validationResults.length;
  if (total === 0) return 10; // gave no citations — minimal score

  const verified = validationResults.filter((r) => r.status === "VERIFIED").length;
  const highFindings = criticFindings.filter((f) => f.severity === "high").length;
  const medFindings = criticFindings.filter((f) => f.severity === "medium").length;

  const accuracyScore = 40 * (verified / total);
  const highScore = 30 * Math.max(0, 1 - highFindings / total);
  const medScore = 20 * Math.max(0, 1 - medFindings / total);
  const existsScore = 10; // citations were produced

  return Math.round((accuracyScore + highScore + medScore + existsScore) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Convergence detection
// ---------------------------------------------------------------------------

/**
 * Check if the optimization loop should stop.
 *
 * Stops when:
 * - Perfect score (100) achieved
 * - Score unchanged for 3 consecutive iterations
 * - Score decreased 3 times in a row
 *
 * @param {Array} history - [{iteration, score, ...}]
 * @returns {{converged: boolean, reason: string}}
 */
export function checkConvergence(history) {
  if (history.length === 0) return { converged: false, reason: "" };

  const lastScore = history[history.length - 1].score;

  // Perfect score
  if (lastScore >= 100) {
    return { converged: true, reason: "Perfect score achieved" };
  }

  // Stagnant: same score for last 3 iterations
  if (history.length >= 3) {
    const last3 = history.slice(-3).map((h) => h.score);
    if (last3.every((s) => s === last3[0])) {
      return { converged: true, reason: `Score stagnant at ${last3[0]} for 3 iterations` };
    }
  }

  // Declining: score decreased 3 times in a row
  if (history.length >= 4) {
    const last4 = history.slice(-4).map((h) => h.score);
    const declining = last4[1] < last4[0] && last4[2] < last4[1] && last4[3] < last4[2];
    if (declining) {
      return { converged: true, reason: "Score declining for 3 consecutive iterations" };
    }
  }

  return { converged: false, reason: "" };
}

// ---------------------------------------------------------------------------
// Single pipeline run (generation → extraction → validation → critic)
// ---------------------------------------------------------------------------

async function runPipeline(query, systemPrompt, client, model, apiUrl) {
  const contextBlock = buildContext();

  // Generation
  const genResponse = await client.messages.create({
    model: model || "claude-sonnet-4-6",
    max_tokens: 2048,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `RETRIEVED SOURCE MATERIALS:\n\n${contextBlock}\n\n---\n\nQUESTION: ${query}`,
      },
    ],
  });
  const responseText = genResponse.content[0].text;

  // Extraction
  const { citations } = await extractCitations(responseText, client);

  // Validation
  const results = await validateCitations(citations, apiUrl);

  // Critic
  const criticResult = await runCritic(contextBlock, responseText, results, client);

  return {
    responseText,
    citations,
    validationResults: results,
    criticFindings: criticResult.findings,
    usage: {
      generation: genResponse.usage,
      critic: criticResult.usage,
    },
  };
}

// ---------------------------------------------------------------------------
// Main optimization loop
// ---------------------------------------------------------------------------

/**
 * Run the recursive prompt optimization loop.
 *
 * @param {object} options
 * @param {string} options.initialPrompt - Starting system prompt
 * @param {string[]} options.queries - Test queries to evaluate against
 * @param {object} options.client - Anthropic client (created if not provided)
 * @param {string} [options.model] - Generation model
 * @param {string} [options.apiUrl] - Optional BVA API URL
 * @param {number} [options.maxIterations=10] - Max optimization iterations
 * @param {string} [options.resumeJobId] - Job ID to resume (or "latest" for most recent)
 * @param {function} [options.onIteration] - Callback(iteration) for progress reporting
 * @returns {Promise<{jobId: string, bestPrompt: string, bestScore: number, history: Array, totalIterations: number}>}
 */
export async function runPromptLoop(options) {
  const {
    initialPrompt,
    queries,
    client = new Anthropic(),
    model,
    apiUrl,
    maxIterations = 10,
    resumeJobId,
    onIteration,
  } = options;

  // Resume from previous state if requested
  let currentPrompt = initialPrompt;
  let bestScore = -Infinity;
  let bestPrompt = initialPrompt;
  const history = [];
  let jobId;

  if (resumeJobId) {
    const prev = resumeJobId === "latest"
      ? await loadPreviousState()
      : await loadJobState(resumeJobId);
    if (prev) {
      jobId = prev.jobId || resumeJobId; // keep same job ID when resuming
      currentPrompt = prev.bestPrompt;
      bestPrompt = prev.bestPrompt;
      bestScore = prev.bestScore;
      history.push(...prev.history);
    }
  }

  // New job ID if not resuming
  if (!jobId) jobId = generateJobId();

  for (let i = 0; i < maxIterations; i++) {
    // 1. Run pipeline across all test queries and average scores
    let totalScore = 0;
    const queryResults = [];

    for (const query of queries) {
      const result = await runPipeline(query, currentPrompt, client, model, apiUrl);
      const score = computeScore(result.validationResults, result.criticFindings);
      totalScore += score;
      queryResults.push({ query, score, ...result });
    }

    const avgScore = Math.round((totalScore / queries.length) * 100) / 100;

    // 2. Record iteration
    const iteration = {
      iteration: i,
      prompt: currentPrompt,
      score: avgScore,
      queryScores: queryResults.map((r) => ({ query: r.query, score: r.score })),
      totalCitations: queryResults.reduce((sum, r) => sum + r.citations.length, 0),
      totalFindings: queryResults.reduce((sum, r) => sum + r.criticFindings.length, 0),
      improved: avgScore > bestScore,
    };
    history.push(iteration);

    // 3. Report progress
    if (onIteration) onIteration(iteration);

    // 4. Ratchet: keep if improved, revert if not
    if (avgScore > bestScore) {
      bestScore = avgScore;
      bestPrompt = currentPrompt;
      // Save checkpoint on improvement
      await saveRun(jobId, { bestPrompt, bestScore, initialScore: history[0]?.score ?? 0, history, totalIterations: history.length });
    } else {
      currentPrompt = bestPrompt; // revert
    }

    // 5. Check convergence
    const { converged, reason } = checkConvergence(history);
    if (converged) {
      history[history.length - 1].convergedReason = reason;
      break;
    }

    // 6. Generate next prompt candidate (advisor pass with history)
    // Aggregate all findings from this iteration for the advisor
    const allFindings = queryResults.flatMap((r) => r.criticFindings);
    const allResults = queryResults.flatMap((r) => r.validationResults);

    const advice = await suggestPromptUpdates(
      currentPrompt,
      allFindings,
      allResults,
      client,
      undefined, // model (default haiku)
      history,   // pass iteration history
    );

    if (advice.updated_prompt && advice.updated_prompt !== currentPrompt) {
      currentPrompt = advice.updated_prompt;
    } else {
      // Advisor couldn't suggest improvements — converge
      history[history.length - 1].convergedReason = "Advisor produced no new changes";
      break;
    }
  }

  const result = {
    jobId,
    bestPrompt,
    bestScore,
    initialScore: history[0]?.score ?? 0,
    history,
    totalIterations: history.length,
  };

  // Save final state to disk
  await saveRun(jobId, result);

  return result;
}
