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

  const lines = ["OPTIMIZATION LEDGER — what the AI has learned so far:\n"];

  // Best score trajectory
  let runningBest = -Infinity;
  const milestones = [];
  for (const h of history) {
    if (h.score > runningBest) {
      runningBest = h.score;
      milestones.push(`Iter ${h.iteration}: score ${h.score} (new best)`);
    }
  }
  lines.push(`Score progression: ${history[0].score} → ${runningBest} (best) across ${history.length} iterations`);
  lines.push(`Milestones: ${milestones.join(" → ")}\n`);

  // Per-query trends: which queries improved, which are stuck
  const firstScores = history[0].queryScores || [];
  const lastScores = history[history.length - 1].queryScores || [];
  if (firstScores.length > 0) {
    lines.push("Per-query trends:");
    for (let i = 0; i < lastScores.length; i++) {
      const first = firstScores[i]?.score ?? 0;
      const last = lastScores[i]?.score ?? 0;
      const delta = last - first;
      const trend = delta > 0 ? "IMPROVED" : delta < 0 ? "REGRESSED" : "UNCHANGED";
      const shortQ = (lastScores[i]?.query || "").slice(0, 50);
      lines.push(`  "${shortQ}..." — ${first} → ${last} (${trend}${delta !== 0 ? `, ${delta > 0 ? "+" : ""}${delta.toFixed(1)}` : ""})`);
    }
    lines.push("");
  }

  // Helper: get rules applied for an iteration (from previous iter's suggestionsForNext)
  // Falls back to diffing prompt lines if suggestions weren't recorded
  function getRulesFor(h) {
    const idx = history.indexOf(h);
    const prev = idx > 0 ? history[idx - 1] : null;
    if (prev?.suggestionsForNext?.length > 0) return prev.suggestionsForNext;
    // Fallback: find new lines added to prompt
    if (prev?.prompt && h.prompt && h.prompt !== prev.prompt) {
      const prevLines = new Set(prev.prompt.split("\n").map((l) => l.trim()).filter(Boolean));
      const newRules = h.prompt.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("- ") && !prevLines.has(l));
      if (newRules.length > 0) return newRules.map((r) => r.replace(/^- /, ""));
    }
    return null;
  }

  // What worked: rules from kept iterations
  const kept = history.filter((h) => h.improved && h.iteration > 0);
  if (kept.length > 0) {
    lines.push(`Strategies that WORKED (${kept.length} improvements):`);
    for (const h of kept) {
      const prev = history.find((p) => p.iteration === h.iteration - 1);
      const scoreDelta = prev ? h.score - prev.score : 0;
      const rules = getRulesFor(h);
      lines.push(`  Iter ${h.iteration}: +${scoreDelta.toFixed(1)} points`);
      if (rules && rules.length > 0) {
        for (const rule of rules) {
          lines.push(`    ✓ ${rule}`);
        }
      } else {
        lines.push(`    (prompt changed but specific rules not recorded)`);
      }
    }
    lines.push("");
  }

  // What failed: rules from reverted iterations
  const reverted = history.filter((h) => !h.improved && h.iteration > 0);
  if (reverted.length > 0) {
    lines.push(`Strategies that FAILED (${reverted.length} reverted):`);
    for (const h of reverted) {
      const prev = history.find((p) => p.iteration === h.iteration - 1);
      const scoreDelta = prev ? h.score - prev.score : 0;
      const rules = getRulesFor(h);
      lines.push(`  Iter ${h.iteration}: ${scoreDelta.toFixed(1)} points — findings=${h.totalFindings}, citations=${h.totalCitations}`);
      if (rules && rules.length > 0) {
        for (const rule of rules) {
          lines.push(`    ✗ ${rule}`);
        }
      } else {
        lines.push(`    (prompt changed but specific rules not recorded)`);
      }
    }
    lines.push("");
  }

  // Persistent problems: issues that appear in every recent iteration
  const recent = history.slice(-3);
  const allRecentFindings = recent.flatMap((h) =>
    (h.queryScores || []).filter((q) => q.score < 80).map((q) => q.query.slice(0, 50))
  );
  const freqMap = {};
  for (const q of allRecentFindings) freqMap[q] = (freqMap[q] || 0) + 1;
  const persistent = Object.entries(freqMap).filter(([, c]) => c >= 2);
  if (persistent.length > 0) {
    lines.push("PERSISTENT WEAK SPOTS (low scores in 2+ recent iterations):");
    for (const [q, count] of persistent) {
      lines.push(`  "${q}..." — scored < 80 in ${count} of last ${recent.length} iterations`);
    }
    lines.push("");
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
