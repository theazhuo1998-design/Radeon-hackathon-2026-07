#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveC0bOutDir } from "./resolve-out-dir.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const outDir = resolveC0bOutDir(root);
const productAgent = await readJson(
  path.join(outDir, "product-agent-e2e-summary.json")
);
const publicGolden = await readJson(
  path.join(outDir, "public-golden-summary.json")
);

const failures = [];
if (
  productAgent?.status !== "PASS" ||
  productAgent?.sample_count !== 5 ||
  productAgent?.failed_count !== 0
) {
  failures.push("product_agent");
}
if (
  publicGolden?.status !== "PASS" ||
  publicGolden?.sample_count !== 36
) {
  failures.push("public_golden");
}
for (const layer of [
  "model_capability",
  "product_completion",
  "safety"
]) {
  if (publicGolden?.[layer]?.gate !== "PASS") {
    failures.push(`public_golden:${layer}`);
  }
}

const payload = {
  schema_version: "1.0",
  stage: "C0-B",
  scope: "agent_diagnostic",
  status: failures.length === 0 ? "PASS" : "FAIL",
  run_id: process.env.PRIVATEPLATE_RUN_ID ?? path.basename(outDir),
  model_profile: process.env.PRIVATEPLATE_MODEL_PROFILE ?? null,
  git_commit:
    publicGolden?.git_commit ?? productAgent?.git_commit ?? null,
  product_agent: {
    status: productAgent?.status ?? "MISSING",
    sample_count: productAgent?.sample_count ?? 0,
    failed_count: productAgent?.failed_count ?? null
  },
  public_golden: {
    status: publicGolden?.status ?? "MISSING",
    sample_count: publicGolden?.sample_count ?? 0,
    model_capability: publicGolden?.model_capability ?? null,
    product_completion: publicGolden?.product_completion ?? null,
    safety: publicGolden?.safety ?? null
  },
  failures: [...new Set(failures)],
  claim_boundary:
    "Agent diagnostic runs the reviewed five-scenario product path and 36-case Public Golden only. It is real Radeon regression evidence, not sealed blind or formal C0-B evidence."
};

await writeFile(
  path.join(outDir, "agent-diagnostic-summary.json"),
  `${JSON.stringify(payload, null, 2)}\n`,
  "utf8"
);
console.log(JSON.stringify(payload, null, 2));
if (payload.status !== "PASS") process.exitCode = 2;

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}
