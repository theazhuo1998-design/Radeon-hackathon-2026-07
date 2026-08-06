import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runScenario } from "./run-scenario.js";
import type { AgentScenario } from "./types.js";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const scenarios = JSON.parse(
  await readFile(path.join(root, "fixtures/scenarios/agent-eval.json"), "utf8")
) as AgentScenario[];

describe("C5 agent eval suite", () => {
  it("has at least 20 scenarios", () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(20);
  });

  it("passes all scenarios", async () => {
    const failed: string[] = [];
    for (const scenario of scenarios) {
      const result = await runScenario(scenario);
      if (!result.pass) {
        failed.push(`${scenario.id}: ${result.failures.join("; ")}`);
      }
    }
    expect(failed, failed.join("\n")).toEqual([]);
  }, 180_000);
});
