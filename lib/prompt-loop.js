/**
 * Recursive Prompt Optimization Loop (Autoresearch Pattern)
 *
 * Implements Karpathy's "ratchet loop" for system prompt self-improvement:
 * 1. Run full validation pipeline with current prompt
 * 2. Score the result with a single composite metric
 * 3. Keep prompt if score improved, revert if not
 * 4. Use advisor to generate next prompt candidate (history-aware)
 * 5. Repeat until convergence or max iterations
 *
 * Saves state to optimize/state.json after each iteration for crash recovery.
 * Overwrites system-prompt.txt on each score improvement.
 */

import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { generate as llmGenerate, getAnthropic } from "./providers.js";
import { extractCitations } from "./extract.js";
import { validateCitations } from "./validate.js";
import { buildContext } from "./context.js";
import { runCritic } from "../critic.js";
import { suggestPromptUpdates } from "./prompt-advisor.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OPTIMIZE_DIR = join(__dirname, "..", "optimize");
const STATE_FILE = join(OPTIMIZE_DIR, "state.json");
const PROMPT_FILE = join(__dirname, "..", "system-prompt.txt");

// ---------------------------------------------------------------------------
// Persistence: single state file for crash recovery
// ---------------------------------------------------------------------------

/**
 * Save current optimization state to disk.
 * Called after every iteration so we can resume on crash/reload.
 */
