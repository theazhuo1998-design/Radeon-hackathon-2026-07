#!/usr/bin/env node
/**
 * Run the main demo path N times (default 50) and report crash/business failures.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrivatePlateAgent, ScriptedProductProvider } from "@privateplate/agent-runtime";
import { PrivatePlateDomain } from "@privateplate/domain";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const iterations = Number(process.env.PRIVATEPLATE_STABILITY_N ?? 50);

type Row = {
  i: number;
  ok: boolean;
  error?: string;
  planVersion?: number;
  inboxCount?: number;
  durationMs: number;
};

const rows: Row[] = [];
let crashes = 0;
let businessFails = 0;

console.log(`Stability: ${iterations} consecutive scripted-mock main paths...`);

for (let i = 1; i <= iterations; i += 1) {
  const started = Date.now();
  try {
    const domain = await PrivatePlateDomain.create(":memory:");
    const agent = new PrivatePlateAgent(domain, `stab-${i}`, new ScriptedProductProvider());

    const t1 = await agent.handleUserMessage(
      "中午我们三个人吃什么？豆腐今天最好吃掉，但我不想再吃鸡腿了。"
    );
    const t2 = await agent.handleUserMessage("蒸蛋今天也不想吃，换一道，其他都保留。");
    const t3 = await agent.handleUserMessage("发给保姆");

    if (!t1.validationOk || !t2.validationOk || !t3.validationOk) {
      businessFails += 1;
      rows.push({
        i,
        ok: false,
        error: "validation_failed",
        durationMs: Date.now() - started
      });
      domain.close();
      continue;
    }
    if (!t3.uiOnly || agent.state.activePlanVersion !== 2) {
      businessFails += 1;
      const row: Row = {
        i,
        ok: false,
        error: "missing_preview_or_version",
        durationMs: Date.now() - started
      };
      if (agent.state.activePlanVersion != null) row.planVersion = agent.state.activePlanVersion;
      rows.push(row);
      domain.close();
      continue;
    }

    const confirm = agent.confirmPending({
      confirmationToken: t3.uiOnly.confirmationToken,
      idempotencyKey: `stab-${i}`,
      payloadHash: t3.uiOnly.payloadHash
    });
    if (!confirm.ok) {
      businessFails += 1;
      rows.push({
        i,
        ok: false,
        error: `confirm_${"code" in confirm ? confirm.code : "fail"}`,
        durationMs: Date.now() - started
      });
      domain.close();
      continue;
    }

    const inboxCount = Number(
      (domain.db.prepare(`SELECT COUNT(*) AS c FROM caregiver_tasks`).get() as { c: number })
        .c
    );
    const ok = inboxCount === 1;
    if (!ok) businessFails += 1;
    const row: Row = {
      i,
      ok,
      inboxCount,
      durationMs: Date.now() - started
    };
    if (agent.state.activePlanVersion != null) row.planVersion = agent.state.activePlanVersion;
    if (!ok) row.error = "inbox_count";
    rows.push(row);
    domain.close();
  } catch (error) {
    crashes += 1;
    rows.push({
      i,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - started
    });
  }

  if (i % 10 === 0 || i === iterations) {
    const okCount = rows.filter((r) => r.ok).length;
    console.log(`  ${i}/${iterations} ok=${okCount} crashes=${crashes} businessFails=${businessFails}`);
  }
}

const passCount = rows.filter((r) => r.ok).length;
const durations = rows.filter((r) => r.ok).map((r) => r.durationMs).sort((a, b) => a - b);
const p50 = durations.length ? durations[Math.floor(durations.length * 0.5)]! : null;
const p90 = durations.length ? durations[Math.min(durations.length - 1, Math.ceil(durations.length * 0.9) - 1)]! : null;

const summary = {
  schemaVersion: "1.0",
  stage: "C5",
  kind: "stability_main_demo",
  iterations,
  passCount,
  crashCount: crashes,
  businessFailCount: businessFails,
  passRate: iterations ? passCount / iterations : 0,
  durationMs: { p50, p90, n: durations.length },
  gate: passCount === iterations && crashes === 0 ? "PASS" : "FAIL",
  evidenceEligible: false,
  claimBoundary: "Local stability only; not AMD GPU performance evidence.",
  rows
};

const outDir = path.join(root, "benchmarks/c5");
await mkdir(outDir, { recursive: true });
const outPath = path.join(outDir, "stability-summary.json");
await writeFile(outPath, JSON.stringify(summary, null, 2) + "\n", "utf8");
console.log(`Wrote ${outPath}`);
console.log(
  `Stability gate=${summary.gate} pass=${passCount}/${iterations} crash=${crashes} p50=${p50}ms p90=${p90}ms`
);

if (summary.gate !== "PASS") process.exitCode = 2;
