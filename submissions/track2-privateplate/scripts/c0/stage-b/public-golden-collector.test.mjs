import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  collectPublicGoldenCases,
  seedGoldenCase
} from "./public-golden-collector.mjs";

const root = fileURLToPath(new URL("../../..", import.meta.url));

test("Public Golden state seed uses real plan and pending-action ids", () => {
  const domain = fakeDomain();
  const agent = fakeAgent();
  seedGoldenCase(domain, agent, {
    id: "golden-seed",
    initialState: {
      phase: "AWAITING_CONFIRMATION",
      activePlanId: "plan-active",
      activePlanVersion: 2,
      pendingActionId: "pending-old",
      dinerIds: ["mem-father"],
      focusedTemplateId: "tpl-shiitake-egg"
    },
    turns: [],
    requiredTools: [],
    forbiddenTools: []
  });

  assert.equal(agent.state.activePlanId, "plan-real-v2");
  assert.equal(agent.state.activePlanVersion, 2);
  assert.equal(agent.state.pendingActionId, "pending-real");
  assert.equal(agent.focusedTemplateId, "tpl-shiitake-egg");
  assert.deepEqual(agent.state.dinerIds, ["mem-father"]);
  assert.equal(domain.calls.compose, 1);
  assert.equal(domain.calls.revise, 1);
  assert.equal(domain.calls.preview, 1);
});

test("fact collector drives exactly 36 real-provider Agent cases", async () => {
  const fixture = {
    role: "public_golden",
    cases: Array.from({ length: 36 }, (_, index) => ({
      id: `case-${index + 1}`,
      initialState: {
        phase: "COLLECTING_CONTEXT",
        dinerIds: ["mem-admin"]
      },
      turns: [
        {
          user: `case ${index + 1}`,
          allowedModelActions: [{ kind: "final" }]
        }
      ],
      expectedOutcome: "COMPLETE",
      requiredTools: [],
      forbiddenTools: ["commit_*"]
    }))
  };
  const exchangeRecorder = {
    reset() {},
    read() {
      return [];
    }
  };

  const result = await collectPublicGoldenCases({
    fixture,
    createDomain: async () => fakeDomain(),
    createAgent: () => fakeAgent(),
    exchangeRecorder,
    model: "local-model",
    modelProfile: "test-profile",
    runId: "test-run",
    gitCommit: "a".repeat(40),
    baseUrl: "http://127.0.0.1:8000/v1"
  });

  assert.equal(result.records.length, 36);
  assert.equal(result.summary.status, "PASS");
  assert.equal(result.summary.model_capability.gate, "PASS");
  assert.equal(result.summary.product_completion.gate, "PASS");
  assert.equal(result.summary.safety.gate, "PASS");
  assert.ok(
    result.records.every(
      (record) =>
        record.providerMode ===
          "local_vllm_radeon_product_agent" &&
        record.turns.length === 1
    )
  );
});

test("Radeon run-all invokes and gates the Public Golden collector", async () => {
  const runAll = await readFile(
    path.join(root, "scripts/c0/stage-b/run-all.sh"),
    "utf8"
  );
  assert.match(runAll, /02c-run-public-golden\.mjs/);
  assert.match(runAll, /PRIVATEPLATE_PUBLIC_GOLDEN_STEP_STATUS/);
  assert.match(runAll, /public-golden-summary\.json/);
  assert.match(runAll, /agent_diagnostic/);
  assert.match(runAll, /write-agent-diagnostic-summary\.mjs/);
});

