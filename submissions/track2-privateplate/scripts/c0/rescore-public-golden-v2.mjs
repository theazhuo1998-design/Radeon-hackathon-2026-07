#!/usr/bin/env node
/**
 * Derived re-score of an existing public-golden JSONL with the current scorer.
 * Never mutates the raw JSONL; writes a sibling *-derived-score-v2.json.
 *
 * Usage:
 *   node scripts/c0/rescore-public-golden-v2.mjs --jsonl path/to/public-golden.jsonl
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const args = process.argv.slice(2);
const jsonlFlag = args.indexOf("--jsonl");
if (jsonlFlag < 0 || !args[jsonlFlag + 1]) {
  console.error(
    "Usage: node scripts/c0/rescore-public-golden-v2.mjs --jsonl <public-golden.jsonl>"
  );
  process.exit(2);
}

const jsonlPath = path.resolve(args[jsonlFlag + 1]);
const raw = await readFile(jsonlPath);
const sha = createHash("sha256").update(raw).digest("hex");
const text = raw.toString("utf8");

// Reuse the public golden scorer entry.
const scorerUrl = pathToFileURL(
  path.resolve("scripts/c0/run-public-golden.mjs")
).href;

// Dynamic import of score function via CLI-compatible path:
// run-public-golden supports --records.
import { spawnSync } from "node:child_process";
const outPath = jsonlPath.replace(
  /public-golden\.jsonl$/,
  "public-golden-derived-score-v2.json"
);
const result = spawnSync(
  process.execPath,
  [
    "scripts/c0/run-public-golden.mjs",
    "--records",
    jsonlPath
  ],
  { encoding: "utf8" }
);

let scored;
try {
  scored = JSON.parse(result.stdout);
} catch {
  console.error(result.stdout);
  console.error(result.stderr);
  process.exit(result.status ?? 1);
}

const envelope = {
  schema_version: "2.0",
  scorer: "public-golden-derived-v2",
  source_jsonl: path.relative(process.cwd(), jsonlPath),
  source_jsonl_sha256: sha,
  rescored_at_utc: new Date().toISOString(),
  note: "Derived score only. Raw JSONL is immutable evidence.",
  score: scored
};

await writeFile(outPath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
console.log(
  JSON.stringify(
    {
      status: "OK",
      wrote: path.relative(process.cwd(), outPath),
      source_sha256: sha,
      model: scored.model_capability ?? scored.modelCapability,
      product: scored.product_completion ?? scored.productCompletion,
      safety: scored.safety
    },
    null,
    2
  )
);
