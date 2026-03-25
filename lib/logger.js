/**
 * Structured JSON Logging
 *
 * Provides session-level logging for the citation validator pipeline.
 * Each validation run creates a session with a unique ID, and all steps
 * are logged as structured JSON. Sessions are appended to logs/sessions.jsonl.
 */

import { appendFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, "..", "logs");
const LOG_FILE = join(LOG_DIR, "sessions.jsonl");

/**
 * Create a new logging session.
 * @param {string} query - The user's query
 * @param {string} mode - "grounded" or "ungrounded"
 * @param {string} model - The model used for generation
 * @returns {object} Session object
 */
export function createSession(query, mode, model) {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    query,
    mode,
    model,
    steps: [],
    citations: { total: 0, verified: 0, outdated: 0, ungrounded: 0, not_in_sources: 0, hallucinated: 0 },
    critic: { findings: 0, high: 0, medium: 0, low: 0 },
    duration_ms: 0,
    _startTime: Date.now(),
  };
}

/**
 * Log a pipeline step to the session.
 * @param {object} session - The session object
 * @param {string} stepName - Name of the step
 * @param {object} data - Step data to log
 */
export function logStep(session, stepName, data) {
  session.steps.push({
    step: stepName,
    timestamp: new Date().toISOString(),
    data,
  });
}

/**
 * Finalize the session and write to the JSONL log file.
 * @param {object} session - The session object
 */
export async function finalizeSession(session) {
  session.duration_ms = Date.now() - session._startTime;
  delete session._startTime;

  try {
    await mkdir(LOG_DIR, { recursive: true });
    await appendFile(LOG_FILE, JSON.stringify(session) + "\n");
  } catch (err) {
    console.error("  [logger] Failed to write session log:", err.message);
  }
}