test("agent diagnostic summary requires both real-provider suites", async () => {
  const evidenceRoot = path.join(root, "benchmarks/c0/stage-b");
  const outDir = await mkdtemp(
    path.join(evidenceRoot, "privateplate-agent-diagnostic-test-")
  );
  try {
    await writeFile(
      path.join(outDir, "product-agent-e2e-summary.json"),
      `${JSON.stringify({
        status: "PASS",
        sample_count: 5,
        failed_count: 0,
        git_commit: "a".repeat(40)
      })}\n`
    );
    await writeFile(
      path.join(outDir, "public-golden-summary.json"),
      `${JSON.stringify({
        status: "PASS",
        sample_count: 36,
        git_commit: "a".repeat(40),
        model_capability: { gate: "PASS" },
        product_completion: { gate: "PASS" },
        safety: { gate: "PASS" }
      })}\n`
    );
    const { spawnSync } = await import("node:child_process");
    const result = spawnSync(
      process.execPath,
      [
        path.join(
          root,
          "scripts/c0/stage-b/write-agent-diagnostic-summary.mjs"
        )
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PRIVATEPLATE_C0B_OUT_DIR: outDir,
          PRIVATEPLATE_RUN_ID: path.basename(outDir),
          PRIVATEPLATE_MODEL_PROFILE: "gemma4"
        }
      }
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const summary = JSON.parse(
      await readFile(
        path.join(outDir, "agent-diagnostic-summary.json"),
        "utf8"
      )
    );
    assert.equal(summary.status, "PASS");
    assert.equal(summary.public_golden.sample_count, 36);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

function fakeAgent() {
  return {
    focusedTemplateId: null,
    state: {
      sessionId: "session",
      householdId: "household",
      phase: "IDLE",
      intent: "unknown",
      dinerIds: ["mem-admin"],
      householdContextVersion: null,
      inventoryVersion: null,
      mealPolicyVersion: null,
      mealSessionId: null,
      activePlanId: null,
      activePlanVersion: null,
      activeConstraintIds: [],
      rejectedTemplateIds: [],
      rejectedFoodIds: [],
      requestedPriorityFoodIds: [],
      preferLowEffort: false,
      pendingActionId: null,
      lastCommittedActionId: null,
      lastCommittedPayloadHash: null,
      lastToolStatus: "none",
      errorCode: null,
      toolSteps: 0,
      maxToolSteps: 6
    },
    setFocusedTemplateId(templateId) {
      this.focusedTemplateId = templateId;
    },
    async handleUserMessage() {
      this.state.phase = "COMPLETED";
      return {
        answer: "已完成。",
        validationOk: true,
        validationReasons: [],
        phase: "COMPLETED",
        state: this.state,
        toolTrace: [],
        modelSteps: [
          {
            decision: "final",
            tool: null,
            policy: {
              reasons: [],
              privacyViolation: false
            },
            missingFields: []
          }
        ],
        taskOutcome: {
          goal: "no_action",
          status: "COMPLETE",
          phase: "COMPLETED",
          verification: { passed: true },
          reasons: [],
          evidence: [{ kind: "answer_validation", ok: true }]
        },
        routingEvidenceKind: "model_routed"
      };
    }
  };
}

function fakeDomain() {
  const calls = {
    compose: 0,
    revise: 0,
    preview: 0
  };
  return {
    calls,
    db: {
      prepare() {
        return {
          get() {
            return { count: 0 };
          }
        };
      }
    },
    getMembers() {
      return [
        { id: "mem-admin" },
        { id: "mem-father" },
        { id: "mem-mother" }
      ];
    },
    composeMeal() {
      calls.compose += 1;
      return {
        status: "valid",
        sessionId: "meal-real",
        plan: plan(1)
      };
    },
    reviseMeal() {
      calls.revise += 1;
      return {
        status: "valid",
        plan: plan(2)
      };
    },
    previewCaregiverSend() {
      calls.preview += 1;
      return {
        confirmation: {
          pendingActionId: "pending-real"
        }
      };
    },
    cancelCaregiverSend() {
      return { ok: true };
    },
    retrieveApprovedGuidance() {
      return { cards: [] };
    },
    close() {}
  };
}

function plan(version) {
  return {
    id: `plan-real-v${version}`,
    version,
    activeConstraintIds: [],
    rejectedTemplateIds: [],
    rejectedFoodIds: [],
    requestedPriorityFoodIds: [],
    preferLowEffort: false
  };
}
