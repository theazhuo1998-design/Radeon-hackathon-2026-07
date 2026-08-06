#!/usr/bin/env node
/**
 * Static scans for C5: commit tools, secrets patterns, remote API defaults.
 */
import { readFile, readdir, stat, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_TOOL_ALLOWLIST } from "@privateplate/agent-runtime";

const root = fileURLToPath(new URL("../../..", import.meta.url));

const SECRET_PATTERNS: Array<{ id: string; re: RegExp }> = [
  { id: "aws_access_key", re: /AKIA[0-9A-Z]{16}/g },
  // Avoid flagging test placeholders like "stage-a-secret-..." or empty env examples.
  {
    id: "generic_api_key_assignment",
    re: /(?:api[_-]?key|API_KEY)\s*[:=]\s*['\"](?!stage-|test-|dummy-|your-|xxx)[A-Za-z0-9_\-]{24,}['\"]/g
  },
  { id: "private_key_block", re: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g },
  { id: "github_pat", re: /ghp_[A-Za-z0-9]{20,}/g }
];

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".git",
  "benchmarks",
  "coverage"
]);

async function walk(dir: string, files: string[] = []): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".gitignore") continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(abs, files);
    else if (/\.(ts|tsx|js|mjs|json|md)$/.test(entry.name)) files.push(abs);
  }
  return files;
}

const findings: Array<{ severity: string; id: string; file: string; detail: string }> = [];

// 1) Agent allowlist must not include commit
for (const tool of AGENT_TOOL_ALLOWLIST) {
  if (tool.startsWith("commit_")) {
    findings.push({
      severity: "blocker",
      id: "commit_in_allowlist",
      file: "packages/agent-runtime",
      detail: tool
    });
  }
}

// 2) Source scan for commit tool registration strings in agent package
const agentSrc = path.join(root, "packages/agent-runtime/src");
const agentFiles = await walk(agentSrc);
for (const file of agentFiles) {
  const text = await readFile(file, "utf8");
  if (/name:\s*['\"]commit_/.test(text) || /registerTool\(['\"]commit_/.test(text)) {
    findings.push({
      severity: "blocker",
      id: "commit_tool_registration",
      file: path.relative(root, file),
      detail: "possible commit tool registration"
    });
  }
}

// 3) Secret patterns across repo (excluding fixtures checksum noise)
const files = await walk(root);
for (const file of files) {
  if (file.includes(`${path.sep}package-lock.json`)) continue;
  const text = await readFile(file, "utf8");
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.re.test(text)) {
      findings.push({
        severity: "blocker",
        id: pattern.id,
        file: path.relative(root, file),
        detail: "matched secret-like pattern"
      });
    }
    pattern.re.lastIndex = 0;
  }
}

// 4) Runtime status claim: web/server should default remoteApi false
const appTs = await readFile(path.join(root, "apps/server/src/app.ts"), "utf8");
if (!appTs.includes("remoteApi: false")) {
  findings.push({
    severity: "blocker",
    id: "runtime_remote_api_default",
    file: "apps/server/src/app.ts",
    detail: "remoteApi:false not found in runtime status"
  });
}

const blockers = findings.filter((f) => f.severity === "blocker");
const summary = {
  schemaVersion: "1.0",
  stage: "C5",
  kind: "security_scan",
  scannedFiles: files.length,
  findingCount: findings.length,
  blockerCount: blockers.length,
  gate: blockers.length === 0 ? "PASS" : "FAIL",
  agentToolAllowlist: [...AGENT_TOOL_ALLOWLIST],
  findings
};

const outDir = path.join(root, "benchmarks/c5");
await mkdir(outDir, { recursive: true });
const outPath = path.join(outDir, "security-scan.json");
await writeFile(outPath, JSON.stringify(summary, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ wrote: outPath, gate: summary.gate, blockers: blockers.length }, null, 2));
if (summary.gate !== "PASS") {
  for (const f of blockers) console.error(f);
  process.exitCode = 2;
}