async function saveState(state) {
  await mkdir(OPTIMIZE_DIR, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");

  // Overwrite active system prompt when score improves
  if (state.bestPrompt) {
    await writeFile(PROMPT_FILE, state.bestPrompt, "utf-8");
  }
}

/**
 * Load saved optimization state for crash recovery.
 * Returns null if no saved state exists.
 */
export async function loadState() {
  try {
    const data = await readFile(STATE_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/**
 * Clear saved state (called when optimization completes normally).
 */
async function clearState() {
  try {
    await writeFile(STATE_FILE, JSON.stringify({ completed: true }), "utf-8");
  } catch { /* ignore */ }
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
 */
export function computeScore(validationResults, criticFindings) {
  const total = validationResults.length;
  if (total === 0) return 10;

  const verified = validationResults.filter((r) => r.status === "VERIFIED").length;
  const highFindings = criticFindings.filter((f) => f.severity === "high").length;
  const medFindings = criticFindings.filter((f) => f.severity === "medium").length;

  const accuracyScore = 40 * (verified / total);
  const highScore = 30 * Math.max(0, 1 - highFindings / total);
  const medScore = 20 * Math.max(0, 1 - medFindings / total);
  const existsScore = 10;

  return Math.round((accuracyScore + highScore + medScore + existsScore) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Convergence detection
// ---------------------------------------------------------------------------

export function checkConvergence(history) {
  if (history.length === 0) return { converged: false, reason: "" };

  const lastScore = history[history.length - 1].score;

  if (lastScore >= 100) {
    return { converged: true, reason: "Perfect score achieved" };
  }

  if (history.length >= 3) {
    const last3 = history.slice(-3).map((h) => h.score);
    if (last3.every((s) => s === last3[0])) {
      return { converged: true, reason: `Score stagnant at ${last3[0]} for 3 iterations` };
    }
  }

  if (history.length >= 4) {
    const last4 = history.slice(-4).map((h) => h.score);
    if (last4[1] < last4[0] && last4[2] < last4[1] && last4[3] < last4[2]) {
      return { converged: true, reason: "Score declining for 3 consecutive iterations" };
    }
  }

  return { converged: false, reason: "" };
}

// ---------------------------------------------------------------------------
// Single pipeline run (generation → extraction → validation → critic)
// ---------------------------------------------------------------------------

async function runPipeline(query, systemPrompt, model, apiUrl) {
  const contextBlock = buildContext();
  const anthropicClient = getAnthropic();

  // Generation — uses any provider (Claude or Gemini)
  const genResponse = await llmGenerate({
    model: model || "claude-sonnet-4-6",
    system: systemPrompt,
    userMessage: `RETRIEVED SOURCE MATERIALS:\n\n${contextBlock}\n\n---\n\nQUESTION: ${query}`,
    maxTokens: 2048,
  });

  // Extraction + critic always use Anthropic Haiku (needs structured output)
  const { citations } = await extractCitations(genResponse.text, anthropicClient);
  const results = await validateCitations(citations, apiUrl);
  const criticResult = await runCritic(contextBlock, genResponse.text, results, anthropicClient);

  return {
    responseText: genResponse.text,
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
// Optimization ledger: running summary of what worked and what didn't
// ---------------------------------------------------------------------------

function buildLedger(history) {
  if (history.length === 0) return "";

  // Truncate a rule to a short summary
  function short(rule) {
    if (!rule) return "?";
    // Take first sentence or first 80 chars
    const firstSentence = rule.split(/\.\s/)[0];
    return firstSentence.length > 80 ? firstSentence.slice(0, 77) + "..." : firstSentence;
  }

  // Get rules for an iteration from the previous iter's suggestionsForNext
  function getRulesFor(h) {
    const idx = history.indexOf(h);
    const prev = idx > 0 ? history[idx - 1] : null;
    if (prev?.suggestionsForNext?.length > 0) return prev.suggestionsForNext;
    if (prev?.prompt && h.prompt && h.prompt !== prev.prompt) {
      const prevLines = new Set(prev.prompt.split("\n").map((l) => l.trim()).filter(Boolean));
      const newRules = h.prompt.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("- ") && !prevLines.has(l));
      if (newRules.length > 0) return newRules.map((r) => r.replace(/^- /, ""));
    }
    return null;
  }

  const lines = [];

  // Score summary (one line)
  let best = -Infinity;
  for (const h of history) if (h.score > best) best = h.score;
  const kept = history.filter((h) => h.improved && h.iteration > 0).length;
  const reverted = history.filter((h) => !h.improved && h.iteration > 0).length;
  lines.push(`Score: ${history[0].score} → ${best} | ${history.length} iters (${kept} kept, ${reverted} reverted)\n`);

  // Per-query (compact)
  const first = history[0].queryScores || [];
  const last = history[history.length - 1].queryScores || [];
  if (first.length > 0) {
    lines.push("Queries:");
    for (let i = 0; i < last.length; i++) {
      const f = first[i]?.score ?? 0;
      const l = last[i]?.score ?? 0;
      const d = l - f;
      const icon = d > 0 ? "↑" : d < 0 ? "↓" : "→";
      const q = (last[i]?.query || "").slice(0, 40);
      lines.push(`  ${icon} ${f}→${l} "${q}..."`);
    }
    lines.push("");
  }

  // Deduplicated themes that worked (collect unique short rules across all kept iters)
  const workedRules = new Map(); // short rule → best delta
  for (const h of history.filter((h) => h.improved && h.iteration > 0)) {
    const prev = history.find((p) => p.iteration === h.iteration - 1);
    const delta = prev ? h.score - prev.score : 0;
    const rules = getRulesFor(h);
    if (rules) {
      for (const r of rules) {
        const key = short(r);
        workedRules.set(key, Math.max(workedRules.get(key) || 0, delta));
      }
    }
  }
  if (workedRules.size > 0) {
    lines.push("WORKED:");
    for (const [rule, delta] of [...workedRules.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(`  ✓ +${delta.toFixed(1)} ${rule}`);
    }
    lines.push("");
  }

  // Deduplicated themes that failed
  const failedRules = new Map(); // short rule → worst delta
  for (const h of history.filter((h) => !h.improved && h.iteration > 0)) {
    const prev = history.find((p) => p.iteration === h.iteration - 1);
    const delta = prev ? h.score - prev.score : 0;
    const rules = getRulesFor(h);
    if (rules) {
      for (const r of rules) {
        const key = short(r);
        // Only include if not also in worked (avoid confusion)
        if (!workedRules.has(key)) {
          failedRules.set(key, Math.min(failedRules.get(key) || 0, delta));
        }
      }
    }
  }
  if (failedRules.size > 0) {
    lines.push("FAILED (do not retry):");
    for (const [rule, delta] of [...failedRules.entries()].sort((a, b) => a[1] - b[1])) {
      lines.push(`  ✗ ${delta.toFixed(1)} ${rule}`);
    }
    lines.push("");
  }

  // Stuck queries
  const recent = history.slice(-3);
  const stuck = [];
  for (let i = 0; i < (last.length || 0); i++) {
    const recentScores = recent.map((h) => h.queryScores?.[i]?.score ?? 0);
    if (recentScores.every((s) => s < 80)) {
      stuck.push(`"${(last[i]?.query || "").slice(0, 40)}..." (${recentScores.join(", ")})`);
    }
  }
  if (stuck.length > 0) {
    lines.push("STUCK (< 80 in last 3 iters):");
    for (const s of stuck) lines.push(`  ! ${s}`);
  }

  return lines.join("\n");
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
 * @param {string} [options.model] - Generation model (any provider: claude-*, gemini-*)
 * @param {string} [options.apiUrl] - Optional BVA API URL
 * @param {number} [options.maxIterations=10] - Max optimization iterations
 * @param {boolean} [options.resume=false] - Resume from saved state (crash recovery)
 * @param {AbortSignal} [options.signal] - Abort signal to stop the loop
 * @param {function} [options.onIteration] - Callback(iteration) for progress
 * @returns {Promise<{bestPrompt: string, bestScore: number, history: Array, totalIterations: number}>}
 */
export async function runPromptLoop(options) {
  const {
    initialPrompt,
    queries,
    model,
    apiUrl,
    maxIterations = 10,
    resume = false,
    signal,
    onIteration,
  } = options;

  let currentPrompt = initialPrompt;
  let bestScore = -Infinity;
  let bestPrompt = initialPrompt;
  let history = [];
  let startIteration = 0;

  // Resume from crash — pick up where we left off
  if (resume) {
    const saved = await loadState();
    if (saved && !saved.completed) {
      currentPrompt = saved.bestPrompt;
      bestPrompt = saved.bestPrompt;
      bestScore = saved.bestScore;
      history = saved.history || [];
      startIteration = history.length;
      // Replay previous iterations so client has full history for charts
      for (const prev of history) {
        if (onIteration) onIteration({ ...prev, replayed: true });
      }
    }
  }

  for (let i = startIteration; i < startIteration + maxIterations; i++) {
    // Check for abort signal (stop button)
    if (signal?.aborted) {
      if (history.length > 0) {
        history[history.length - 1].convergedReason = "Stopped by user";
      }
      break;
    }

    // 1. Run pipeline across all test queries and average scores
    let totalScore = 0;
    const queryResults = [];

    for (const query of queries) {
      const result = await runPipeline(query, currentPrompt, model, apiUrl);
      const score = computeScore(result.validationResults, result.criticFindings);
      totalScore += score;
      queryResults.push({ query, score, ...result });
    }

    const avgScore = Math.round((totalScore / queries.length) * 100) / 100;

    // 2. Record iteration
    const iteration = {
      iteration: i,
      model: model || "claude-sonnet-4-6",
      prompt: currentPrompt,
      score: avgScore,
      queryScores: queryResults.map((r) => ({ query: r.query, score: r.score })),
      totalCitations: queryResults.reduce((sum, r) => sum + r.citations.length, 0),
      totalFindings: queryResults.reduce((sum, r) => sum + r.criticFindings.length, 0),
      improved: avgScore > bestScore,
    };
    history.push(iteration);

    // 3. Report progress (include ledger for GUI)
    iteration.ledger = buildLedger(history);
    if (onIteration) onIteration(iteration);

    // 4. Ratchet: keep if improved, revert if not
    if (avgScore > bestScore) {
      bestScore = avgScore;
      bestPrompt = currentPrompt;
    } else {
      currentPrompt = bestPrompt;
    }

    // 5. Save state after every iteration (crash recovery) + ledger
    const currentLedger = buildLedger(history);
    await saveState({ bestPrompt, bestScore, initialScore: history[0]?.score ?? 0, history, totalIterations: history.length, ledger: currentLedger });

    // 6. Check convergence
    const { converged, reason } = checkConvergence(history);
    if (converged) {
      history[history.length - 1].convergedReason = reason;
      break;
    }

    // 7. Generate next prompt candidate (with ledger summary)
    const allFindings = queryResults.flatMap((r) => r.criticFindings);
    const allResults = queryResults.flatMap((r) => r.validationResults);
    const ledger = buildLedger(history);

    const advice = await suggestPromptUpdates(
      currentPrompt,
      allFindings,
      allResults,
      getAnthropic(),
      undefined,
      history,
      ledger,
    );

    if (advice.updated_prompt && advice.updated_prompt !== currentPrompt) {
      // Record what rules are being tried next (so ledger can report what failed/worked)
      iteration.suggestionsForNext = advice.suggestions.map((s) => s.rule);
      currentPrompt = advice.updated_prompt;
    } else {
      history[history.length - 1].convergedReason = "Advisor produced no new changes";
      break;
    }
  }

  const result = {
    bestPrompt,
    bestScore,
    initialScore: history[0]?.score ?? 0,
    history,
    totalIterations: history.length,
  };

  // Mark as completed so resume knows not to pick it up
  await saveState({ ...result, completed: true });

  return result;
}
