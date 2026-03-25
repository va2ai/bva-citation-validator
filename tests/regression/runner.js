#!/usr/bin/env node
/**
 * Regression Test Runner
 *
 * Runs frozen failure cases against the citation validator pipeline to verify
 * that fixes continue to hold. Each case defines expected citation outcomes
 * that are checked against the validation results.
 *
 * Usage: node tests/regression/runner.js
 * Exit code: 0 = all pass, 1 = regression detected
 */

import { readdir, readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import Anthropic from "@anthropic-ai/sdk";
import { extractCitations } from "../../lib/extract.js";
import { RETRIEVAL_CONTEXT, GROUNDED_PROMPT, buildContext } from "../../lib/context.js";
import { validateCitations, normalize } from "../../lib/validate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CASES_DIR = join(__dirname, "cases");

const client = new Anthropic();

// ---------------------------------------------------------------------------
// Run a single validation pipeline (grounded mode)
// ---------------------------------------------------------------------------

async function runPipeline(query) {
  const contextBlock = buildContext();

  // Step 1: Generation
  const genResponse = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    system: GROUNDED_PROMPT,
    messages: [{ role: "user", content: `RETRIEVED SOURCE MATERIALS:\n\n${contextBlock}\n\n---\n\nQUESTION: ${query}` }],
  });
  const responseText = genResponse.content[0].text;

  // Step 2: Extraction (via tool-use structured output)
  const { citations } = await extractCitations(responseText, client);

  // Step 3: Validation
  const results = await validateCitations(citations, null);

  return { responseText, citations, results };
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

async function runTests() {
  const files = (await readdir(CASES_DIR)).filter((f) => f.endsWith(".json")).sort();
  const testResults = [];
  let passed = 0;
  let failed = 0;

  console.log("═".repeat(80));
  console.log("  REGRESSION TEST SUITE");
  console.log("═".repeat(80));
  console.log();

  for (const file of files) {
    const testCase = JSON.parse(await readFile(join(CASES_DIR, file), "utf-8"));
    console.log(`─ Case ${testCase.id}: ${testCase.name}`);
    console.log(`  Fix: ${testCase.fix_applied} | Mode: ${testCase.failure_mode}`);

    try {
      const { results } = await runPipeline(testCase.query);

      let casePass = true;

      // Check expected verified citations
      if (testCase.expected_verified) {
        for (const expected of testCase.expected_verified) {
          const found = results.some(
            (r) => r.status === "VERIFIED" && normalize(r.identifier).includes(normalize(expected))
          );
          if (!found) {
            console.log(`  FAIL: Expected VERIFIED citation "${expected}" not found`);
            casePass = false;
          }
        }
      }

      // Check expected outdated citations
      if (testCase.expected_outdated) {
        for (const expected of testCase.expected_outdated) {
          const found = results.some(
            (r) => r.status === "OUTDATED" && normalize(r.identifier).includes(normalize(expected))
          );
          if (!found) {
            console.log(`  FAIL: Expected OUTDATED citation "${expected}" not found`);
            casePass = false;
          }
        }
      }

      // Check that known bad citations are flagged (NOT_IN_SOURCES or HALLUCINATED)
      if (testCase.known_bad_citations) {
        for (const bad of testCase.known_bad_citations) {
          const found = results.find(
            (r) => normalize(r.identifier).includes(normalize(bad))
          );
          if (found && found.status === "VERIFIED") {
            console.log(`  FAIL: Known bad citation "${bad}" was VERIFIED (should be flagged)`);
            casePass = false;
          }
        }
      }

      // Check expected NOT_IN_SOURCES by type
      if (testCase.expected_not_in_sources_types) {
        for (const type of testCase.expected_not_in_sources_types) {
          const ofType = results.filter((r) => r.type === type);
          const allFlagged = ofType.every((r) => r.status !== "VERIFIED");
          if (!allFlagged && ofType.length > 0) {
            console.log(`  FAIL: Expected all "${type}" citations to be flagged, but some were VERIFIED`);
            casePass = false;
          }
        }
      }

      if (casePass) {
        console.log(`  PASS`);
        passed++;
      } else {
        failed++;
      }

      testResults.push({ id: testCase.id, name: testCase.name, pass: casePass });
    } catch (err) {
      console.log(`  ERROR: ${err.message}`);
      failed++;
      testResults.push({ id: testCase.id, name: testCase.name, pass: false, error: err.message });
    }

    console.log();
  }

  console.log("═".repeat(80));
  console.log(`  RESULTS: ${passed} passed, ${failed} failed (${files.length} total)`);
  console.log("═".repeat(80));

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
