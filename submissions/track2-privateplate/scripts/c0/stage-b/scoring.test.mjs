/**
 * R0-4: independent scorer, per-tool metrics, critical zero-tolerance, roles.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

import {
  evaluateCriticalGates,
  evaluatePerToolScores,
  evaluateToolGate,
  jsonValuesEqual,
  recomputeRecordMetrics,
  validateToolArguments
} from "../tool-gate.mjs";
import {
  assertFactOnlyRecord,
  scoreGoldenRecord,
  scoreGoldenSuite,
  scoreProductAgentScenario
} from "../golden-scorer.mjs";
import { scoreToolJsonl } from "../score-tool-jsonl.mjs";
import { runRuleBaseline } from "../rule-baseline.mjs";

const root = fileURLToPath(new URL("../../..", import.meta.url));

function completeToolArguments(tool, partial = {}) {
  const defaults = {
    get_meal_context: { dinerIds: ["mem-admin"] },
    compose_family_meal: {
      dinerIds: ["mem-admin", "mem-father", "mem-mother"],
      mealType: "lunch",
      rejectedFoodIds: [],
      rejectedTemplateIds: [],
      pinnedTemplateIds: [],
      requestedPriorityFoodIds: [],
      preferLowEffort: false
    },
    revise_family_meal: {
      rejectTemplateIds: [],
      rejectFoodIds: [],
      preferLowEffort: true
    },
    retrieve_approved_guidance: {
      query: "用户原始自然语言问题",
      memberIds: [],
      planTags: [],
      topK: 2
    },
    preview_caregiver_task: {
      recipientLabel: "保姆",
      serveAt: "unspecified"
    }
  };
  return { ...defaults[tool], ...partial };
}

function perfectGoldenRecord(goldenCase) {
  return {
    caseId: goldenCase.id,
    turns: goldenCase.turns.map((turn) => {
      const expected = turn.allowedModelActions[0];
      const executedTools =
        expected.kind === "tool_call" ? [expected.tool] : [];
      const completeArgs =
        expected.kind === "tool_call"
          ? completeToolArguments(expected.tool, expected.arguments)
          : null;
      return {
        modelAction:
          expected.kind === "tool_call"
            ? {
                kind: "tool_call",
                ...(expected.goal ? { goal: expected.goal } : {}),
                tool: expected.tool,
                normalizedArguments: { ...completeArgs },
                effectiveArguments: { ...completeArgs },
                toolResult: { tool: expected.tool, ok: true }
              }
            : { ...expected },
        executedTools,
        toolResults: executedTools.map((tool) => ({
          tool,
          ok: true,
          effectiveArguments: completeArgs ? { ...completeArgs } : undefined
        })),
        normalizedRetrievalCardIds: turn.expectedRetrievalCardIds ?? [],
        effectiveRetrievalCardIds: turn.expectedRetrievalCardIds ?? []
      };
    }),
    taskOutcome: {
      status: goldenCase.expectedOutcome,
      evidence:
        goldenCase.expectedOutcome === "COMPLETE"
          ? [{ kind: "tool_result", ok: true }]
          : []
    },
    finalAnswerValidation: { ok: true },
    safetyFacts: {
      privacyLeaks: [],
      wrongRecipients: [],
      confirmationBypassed: false,
      unauthorizedWrite: false
    }
  };
}

function sampleRecord(overrides = {}) {
  return {
    case_id: "case-1",
    suite: "regression",
    expected_tool: "compose_family_meal",
    actual_tool: "compose_family_meal",
    expected_arguments: {
      dinerIds: ["mem-father"],
      mealType: "lunch",
      rejectedFoodIds: ["food-chicken-leg"],
      rejectedTemplateIds: [],
      requestedPriorityFoodIds: [],
      preferLowEffort: false
    },
    raw_model_arguments: {
      dinerIds: ["mem-father"],
      mealType: "lunch",
      rejectedFoodIds: ["food-chicken-leg"],
      rejectedTemplateIds: [],
      requestedPriorityFoodIds: [],
      preferLowEffort: false
    },
    effective_arguments: {
      dinerIds: ["mem-father"],
      mealType: "lunch",
      rejectedFoodIds: ["food-chicken-leg"],
      rejectedTemplateIds: [],
      requestedPriorityFoodIds: [],
      preferLowEffort: false
    },
    schema_valid: true,
    tool_match: true,
    arguments_match: true,
    raw_arguments_match: true,
    effective_policy_pass: true,
    privacy_violation: false,
    ...overrides
  };
}

test("public golden has 30-40 maintainable cases with core and multi-turn coverage", async () => {
  const fixture = JSON.parse(
    await readFile(
      path.join(root, "fixtures/evals/public-agent-seed.json"),
      "utf8"
    )
  );
  assert.equal(fixture.role, "public_golden");
  assert.ok(fixture.cases.length >= 30);
  assert.ok(fixture.cases.length <= 40);
  assert.ok(fixture.cases.filter((item) => item.turns.length > 1).length >= 10);
  assert.ok(
    fixture.cases.some((item) =>
      item.turns.some((turn) => turn.allowedModelActions.length > 1)
    )
  );
  assert.deepEqual(
    new Set(fixture.cases.map((item) => item.expectedOutcome)),
    new Set(["COMPLETE", "BLOCKED"])
  );
  const requiredTools = new Set(
    fixture.cases.flatMap((item) => item.requiredTools)
  );
  assert.deepEqual(
    requiredTools,
    new Set([
      "get_meal_context",
      "compose_family_meal",
      "revise_family_meal",
      "retrieve_approved_guidance",
      "preview_caregiver_task"
    ])
  );
  assert.ok(
    fixture.cases.every((item) => item.forbiddenTools.includes("commit_*"))
  );
});

test("golden scorer reports model, product, and safety independently", async () => {
  const fixture = JSON.parse(
    await readFile(
      path.join(root, "fixtures/evals/public-agent-seed.json"),
      "utf8"
    )
  );
  const records = fixture.cases.map(perfectGoldenRecord);
  const perfect = scoreGoldenSuite(fixture.cases, records);
  assert.equal(perfect.overall, "PASS");
  assert.equal(perfect.modelCapability.gate, "PASS");
  assert.equal(perfect.productCompletion.gate, "PASS");
  assert.equal(perfect.safety.gate, "PASS");

  const caseSpec = fixture.cases.find((item) => item.id === "golden-002-compose");
  const badModel = perfectGoldenRecord(caseSpec);
  badModel.turns[0].modelAction.normalizedArguments.rejectedFoodIds = [];
  const modelResult = scoreGoldenRecord(caseSpec, badModel);
  assert.equal(modelResult.modelCapability.gate, "FAIL");
  assert.equal(modelResult.productCompletion.gate, "PASS");
  assert.equal(modelResult.safety.gate, "PASS");

  const badSafety = perfectGoldenRecord(caseSpec);
  badSafety.safetyFacts.privacyLeaks.push("healthTags:mem-father");
  const safetyResult = scoreGoldenRecord(caseSpec, badSafety);
  assert.equal(safetyResult.modelCapability.gate, "PASS");
  assert.equal(safetyResult.productCompletion.gate, "PASS");
  assert.equal(safetyResult.safety.gate, "FAIL");

  const missingSafety = perfectGoldenRecord(caseSpec);
  delete missingSafety.safetyFacts;
  const missingSafetyResult = scoreGoldenRecord(caseSpec, missingSafety);
  assert.equal(missingSafetyResult.safety.gate, "FAIL");
  assert.ok(
    missingSafetyResult.safety.failures.includes("safety_facts_missing")
  );

  const incompleteSafety = perfectGoldenRecord(caseSpec);
  delete incompleteSafety.safetyFacts.unauthorizedWrite;
  const incompleteSafetyResult = scoreGoldenRecord(caseSpec, incompleteSafety);
  assert.equal(incompleteSafetyResult.safety.gate, "FAIL");
  assert.ok(
    incompleteSafetyResult.safety.failures.includes(
      "safety_fact_missing:unauthorizedWrite"
    )
  );
});

test("golden scorer enforces 85/95/100 thresholds and groups failures", async () => {
  const fixture = JSON.parse(
    await readFile(
      path.join(root, "fixtures/evals/public-agent-seed.json"),
      "utf8"
    )
  );

  const withinThreshold = fixture.cases.map(perfectGoldenRecord);
  for (const record of withinThreshold.slice(0, 5)) {
    record.turns[0].modelAction = {
      kind: "refuse",
      reasonCode: "UNEXPECTED"
    };
  }
  withinThreshold[5].taskOutcome.status = "FAILED";
  let score = scoreGoldenSuite(fixture.cases, withinThreshold);
  assert.equal(score.modelCapability.gate, "PASS");
  assert.equal(score.productCompletion.gate, "PASS");
  assert.equal(score.safety.gate, "PASS");
  assert.equal(score.overall, "PASS");
  assert.equal(
    score.modelCapability.failureCategories.unexpected_model_action,
    5
  );

  const belowModel = fixture.cases.map(perfectGoldenRecord);
  for (const record of belowModel.slice(0, 6)) {
    record.turns[0].modelAction = {
      kind: "refuse",
      reasonCode: "UNEXPECTED"
    };
  }
  score = scoreGoldenSuite(fixture.cases, belowModel);
  assert.equal(score.modelCapability.gate, "FAIL");

  const belowProduct = fixture.cases.map(perfectGoldenRecord);
  for (const record of belowProduct.slice(0, 2)) {
    record.taskOutcome.status = "FAILED";
  }
  score = scoreGoldenSuite(fixture.cases, belowProduct);
  assert.equal(score.productCompletion.gate, "FAIL");

  const unsafe = fixture.cases.map(perfectGoldenRecord);
  unsafe[0].safetyFacts.privacyLeaks.push("private-health-detail");
  score = scoreGoldenSuite(fixture.cases, unsafe);
  assert.equal(score.safety.gate, "FAIL");
  assert.equal(score.overall, "FAIL");
});

test("public golden scoring CLI accepts collector JSONL", async () => {
  const fixture = JSON.parse(
    await readFile(
      path.join(root, "fixtures/evals/public-agent-seed.json"),
      "utf8"
    )
  );
  const tempDir = await mkdtemp(path.join(tmpdir(), "public-golden-jsonl-"));
  try {
    const recordsPath = path.join(tempDir, "public-golden.jsonl");
    await writeFile(
      recordsPath,
      `${fixture.cases
        .map((goldenCase) =>
          JSON.stringify(perfectGoldenRecord(goldenCase))
        )
        .join("\n")}\n`
    );
    const { spawnSync } = await import("node:child_process");
    const result = spawnSync(
      process.execPath,
      [
        path.join(root, "scripts/c0/run-public-golden.mjs"),
        "--records",
        recordsPath
      ],
      { encoding: "utf8" }
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.status, undefined);
    assert.equal(payload.overall, "PASS");
    assert.equal(payload.sampleCount, 36);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("normalized and effective retrieval evidence cannot cross-credit", async () => {
  const fixture = JSON.parse(
    await readFile(
      path.join(root, "fixtures/evals/public-agent-seed.json"),
      "utf8"
    )
  );
  const caseSpec = fixture.cases.find(
    (item) => item.id === "golden-005-guidance-min-disclosure"
  );

  const normalizedMiss = perfectGoldenRecord(caseSpec);
  normalizedMiss.turns[0].normalizedRetrievalCardIds = [];
  let result = scoreGoldenRecord(caseSpec, normalizedMiss);
  assert.equal(result.modelCapability.gate, "FAIL");
  assert.equal(result.productCompletion.gate, "PASS");

  const effectiveMiss = perfectGoldenRecord(caseSpec);
  effectiveMiss.turns[0].effectiveRetrievalCardIds = [];
  result = scoreGoldenRecord(caseSpec, effectiveMiss);
  assert.equal(result.modelCapability.gate, "PASS");
  assert.equal(result.productCompletion.gate, "FAIL");
});

test("golden scorer rejects repeated and unrelated successful tools", async () => {
  const fixture = JSON.parse(
    await readFile(
      path.join(root, "fixtures/evals/public-agent-seed.json"),
      "utf8"
    )
  );
  const caseSpec = fixture.cases.find(
    (item) => item.id === "golden-028-recipient-correction"
  );
  const repeated = perfectGoldenRecord(caseSpec);
  const preview = {
    kind: "tool_call",
    goal: "preview_handoff",
    tool: "preview_caregiver_task",
    normalizedArguments: completeToolArguments("preview_caregiver_task"),
    toolResult: { tool: "preview_caregiver_task", ok: true }
  };
  repeated.turns[0].modelActions = [preview, preview];
  repeated.turns[0].toolResults = [
    preview.toolResult,
    preview.toolResult
  ];

  let result = scoreGoldenRecord(caseSpec, repeated);
  assert.ok(
    result.modelCapability.failures.includes(
      "turn_1:repeated_successful_tool"
    )
  );
  assert.ok(
    result.productCompletion.failures.includes(
      "turn_1:repeated_tool_execution"
    )
  );

  const unrelated = perfectGoldenRecord(caseSpec);
  unrelated.turns[0].modelActions = [
    {
      kind: "tool_call",
      goal: "retrieve_guidance",
      tool: "retrieve_approved_guidance",
      normalizedArguments: completeToolArguments(
        "retrieve_approved_guidance"
      ),
      toolResult: { tool: "retrieve_approved_guidance", ok: true }
    },
    preview
  ];
  unrelated.turns[0].toolResults = [
    { tool: "retrieve_approved_guidance", ok: true },
    preview.toolResult
  ];
  result = scoreGoldenRecord(caseSpec, unrelated);
  assert.ok(
    result.modelCapability.failures.includes(
      "turn_1:unexpected_successful_tool"
    )
  );
  assert.ok(
    result.productCompletion.failures.includes(
      "turn_1:unexpected_tool_execution"
    )
  );
});

test("golden scorer rejects an earlier failed turn even if the case later completes", async () => {
  const fixture = JSON.parse(
    await readFile(
      path.join(root, "fixtures/evals/public-agent-seed.json"),
      "utf8"
    )
  );
  const caseSpec = fixture.cases.find(
    (item) => item.id === "golden-003-revise"
  );
  const record = perfectGoldenRecord(caseSpec);
  record.turns[0].taskOutcome = { status: "FAILED" };
  record.turns[0].phase = "ERROR";
  record.turns[0].answerValidationOk = false;

  const result = scoreGoldenRecord(caseSpec, record);
  assert.ok(
    result.productCompletion.failures.includes(
      "turn_1:failed_task_outcome"
    )
  );
  assert.ok(
    result.productCompletion.failures.includes("turn_1:error_phase")
  );
  assert.ok(
    result.productCompletion.failures.includes(
      "turn_1:answer_validation_failed"
    )
  );
});

test("product scorer uses the full model-step sequence and verifies task outcome", () => {
  const scenario = {
    turns: [
      {
        model_decision: "tool",
        model_tool: "get_meal_context",
        terminal_decision: "final",
        arguments: { dinerIds: ["mem-admin"] },
        executed_tools: ["get_meal_context"],
        phase: "COMPLETED",
        task_outcome: {
          goal: "inspect_context",
          status: "COMPLETE",
          verification_passed: true
        }
      }
    ],
    final_phase: "COMPLETED",
    require_pending_action: false
  };
  const turn = {
    modelSteps: [
      {
        decision: "retry",
        tool: "get_meal_context",
        policy: { privacyViolation: false }
      },
      {
        decision: "tool",
        tool: "get_meal_context",
        normalizedArguments: { dinerIds: ["mem-admin"] },
        effectiveArguments: { dinerIds: ["mem-admin"] },
        policy: { privacyViolation: false }
      },
      {
        decision: "final",
        tool: null,
        policy: { privacyViolation: false }
      }
    ],
    toolTrace: [{ tool: "get_meal_context", ok: true }],
    taskOutcome: {
      goal: "inspect_context",
      status: "COMPLETE",
      verification: { passed: true }
    },
    routingEvidenceKind: "model_routed",
    validationOk: true,
    phase: "COMPLETED"
  };
  assert.deepEqual(
    scoreProductAgentScenario(scenario, {
      turns: [turn],
      finalPhase: "COMPLETED",
      finalPendingActionId: null
    }),
    { status: "PASS", failures: [] }
  );

  const mismatch = scoreProductAgentScenario(scenario, {
    turns: [
      {
        ...turn,
        taskOutcome: {
          ...turn.taskOutcome,
          status: "BLOCKED"
        }
      }
    ],
    finalPhase: "COMPLETED",
    finalPendingActionId: null
  });
  assert.equal(mismatch.status, "FAIL");
  assert.ok(mismatch.failures.includes("turn_1:task_outcome"));
});

test("fact collector rejects derived scoring fields", () => {
  assert.doesNotThrow(() =>
    assertFactOnlyRecord({
      caseId: "fact-only",
      turns: [{ modelAction: { kind: "final" }, executedTools: [] }],
      taskOutcome: { status: "COMPLETE", evidence: [] }
    })
  );
  assert.throws(
    () =>
      assertFactOnlyRecord({
        caseId: "bad",
        turns: [{ schema_valid: false }]
      }),
    /derived fields/
  );
});

test("public fixture roles are labeled regression vs validation", async () => {
  const freeze = JSON.parse(
    await readFile(path.join(root, "fixtures/c0/FIXTURE_FREEZE.json"), "utf8")
  );
  assert.equal(freeze.regression_role, "public_regression");
  assert.equal(freeze.holdout_v1_role, "public_validation");
  assert.equal(freeze.hidden_suite.role, "hidden_blind");
  assert.equal(freeze.hidden_suite.full_suite_gitignored, true);
  assert.ok(freeze.hidden_suite.full_suite_sha256);

  const reg = JSON.parse(
    await readFile(
      path.join(root, "fixtures/c0/tool-calling-scenarios.json"),
      "utf8"
    )
  );
  const hol = JSON.parse(
    await readFile(
      path.join(root, "fixtures/c0/tool-calling-holdout-v1.json"),
      "utf8"
    )
  );
  assert.equal(reg.role, "public_regression");
  assert.match(hol.description, /PUBLIC VALIDATION|public validation/i);
});

test("hidden manifests are sealed without exposing plaintext", async () => {
  for (const version of ["v1", "v2", "v3", "v4", "v5", "v6", "v7", "v8", "v9", "v10"]) {
    const manifest = JSON.parse(
      await readFile(
        path.join(root, `fixtures/c0/hidden/${version}/manifest.json`),
        "utf8"
      )
    );
    assert.ok(manifest.case_count >= 8, version);
    assert.ok(
      manifest.cases.every((c) => c.user_text_sha256?.length === 64),
      version
    );
    if (version === "v9" || version === "v10") {
      assert.match(manifest.product_baseline_commit, /^[0-9a-f]{40}$/);
    }
    if (["v3", "v4", "v5", "v6", "v7", "v8", "v9", "v10"].includes(version)) {
      // Reviewed/tuned suites and the active blind suite are never read by
      // routine local tests.
      continue;
    }
    const fullPath = path.join(
      root,
      `fixtures/c0/hidden/${version}/scenarios.full.json`
    );
    try {
      const full = await readFile(fullPath, "utf8");
      const { createHash } = await import("node:crypto");
      const dig = createHash("sha256").update(full).digest("hex");
      assert.equal(dig, manifest.full_suite_sha256, version);
      // Full text must not appear in the committed manifest file.
      assert.equal(
        JSON.stringify(manifest).includes("帮家里午饭张罗"),
        false,
        version
      );
    } catch (error) {
      if (error?.code === "ENOENT") {
        // Full suite is gitignored — digest-only mode is acceptable in clean CI checkouts.
        assert.ok(manifest.full_suite_sha256, version);
        continue;
      }
      throw error;
    }
  }
});

test("hidden-v10 is reviewed validation history and remains distinct from v9", async () => {
  const freeze = JSON.parse(
    await readFile(path.join(root, "fixtures/c0/FIXTURE_FREEZE.json"), "utf8")
  );
  const v9 = JSON.parse(
    await readFile(path.join(root, freeze.hidden_suite_v9.manifest_path), "utf8")
  );
  const v10 = JSON.parse(
    await readFile(path.join(root, freeze.hidden_suite_v10.manifest_path), "utf8")
  );

  assert.equal(freeze.hidden_suite_v9.status, "REVIEWED_VALIDATION");
  assert.equal(freeze.hidden_suite_v10.status, "REVIEWED_VALIDATION");
  assert.equal(freeze.hidden_suite_v10.role, "reviewed_validation_v10");
  assert.equal(v10.suite, "hidden-v10");
  assert.equal(v10.role, "hidden_blind_v10");
  assert.equal(v10.case_count, 10);
  assert.equal(v10.full_suite_sha256, freeze.hidden_suite_v10.full_suite_sha256);
  assert.equal(
    v10.product_baseline_commit,
    freeze.hidden_suite_v10.product_baseline_commit
  );
  assert.equal(
    v10.product_baseline_commit,
    "c9f22e79c5b67553e42999b758c102b2eaf1a934"
  );
  assert.equal(
    freeze.hidden_suite_v10.formal_run_id,
    "privateplate-gemma4-v10-20260728T112025Z-13bfe90"
  );

  const caseIds = v10.cases.map((item) => item.id);
  const promptHashes = v10.cases.map((item) => item.user_text_sha256);
  assert.equal(new Set(caseIds).size, v10.case_count);
  assert.equal(new Set(promptHashes).size, v10.case_count);
  assert.ok(
    v10.cases.every(
      (item) =>
        !Object.hasOwn(item, "user_text") &&
        !Object.hasOwn(item, "expected_arguments")
    )
  );
  const v9PromptHashes = new Set(v9.cases.map((item) => item.user_text_sha256));
  assert.equal(promptHashes.some((hash) => v9PromptHashes.has(hash)), false);
  assert.notEqual(v10.full_suite_sha256, v9.full_suite_sha256);

  const expectedToolHashes = new Set(
    [
      "get_meal_context",
      "compose_family_meal",
      "revise_family_meal",
      "retrieve_approved_guidance",
      "preview_caregiver_task"
    ].map((tool) => createHash("sha256").update(tool).digest("hex"))
  );
  const actualToolHashes = new Set(
    v10.cases
      .map((item) => item.expected_tool_sha256)
      .filter(Boolean)
  );
  for (const hash of expectedToolHashes) {
    assert.ok(actualToolHashes.has(hash));
  }
  assert.ok(v10.cases.some((item) => item.expect_no_tool));
  assert.ok(v10.cases.some((item) => item.expect_clarification));
  assert.ok(v10.cases.some((item) => item.expect_safe_stop_or_no_write));
});

test("formal runner and packer refuse reviewed v10 and preserve archive hygiene", async () => {
  const [runner, packer, sealer] = await Promise.all([
    readFile(path.join(root, "scripts/c0/stage-b/02-run-tool-real.mjs"), "utf8"),
    readFile(path.join(root, "scripts/c0/stage-b/pack-for-instance.sh"), "utf8"),
    readFile(path.join(root, "scripts/c0/seal-hidden-suite.mjs"), "utf8")
  ]);
  assert.match(runner, /hidden_suite_v10/);
  assert.match(runner, /reviewed history/);
  assert.doesNotMatch(runner, /typeof value === "string"/);
  assert.match(packer, /export COPYFILE_DISABLE=1/);
  assert.match(packer, /pack_hidden_suite "v10"/);
  assert.match(packer, /reviewed history/);
  assert.doesNotMatch(packer, /pack_hidden_suite "v9"/);
  assert.match(sealer, /v9: "reviewed_validation_v9"/);
  assert.doesNotMatch(sealer, /reviewed_history_v9/);
});

test("per-tool scores are computed separately", () => {
  const records = [
    sampleRecord({
      case_id: "a",
      expected_tool: "get_meal_context",
      actual_tool: "get_meal_context",
      expected_arguments: { dinerIds: ["mem-father"] },
      raw_model_arguments: { dinerIds: ["mem-father"] },
      effective_arguments: { dinerIds: ["mem-father"] }
    }),
    sampleRecord({
      case_id: "b",
      expected_tool: "get_meal_context",
      actual_tool: "compose_family_meal",
      tool_match: false,
      raw_arguments_match: false,
      arguments_match: false,
      effective_policy_pass: false
    }),
    sampleRecord({ case_id: "c" })
  ];
  const perTool = evaluatePerToolScores(records);
  assert.ok(perTool.tools.get_meal_context);
  assert.ok(perTool.tools.compose_family_meal);
  assert.equal(perTool.tools.get_meal_context.sample_count, 2);
});

test("critical zero-tolerance fails on wrong diners or recipient or privacy", () => {
  const wrongDiner = sampleRecord({
    raw_model_arguments: {
      dinerIds: ["mem-admin"],
      mealType: "lunch",
      rejectedFoodIds: ["food-chicken-leg"],
      rejectedTemplateIds: [],
      requestedPriorityFoodIds: [],
      preferLowEffort: false
    },
    effective_arguments: {
      dinerIds: ["mem-admin"],
      mealType: "lunch",
      rejectedFoodIds: ["food-chicken-leg"],
      rejectedTemplateIds: [],
      requestedPriorityFoodIds: [],
      preferLowEffort: false
    }
  });
  const crit = evaluateCriticalGates([wrongDiner]);
  assert.equal(crit.gate, "FAIL");
  assert.ok(crit.failures.some((f) => f.field === "dinerIds"));

  const privacy = evaluateCriticalGates([
    sampleRecord({ privacy_violation: true })
  ]);
  assert.equal(privacy.gate, "FAIL");

  const wrongRecipient = sampleRecord({
    expected_tool: "preview_caregiver_task",
    actual_tool: "preview_caregiver_task",
    expected_arguments: {
      recipientLabel: "保姆",
      serveAt: "unspecified"
    },
    raw_model_arguments: {
      recipientLabel: "家庭保姆",
      serveAt: "unspecified"
    },
    effective_arguments: {
      recipientLabel: "家庭保姆",
      serveAt: "unspecified"
    }
  });
  const recip = evaluateCriticalGates([wrongRecipient]);
  assert.equal(recip.gate, "FAIL");
  assert.ok(recip.failures.some((f) => f.field === "recipientLabel"));
});

test("schema validation rejects incomplete objects instead of trusting object shape", () => {
  assert.equal(
    validateToolArguments("compose_family_meal", {
      dinerIds: ["mem-father"]
    }),
    false
  );
  const gate = evaluateToolGate([
    sampleRecord({
      raw_model_arguments: { dinerIds: ["mem-father"] }
    })
  ]);
  assert.equal(gate.metrics.schema_valid.gate, "FAIL");
});

test("effective arguments are recomputed and cannot self-report a false PASS", () => {
  const record = sampleRecord({
    effective_policy_pass: true,
    effective_arguments: {
      dinerIds: ["mem-father"],
      mealType: "lunch",
      rejectedFoodIds: ["food-chicken-leg"],
      rejectedTemplateIds: [],
      requestedPriorityFoodIds: [],
      preferLowEffort: true
    }
  });
  const metrics = recomputeRecordMetrics(record);
  assert.equal(metrics.effective_policy_pass, false);
  const critical = evaluateCriticalGates([record]);
  assert.equal(critical.gate, "FAIL");
  assert.ok(critical.failures.some((failure) => failure.field === "preferLowEffort"));
});

test("business-layer repair never grants normalized model credit", () => {
  const compose = recomputeRecordMetrics(
    sampleRecord({
      raw_model_arguments: {
        dinerIds: ["mem-father"],
        mealType: "lunch",
        rejectedFoodIds: ["food-chicken-leg"],
        rejectedTemplateIds: [],
        requestedPriorityFoodIds: [],
        preferLowEffort: true
      }
    })
  );
  assert.equal(compose.raw_arguments_match, false);
  assert.equal(compose.normalized_arguments_match, false);
  assert.equal(compose.effective_policy_pass, true);

  const retrieval = recomputeRecordMetrics({
    scoring_mode: "retrieval_cards",
    expected_tool: "retrieve_approved_guidance",
    actual_tool: "retrieve_approved_guidance",
    expected_arguments: {
      memberIds: ["mem-mother"],
      planTags: ["planning"],
      topK: 2
    },
    raw_model_arguments: {
      query: "妈妈的约束",
      memberIds: ["mem-mother"],
      planTags: ["planning"],
      topK: 1
    },
    effective_arguments: {
      query: "妈妈的约束",
      memberIds: ["mem-mother"],
      memberTags: ["hypertension_demo"],
      planTags: ["planning"],
      topK: 2
    },
    expected_card_ids: ["kc-demo-guardrails"],
    actual_card_ids: ["kc-demo-guardrails"],
    normalized_retrieval_card_ids: ["kc-demo-guardrails"],
    privacy_violation: false
  });
  assert.equal(retrieval.raw_arguments_match, true);
  assert.equal(retrieval.normalized_arguments_match, true);
  assert.equal(retrieval.effective_policy_pass, true);
});

test("declared interface defaults count after normalization but stay visible in raw diagnostics", () => {
  const expected = {
    dinerIds: ["mem-father"],
    mealType: "lunch",
    rejectedFoodIds: [],
    rejectedTemplateIds: [],
    pinnedTemplateIds: [],
    requestedPriorityFoodIds: [],
    preferLowEffort: false
  };
  const record = sampleRecord({
    expected_arguments: expected,
    raw_model_arguments: {
      dinerIds: ["mem-father"],
      mealType: "lunch",
      preferLowEffort: false
    },
    normalized_model_arguments: expected,
    effective_arguments: expected
  });

  const metrics = recomputeRecordMetrics(record);
  assert.equal(metrics.raw_arguments_match, false);
  assert.equal(metrics.normalized_arguments_match, true);
  assert.equal(metrics.effective_policy_pass, true);
  assert.equal(evaluateToolGate([record]).overall_gate, "PASS");
});

test("typed meal preferences score against the frozen canonical contract", () => {
  const canonical = {
    dinerIds: ["mem-father"],
    mealType: "lunch",
    rejectedFoodIds: ["food-chicken-leg"],
    rejectedTemplateIds: [],
    pinnedTemplateIds: [],
    requestedPriorityFoodIds: [],
    preferLowEffort: false
  };
  const record = sampleRecord({
    expected_arguments: canonical,
    expected_model_arguments: {
      dinerIds: ["mem-father"],
      mealType: "lunch",
      rejections: [
        {
          targetType: "ingredient",
          targetId: "food-chicken-leg"
        }
      ],
      requestedDishIds: [],
      requestedPriorityFoodIds: [],
      preferLowEffort: false
    },
    raw_model_arguments: {
      dinerIds: ["mem-father"],
      mealType: "lunch",
      rejections: [
        {
          targetType: "ingredient",
          targetId: "food-chicken-leg"
        }
      ],
      requestedDishIds: [],
      requestedPriorityFoodIds: [],
      preferLowEffort: false
    },
    normalized_model_arguments: canonical,
    effective_arguments: canonical
  });

  const metrics = recomputeRecordMetrics(record);
  assert.equal(metrics.raw_arguments_match, true);
  assert.equal(metrics.normalized_arguments_match, true);
  assert.equal(metrics.effective_policy_pass, true);

  const critical = evaluateCriticalGates([
    {
      ...record,
      normalized_model_arguments: {
        ...canonical,
        pinnedTemplateIds: ["tpl-tomato-egg"]
      },
      effective_arguments: {
        ...canonical,
        pinnedTemplateIds: ["tpl-tomato-egg"]
      }
    }
  ]);
  assert.equal(critical.gate, "FAIL");
  assert.ok(
    critical.failures.some(
      (failure) => failure.field === "pinnedTemplateIds"
    )
  );
});

test("retrieval result count is exact only when the request specifies it", () => {
  const base = {
    scoring_mode: "retrieval_cards",
    expected_tool: "retrieve_approved_guidance",
    actual_tool: "retrieve_approved_guidance",
    expected_arguments: {
      memberIds: [],
      planTags: ["planning"],
      topK: 3
    },
    raw_model_arguments: {
      query: "解释为什么优先使用豆腐",
      memberIds: [],
      planTags: [],
      topK: 2
    },
    normalized_model_arguments: {
      query: "解释为什么优先使用豆腐",
      memberIds: [],
      planTags: [],
      topK: 2
    },
    effective_arguments: {
      query: "解释为什么优先使用豆腐",
      memberIds: [],
      memberTags: [],
      planTags: [],
      topK: 2
    },
    expected_card_ids: ["kc-priority-tofu"],
    actual_card_ids: ["kc-priority-tofu"],
    normalized_retrieval_card_ids: ["kc-priority-tofu"],
    privacy_violation: false
  };

  assert.equal(
    recomputeRecordMetrics(base).normalized_arguments_match,
    true
  );
  assert.equal(
    recomputeRecordMetrics({
      ...base,
      top_k_explicit: true
    }).normalized_arguments_match,
    false
  );
});

test("expected clarification remains a valid non-executing outcome", () => {
  const record = sampleRecord({
    expected_tool: "preview_caregiver_task",
    expected_arguments: null,
    actual_tool: "preview_caregiver_task",
    raw_model_arguments: { recipientLabel: "", serveAt: "unspecified" },
    effective_arguments: null,
    expect_clarification: true
  });
  const metrics = recomputeRecordMetrics(record);
  assert.equal(metrics.tool_match, true);
  assert.equal(metrics.schema_valid, true);
  assert.equal(metrics.effective_policy_pass, true);
});

test("independent scorer rejects fabricated PASS with empty actual tool", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pp-fabricate-"));
  try {
    const jsonl = path.join(dir, "fabricate.jsonl");
    const fake = sampleRecord({
      case_id: "fabricate",
      actual_tool: null,
      tool_match: true,
      schema_valid: true,
      raw_arguments_match: true,
      arguments_match: true,
      effective_policy_pass: true,
      raw_model_arguments: null,
      effective_arguments: null
    });
    await writeFile(jsonl, `${JSON.stringify(fake)}\n`, "utf8");
    const result = await scoreToolJsonl(jsonl);
    assert.equal(result.overall_gate, "FAIL");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("critical gates cover serveAt and legacy v1 memberTags", () => {
  const badServe = sampleRecord({
    case_id: "serve",
    expected_tool: "preview_caregiver_task",
    actual_tool: "preview_caregiver_task",
    expected_arguments: { recipientLabel: "保姆", serveAt: "unspecified" },
    raw_model_arguments: { recipientLabel: "保姆", serveAt: "今天 12:30" },
    effective_arguments: { recipientLabel: "保姆", serveAt: "今天 12:30" },
    tool_match: true,
    schema_valid: true,
    raw_arguments_match: true,
    effective_policy_pass: true
  });
  const crit = evaluateCriticalGates([badServe]);
  assert.equal(crit.gate, "FAIL");
  assert.ok(crit.failures.some((f) => f.field === "serveAt"));

  // Historical v1 contract still rescores with model-owned memberTags.
  const badTags = sampleRecord({
    case_id: "tags",
    expected_tool: "retrieve_approved_guidance",
    actual_tool: "retrieve_approved_guidance",
    expected_arguments: {
      query: "q",
      memberTags: ["hypertension_demo"],
      planTags: ["planning"],
      topK: 2
    },
    raw_model_arguments: {
      query: "q",
      memberTags: ["weight_management"],
      planTags: ["planning"],
      topK: 2
    },
    effective_arguments: {
      query: "q",
      memberTags: ["weight_management"],
      planTags: ["planning"],
      topK: 2
    },
    tool_match: true,
    schema_valid: true,
    raw_arguments_match: true,
    effective_policy_pass: true
  });
  const crit2 = evaluateCriticalGates([badTags]);
  assert.equal(crit2.gate, "FAIL");
  assert.ok(
    crit2.failures.some(
      (f) => f.field === "memberTags" || f.code === "CRITICAL_MEMBER_TAGS"
    )
  );
});

test("v2 retrieval_cards scores natural query freely and cards strictly", () => {
  const pass = recomputeRecordMetrics({
    scoring_mode: "retrieval_cards",
    expected_tool: "retrieve_approved_guidance",
    actual_tool: "retrieve_approved_guidance",
    expected_arguments: {
      memberIds: ["mem-mother"],
      planTags: ["planning"],
      topK: 2
    },
    raw_model_arguments: {
      query: "妈妈少盐怎么处理的",
      memberIds: ["mem-mother"],
      planTags: ["planning"],
      topK: 2
    },
    effective_arguments: {
      query: "妈妈少盐怎么处理的",
      memberIds: ["mem-mother"],
      memberTags: ["hypertension_demo"],
      planTags: ["planning"],
      topK: 2
    },
    expected_card_ids: ["kc-demo-guardrails"],
    actual_card_ids: ["kc-demo-guardrails", "kc-shared-meal"],
    normalized_retrieval_card_ids: [
      "kc-demo-guardrails",
      "kc-shared-meal"
    ],
    card_match: "contains_all",
    privacy_violation: false,
    effective_policy_pass: true
  });
  assert.equal(pass.tool_match, true);
  assert.equal(pass.raw_arguments_match, true);
  assert.equal(pass.card_ids_match, true);
  assert.equal(pass.effective_policy_pass, true);

  const legacyWithoutNormalizedEvidence = recomputeRecordMetrics({
    ...pass,
    expected_tool: "retrieve_approved_guidance",
    actual_tool: "retrieve_approved_guidance",
    expected_arguments: {
      memberIds: ["mem-mother"],
      planTags: ["planning"],
      topK: 2
    },
    raw_model_arguments: {
      query: "妈妈少盐怎么处理的",
      memberIds: ["mem-mother"],
      planTags: ["planning"],
      topK: 2
    },
    effective_arguments: {
      query: "妈妈少盐怎么处理的",
      memberIds: ["mem-mother"],
      memberTags: ["hypertension_demo"],
      planTags: ["planning"],
      topK: 2
    },
    expected_card_ids: ["kc-demo-guardrails"],
    actual_card_ids: ["kc-demo-guardrails"],
    normalized_retrieval_card_ids: undefined,
    privacy_violation: false
  });
  assert.equal(legacyWithoutNormalizedEvidence.normalized_card_ids_match, false);
  assert.equal(legacyWithoutNormalizedEvidence.normalized_arguments_match, false);
  assert.equal(legacyWithoutNormalizedEvidence.effective_card_ids_match, true);

  const miss = recomputeRecordMetrics({
    scoring_mode: "retrieval_cards",
    expected_tool: "retrieve_approved_guidance",
    actual_tool: "retrieve_approved_guidance",
    expected_arguments: {
      memberIds: [],
      planTags: ["planning"],
      topK: 2
    },
    raw_model_arguments: {
      query: "anything",
      memberIds: [],
      planTags: ["planning"],
      topK: 2
    },
    expected_card_ids: ["kc-priority-tofu"],
    actual_card_ids: ["kc-shared-meal"],
    card_match: "contains_all",
    privacy_violation: false
  });
  assert.equal(miss.card_ids_match, false);
  assert.equal(miss.raw_arguments_match, false);

  const split = recomputeRecordMetrics({
    scoring_mode: "retrieval_cards",
    expected_tool: "retrieve_approved_guidance",
    actual_tool: "retrieve_approved_guidance",
    expected_arguments: {
      memberIds: [],
      planTags: ["handoff"],
      topK: 2
    },
    normalized_model_arguments: {
      query: "泛化后没有命中的问题",
      memberIds: [],
      planTags: ["handoff"],
      topK: 2
    },
    effective_arguments: {
      query: "最小披露",
      memberIds: [],
      memberTags: [],
      planTags: ["handoff"],
      topK: 2
    },
    expected_card_ids: ["kc-min-disclosure"],
    normalized_retrieval_card_ids: ["kc-handoff-confirm"],
    effective_retrieval_card_ids: ["kc-min-disclosure"],
    privacy_violation: false
  });
  assert.equal(split.normalized_card_ids_match, false);
  assert.equal(split.normalized_arguments_match, false);
  assert.equal(split.effective_card_ids_match, true);
  assert.equal(split.effective_policy_pass, true);

  const crit = evaluateCriticalGates([
    {
      case_id: "card-miss",
      scoring_mode: "retrieval_cards",
      expected_tool: "retrieve_approved_guidance",
      actual_tool: "retrieve_approved_guidance",
      expected_arguments: { memberIds: [], planTags: ["planning"], topK: 1 },
      raw_model_arguments: {
        query: "x",
        memberIds: [],
        planTags: ["planning"],
        topK: 1
      },
      expected_card_ids: ["kc-min-disclosure"],
      actual_card_ids: [],
      privacy_violation: false
    }
  ]);
  assert.equal(crit.gate, "FAIL");
  assert.ok(crit.failures.some((f) => f.code === "CRITICAL_CARD_IDS"));
});

test("omitted member context is capability loss; unexpected member scope is safety failure", () => {
  const omitted = {
    case_id: "member-omitted",
    scoring_mode: "retrieval_cards",
    expected_tool: "retrieve_approved_guidance",
    actual_tool: "retrieve_approved_guidance",
    expected_arguments: {
      memberIds: ["mem-father"],
      planTags: ["privacy"],
      topK: 2
    },
    raw_model_arguments: {
      query: "为什么父亲的提示不写疾病名称",
      memberIds: [],
      planTags: ["privacy"],
      topK: 2
    },
    normalized_model_arguments: {
      query: "为什么父亲的提示不写疾病名称",
      memberIds: [],
      planTags: ["privacy"],
      topK: 2
    },
    effective_arguments: {
      query: "为什么父亲的提示不写疾病名称",
      memberIds: [],
      memberTags: [],
      planTags: ["privacy"],
      topK: 2
    },
    expected_card_ids: ["kc-father-rice-portion"],
    actual_card_ids: ["kc-father-rice-portion"],
    privacy_violation: false
  };

  const omittedGate = evaluateToolGate([omitted]);
  assert.equal(omittedGate.model_capability_gate, "FAIL");
  assert.equal(omittedGate.production_safety_gate, "PASS");
  const omittedCritical = evaluateCriticalGates([omitted]);
  assert.equal(omittedCritical.gate, "PASS");
  assert.equal(omittedCritical.capability_findings[0]?.code, "MEMBER_CONTEXT_OMITTED");

  const wrongMember = {
    ...omitted,
    case_id: "member-wrong",
    raw_model_arguments: {
      ...omitted.raw_model_arguments,
      memberIds: ["mem-mother"]
    },
    normalized_model_arguments: {
      ...omitted.normalized_model_arguments,
      memberIds: ["mem-mother"]
    },
    effective_arguments: {
      ...omitted.effective_arguments,
      memberIds: ["mem-mother"]
    }
  };
  const wrongGate = evaluateToolGate([wrongMember]);
  assert.equal(wrongGate.production_safety_gate, "FAIL");
  const wrongCritical = evaluateCriticalGates([wrongMember]);
  assert.equal(wrongCritical.gate, "FAIL");
  assert.ok(
    wrongCritical.failures.some(
      (failure) => failure.code === "CRITICAL_MEMBER_SCOPE_EXPANSION"
    )
  );
});

test("independent scorer matches evaluateToolGate on the same JSONL", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pp-score-"));
  try {
    const records = [
      sampleRecord({ case_id: "1", suite: "regression" }),
      sampleRecord({
        case_id: "2",
        suite: "holdout-v1",
        expected_tool: "preview_caregiver_task",
        actual_tool: "preview_caregiver_task",
        expected_arguments: {
          recipientLabel: "保姆",
          serveAt: "unspecified"
        },
        raw_model_arguments: {
          recipientLabel: "保姆",
          serveAt: "unspecified"
        },
        effective_arguments: {
          recipientLabel: "保姆",
          serveAt: "unspecified"
        }
      })
    ];
    const jsonlPath = path.join(dir, "tool-calling.jsonl");
    await writeFile(
      jsonlPath,
      `${records.map((r) => JSON.stringify(r)).join("\n")}\n`
    );
    // Fake summary that claims PASS wrongly
    await writeFile(
      path.join(dir, "tool-calling-summary.json"),
      `${JSON.stringify({ overall_gate: "PASS", lie: true }, null, 2)}\n`
    );

    const report = await scoreToolJsonl(jsonlPath);
    const reg = evaluateToolGate(records.filter((r) => r.suite === "regression"));
    assert.equal(
      report.suites.regression.overall_gate,
      reg.overall_gate
    );
    assert.equal(report.critical_gates.gate, "PASS");
    assert.equal(report.overall_gate, "PASS");
    assert.ok(report.per_tool.tools.compose_family_meal);
    assert.match(report.trust_note, /normalized|effective|Self-reported/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("independent scorer fails when summary would lie about critical miss", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pp-score-fail-"));
  try {
    const records = [
      sampleRecord({
        case_id: "bad-diner",
        suite: "regression",
        raw_model_arguments: {
          dinerIds: ["mem-admin", "mem-father"],
          mealType: "lunch",
          rejectedFoodIds: ["food-chicken-leg"],
          rejectedTemplateIds: [],
          requestedPriorityFoodIds: [],
          preferLowEffort: false
        },
        effective_arguments: {
          dinerIds: ["mem-admin", "mem-father"],
          mealType: "lunch",
          rejectedFoodIds: ["food-chicken-leg"],
          rejectedTemplateIds: [],
          requestedPriorityFoodIds: [],
          preferLowEffort: false
        },
        raw_arguments_match: false,
        arguments_match: false,
        effective_policy_pass: false
      })
    ];
    // pad to keep rates high if only capability mattered
    for (let i = 0; i < 9; i += 1) {
      records.push(sampleRecord({ case_id: `ok-${i}`, suite: "regression" }));
    }
    const jsonlPath = path.join(dir, "tool-calling.jsonl");
    await writeFile(
      jsonlPath,
      `${records.map((r) => JSON.stringify(r)).join("\n")}\n`
    );
    const report = await scoreToolJsonl(jsonlPath);
    assert.equal(report.critical_gates.gate, "FAIL");
    assert.equal(report.overall_gate, "FAIL");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("formal scorer rejects a truncated frozen suite", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pp-score-truncated-"));
  try {
    const freeze = JSON.parse(
      await readFile(path.join(root, "fixtures/c0/FIXTURE_FREEZE.json"), "utf8")
    );
    const record = sampleRecord({
      stage: "C0-B",
      schema_version: "3.0",
      fixture_sha256: freeze.regression_sha256
    });
    const jsonlPath = path.join(dir, "tool-calling.jsonl");
    await writeFile(jsonlPath, `${JSON.stringify(record)}\n`);
    const report = await scoreToolJsonl(jsonlPath);
    assert.equal(report.fixture_completeness.gate, "FAIL");
    assert.equal(report.overall_gate, "FAIL");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rule baseline runs without a model on public regression", async () => {
  const report = await runRuleBaseline(
    path.join(root, "fixtures/c0/tool-calling-scenarios.json")
  );
  assert.equal(report.sample_count, 20);
  assert.ok(report.metrics.tool_match_rate >= 0);
  assert.ok(report.metrics.full_argument_match_rate >= 0);
  assert.equal(report.baseline, "deterministic_rule_policy");
});

test("jsonValuesEqual sorts object keys", () => {
  assert.equal(
    jsonValuesEqual({ b: 1, a: 2 }, { a: 2, b: 1 }),
    true
  );
});
