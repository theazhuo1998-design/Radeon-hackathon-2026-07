#!/usr/bin/env node
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

import {
  assertLoopbackProvider,
  assertVerifiedRadeonEnvironment
} from "./evidence-guard.mjs";
import {
  collectPublicGoldenCases,
  createExchangeRecorder
} from "./public-golden-collector.mjs";
import { verifyRecordedSource } from "./source-integrity.mjs";
import { resolveC0bOutDir } from "./resolve-out-dir.mjs";

if (process.env.PRIVATEPLATE_I_CONFIRM_RADEON_RUN !== "yes") {
  throw new Error(
    "Refusing Public Golden collection without PRIVATEPLATE_I_CONFIRM_RADEON_RUN=yes."
  );
}

const root = fileURLToPath(new URL("../../../", import.meta.url));
const outDir = resolveC0bOutDir(root);
const environmentPath = path.join(outDir, "environment.json");
const recordsPath = path.join(outDir, "public-golden.jsonl");
const summaryPath = path.join(outDir, "public-golden-summary.json");
const fixturePath = path.join(
  root,
  "fixtures/evals/public-agent-seed.json"
);
const baseUrl =
  process.env.PRIVATEPLATE_VLLM_BASE_URL ?? "http://127.0.0.1:8000/v1";
const model =
  process.env.PRIVATEPLATE_MODEL_ACTIVE ??
  process.env.PRIVATEPLATE_MODEL_ID ??
  process.env.PRIVATEPLATE_MODEL;

if (!model) {
  throw new Error("Active model id required for Public Golden collection.");
}
assertLoopbackProvider(baseUrl);
const environment = await assertVerifiedRadeonEnvironment(environmentPath);
await verifyRecordedSource(root, environmentPath);

async function importDist(relativePath) {
  const absolutePath = path.join(root, relativePath);
  await access(absolutePath);
  return import(pathToFileURL(absolutePath).href);
}

const agentRuntime = await importDist(
  "packages/agent-runtime/dist/index.js"
);
const domainPackage = await importDist("packages/domain/dist/index.js");
const { OpenAiCompatibleToolProvider, PrivatePlateAgent } = agentRuntime;
const { PrivatePlateDomain } = domainPackage;
if (
  typeof PrivatePlateAgent !== "function" ||
  typeof OpenAiCompatibleToolProvider !== "function" ||
  typeof PrivatePlateDomain?.create !== "function"
) {
  throw new Error("Built Agent, Provider, and Domain exports are required.");
}

const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const exchangeRecorder = createExchangeRecorder();
const provider = new OpenAiCompatibleToolProvider({
  baseUrl,
  model,
  apiKey: process.env.PRIVATEPLATE_VLLM_API_KEY,
  timeoutMs: Number(
    process.env.PRIVATEPLATE_REQUEST_TIMEOUT_MS ?? 120_000
  ),
  fetchImpl: (input, init) => exchangeRecorder.fetch(input, init)
});

const collection = await collectPublicGoldenCases({
  fixture,
  createDomain: () => PrivatePlateDomain.create(":memory:"),
  createAgent: (domain, caseId) =>
    new PrivatePlateAgent(domain, `public-golden-${caseId}`, provider),
  exchangeRecorder,
  model,
  modelProfile: process.env.PRIVATEPLATE_MODEL_PROFILE ?? null,
  runId: process.env.PRIVATEPLATE_RUN_ID ?? null,
  gitCommit: environment.git_commit ?? null,
  baseUrl
});

await mkdir(outDir, { recursive: true });
await writeFile(
  recordsPath,
  `${collection.records.map((record) => JSON.stringify(record)).join("\n")}\n`,
  "utf8"
);
await writeFile(
  summaryPath,
  `${JSON.stringify(collection.summary, null, 2)}\n`,
  "utf8"
);

console.log(
  JSON.stringify(
    {
      ...collection.summary,
      cases: undefined,
      records_path: path.relative(root, recordsPath),
      summary_path: path.relative(root, summaryPath)
    },
    null,
    2
  )
);
if (collection.summary.status !== "PASS") process.exitCode = 2;
