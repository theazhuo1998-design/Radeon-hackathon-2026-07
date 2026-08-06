#!/usr/bin/env node
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runScenario } from "./run-scenario.js";
import type { AgentScenario, ScenarioResult } from "./types.js";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const scenariosPath = path.join(root, "fixtures/scenarios/agent-eval.json");
const outDir = path.join(root, "benchmarks/c5");

const scenarios = JSON.parse(await readFile(scenariosPath, "utf8")) as AgentScenario[];
const results: ScenarioResult[] = [];

console.log(`Running ${scenarios.length} agent eval scenarios...`);

for (const scenario of scenarios) {
  const result = await runScenario(scenario);
  results.push(result);
  const mark = result.pass ? "PASS" : "FAIL";
  console.log(
    `${mark} ${scenario.id} phase=${result.phase} tools=${result.tools.join(">") || "-"} ${result.durationMs}ms`
  );
  if (!result.pass) {
    for (const f of result.failures) console.log(`  - ${f}`);
  }
}

const passed = results.filter((r) => r.pass).length;
const summary = {
  schemaVersion: "1.0",
  stage: "C5",
  kind: "agent_eval",
  sampleCount: results.length,
  passCount: passed,
  failCount: results.length - passed,
  passRate: results.length ? passed / results.length : 0,
  threshold: 1,
  gate: passed === results.length ? "PASS" : "FAIL",
  evidenceEligible: false,
  claimBoundary:
    "Offline ScriptedProductProvider + PrivatePlateAgent + deterministic domain. Not AMD GPU/model evidence.",
  results
};

await mkdir(outDir, { recursive: true });
const outPath = path.join(outDir, "agent-eval-summary.json");
await writeFile(outPath, JSON.stringify(summary, null, 2) + "\n", "utf8");
console.log(`\nWrote ${outPath}`);
console.log(
  `Summary: ${passed}/${results.length} passed (rate=${summary.passRate.toFixed(3)}) gate=${summary.gate}`
);

if (summary.gate !== "PASS") process.exitCode = 2;
