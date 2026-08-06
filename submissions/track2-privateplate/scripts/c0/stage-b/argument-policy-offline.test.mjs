/**
 * Offline trusted-policy + privacy + fixture freeze tests (no Radeon / no model).
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const require = createRequire(import.meta.url);

// Load compiled JS after build; fall back to dynamic import path used by package tests.
async function loadPolicy() {
  const modPath = path.join(
    root,
    "packages/agent-runtime/dist/model/argument-policy.js"
  );
  const privacyPath = path.join(
    root,
    "packages/agent-runtime/dist/model/privacy-context.js"
  );
  return {
    ...(await import(pathToFileUrl(modPath))),
    ...(await import(pathToFileUrl(privacyPath)))
  };
}

function pathToFileUrl(filePath) {
  return pathToFileURLCompat(filePath);
}

function pathToFileURLCompat(filePath) {
  const { pathToFileURL } = require("node:url");
  return pathToFileURL(filePath).href;
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function toDictionary(fixtureIdMap) {
  return {
    members: Object.entries(fixtureIdMap.members ?? {}).map(([id, member]) => ({
      id,
      displayName: member.aliases?.[0] ?? member.display_name,
      roleLabel: inferRole(id, member),
      healthTags: member.health_tags ?? [],
      aliases: member.aliases ?? []
    })),
    foods: Object.entries(fixtureIdMap.foods ?? {}).map(([id, name]) => ({
      id,
      name,
      aliases: []
    })),
    templates: Object.entries(fixtureIdMap.meal_templates ?? {}).map(
      ([id, name]) => ({ id, name })
    ),
    planTags: Object.entries(fixtureIdMap.guidance_plan_tags ?? {}).map(
      ([id, label]) => ({ id, label })
    ),
    caregiverRecipientLabels: Object.keys(
      fixtureIdMap.caregiver_recipients ?? {}
    )
  };
}

function inferRole(id, member) {
  if (/father|父|爸/.test(`${id}${member.display_name}`)) return "father";
  if (/mother|母|妈/.test(`${id}${member.display_name}`)) return "mother";
  if (/admin|管理/.test(`${id}${member.display_name}`)) return "admin";
  return "member";
}

function policyState(scenario, dictionary) {
  return {
    dinerIds:
      scenario.current_state?.dinerIds ??
      dictionary.members.map((member) => member.id),
    activePlanId: scenario.current_state?.activePlanId ?? null,
    activePlanVersion: scenario.current_state?.activePlanVersion ?? null,
    activePlanTemplateIds: dictionary.templates.map((template) => template.id),
    expectedRecipientLabel:
      scenario.expected_tool === "preview_caregiver_task"
        ? scenario.expected_arguments?.recipientLabel ?? null
        : null
  };
}

test("frozen regression and holdout fixture digests match FIXTURE_FREEZE", async () => {
  const freeze = JSON.parse(
    await readFile(path.join(root, "fixtures/c0/FIXTURE_FREEZE.json"), "utf8")
  );
  const regression = await readFile(
    path.join(root, freeze.regression_path),
    "utf8"
  );
  const holdout = await readFile(path.join(root, freeze.holdout_v1_path), "utf8");
  assert.equal(sha256(regression), freeze.regression_sha256);
  assert.equal(sha256(holdout), freeze.holdout_v1_sha256);
  assert.equal(JSON.parse(regression).scenarios.length, 20);
  assert.equal(JSON.parse(holdout).scenarios.length, freeze.holdout_v1_case_count);
  assert.equal(freeze.holdout_v1_role, "public_validation");
  assert.equal(freeze.regression_role, "public_regression");
  assert.ok(
    freeze.hidden_suite?.status === "SEALED" ||
      freeze.hidden_suite?.status === "NOT_IN_REPO"
  );
  assert.match(
    JSON.parse(holdout).description,
    /PUBLIC VALIDATION|public validation|非隐藏|NOT a hidden/i
  );
  // v2 suites registered without disturbing v1 digests
  assert.ok(freeze.v2_regression_sha256);
  assert.ok(freeze.v2_holdout_sha256);
  assert.equal(freeze.hidden_suite_v2?.status, "LOCKED_VALIDATION");
  assert.equal(freeze.hidden_suite_v3?.status, "TUNED_VALIDATION");
  assert.equal(freeze.hidden_suite_v4?.status, "REVIEWED_VALIDATION");
  assert.equal(freeze.hidden_suite_v5?.status, "REVIEWED_VALIDATION");
  assert.equal(freeze.hidden_suite_v6?.status, "REVIEWED_VALIDATION");
  assert.equal(freeze.hidden_suite_v7?.status, "REVIEWED_VALIDATION");
  assert.equal(freeze.hidden_suite_v8?.status, "REVIEWED_VALIDATION");
  assert.equal(freeze.hidden_suite_v9?.status, "REVIEWED_VALIDATION");
  assert.equal(freeze.hidden_suite_v10?.status, "REVIEWED_VALIDATION");
  assert.equal(freeze.hidden_suite_v10?.role, "reviewed_validation_v10");
  const v2reg = await readFile(path.join(root, freeze.v2_regression_path), "utf8");
  const v2hold = await readFile(path.join(root, freeze.v2_holdout_path), "utf8");
  const v9Manifest = JSON.parse(
    await readFile(path.join(root, freeze.hidden_suite_v9.manifest_path), "utf8")
  );
  const v10Manifest = JSON.parse(
    await readFile(path.join(root, freeze.hidden_suite_v10.manifest_path), "utf8")
  );
  assert.equal(sha256(v2reg), freeze.v2_regression_sha256);
  assert.equal(sha256(v2hold), freeze.v2_holdout_sha256);
  assert.equal(v9Manifest.full_suite_sha256, freeze.hidden_suite_v9.full_suite_sha256);
  assert.equal(
    v9Manifest.product_baseline_commit,
    freeze.hidden_suite_v9.product_baseline_commit
  );
  assert.equal(
    v10Manifest.full_suite_sha256,
    freeze.hidden_suite_v10.full_suite_sha256
  );
  assert.equal(
    v10Manifest.product_baseline_commit,
    freeze.hidden_suite_v10.product_baseline_commit
  );
});

test("v1 frozen regression digests stay immutable (historical contract)", async () => {
  const freeze = JSON.parse(
    await readFile(path.join(root, "fixtures/c0/FIXTURE_FREEZE.json"), "utf8")
  );
  const regression = await readFile(
    path.join(root, freeze.regression_path),
    "utf8"
  );
  const holdout = await readFile(path.join(root, freeze.holdout_v1_path), "utf8");
  assert.equal(sha256(regression), freeze.regression_sha256);
  assert.equal(sha256(holdout), freeze.holdout_v1_sha256);
});

test("trusted policy matches v2 regression structured args (business fills memberTags)", async () => {
  const { applyTrustedArgumentPolicy } = await loadPolicy();
  const fixture = JSON.parse(
    await readFile(
      path.join(root, "fixtures/c0/v2/tool-calling-scenarios.json"),
      "utf8"
    )
  );
  const dictionary = toDictionary(fixture.fixture_id_map);
  let pass = 0;
  for (const scenario of fixture.scenarios) {
    const result = applyTrustedArgumentPolicy({
      tool: scenario.expected_tool,
      userText: scenario.user_text,
      dinerIdsLocked: Boolean(scenario.diner_ids_locked),
      state: policyState(scenario, dictionary),
      dictionary,
      rawArgs: {
        ...scenario.expected_arguments,
        // retrieval fixtures omit free-form query from exact expected_arguments
        ...(scenario.expected_tool === "retrieve_approved_guidance"
          ? { query: scenario.user_text }
          : {})
      }
    });
    assert.equal(result.status, "ok", scenario.id);
    if (scenario.expected_tool === "retrieve_approved_guidance") {
      assert.deepEqual(
        result.effective.memberIds,
        scenario.expected_arguments.memberIds,
        scenario.id
      );
      assert.deepEqual(
        result.effective.planTags,
        scenario.expected_arguments.planTags,
        scenario.id
      );
      assert.equal(
        result.effective.topK,
        scenario.expected_arguments.topK,
        scenario.id
      );
      assert.ok(typeof result.effective.query === "string");
      assert.ok(Array.isArray(result.effective.memberTags));
    } else {
      const expected =
        scenario.expected_tool === "compose_family_meal"
          ? {
              ...scenario.expected_arguments,
              pinnedTemplateIds:
                scenario.expected_arguments.pinnedTemplateIds ?? []
            }
          : scenario.expected_arguments;
      assert.deepEqual(result.effective, expected, scenario.id);
    }
    pass += 1;
  }
  assert.equal(pass, fixture.scenarios.length);
});

test("trusted policy matches v2 holdout structured args", async () => {
  const { applyTrustedArgumentPolicy } = await loadPolicy();
  const fixture = JSON.parse(
    await readFile(
      path.join(root, "fixtures/c0/v2/tool-calling-holdout-v2.json"),
      "utf8"
    )
  );
  const dictionary = toDictionary(fixture.fixture_id_map);
  for (const scenario of fixture.scenarios) {
    const result = applyTrustedArgumentPolicy({
      tool: scenario.expected_tool,
      userText: scenario.user_text,
      dinerIdsLocked: Boolean(scenario.diner_ids_locked),
      state: policyState(scenario, dictionary),
      dictionary,
      rawArgs: {
        ...scenario.expected_arguments,
        ...(scenario.expected_tool === "retrieve_approved_guidance"
          ? { query: scenario.user_text }
          : {})
      }
    });
    assert.equal(result.status, "ok", scenario.id);
  }
});

test("privacy minimization withholds family health tags by default", async () => {
  const { buildPrivacyMinimizedMemberDirectory } = await loadPolicy();
  const members = [
    {
      id: "mem-father",
      displayName: "爸爸",
      roleLabel: "father",
      healthTags: ["stable_type2_diabetes_demo"]
    },
    {
      id: "mem-mother",
      displayName: "妈妈",
      roleLabel: "mother",
      healthTags: ["hypertension_demo"]
    }
  ];
  const plain = buildPrivacyMinimizedMemberDirectory(
    members,
    "帮全家规划晚餐"
  );
  assert.ok(plain.every((m) => !m.healthTags?.length));
  const constrained = buildPrivacyMinimizedMemberDirectory(
    members,
    "说明妈妈的少盐约束"
  );
  assert.deepEqual(
    constrained.find((m) => m.id === "mem-mother")?.healthTags,
    ["hypertension_demo"]
  );
  assert.deepEqual(
    constrained.find((m) => m.id === "mem-father")?.healthTags ?? [],
    []
  );
});

test("model profiles pin real Gemma4 QAT primary and forbid 7B default", async () => {
  const profiles = JSON.parse(
    await readFile(
      path.join(root, "scripts/c0/stage-b/model-profiles.json"),
      "utf8"
    )
  );
  assert.equal(profiles.forbidden_defaults.default_model, null);
  assert.equal(profiles.forbidden_defaults.auto_fallback_model, null);
  assert.equal(profiles.primary_profile, "gemma4-12b-qat-w4a16-ct");
  const primary = profiles.profiles["gemma4-12b-qat-w4a16-ct"];
  assert.equal(primary.model_id, "google/gemma-4-12B-it-qat-w4a16-ct");
  assert.equal(primary.revision, "1d2c2d7f2466070e69d6fb3fd5ce9a7d75f2f6ee");
  assert.equal(primary.tool_call_parser, "gemma4");
  assert.equal(primary.reasoning_parser, "gemma4");
  assert.equal(primary.quantization.vllm_quantization_arg, "compressed-tensors");
  assert.equal(
    primary.chat_template.path,
    "scripts/c0/stage-b/chat-templates/gemma4-vllm-tool.jinja"
  );
  assert.equal(
    primary.chat_template.sha256,
    "afdbb2abe3667ccde95cc2f86919f05370339399bab5f750950a4390523b8927"
  );
  assert.equal(primary.kv_cache_memory_bytes, 8589934592);
  assert.equal(
    profiles.profiles.qwen14.kv_cache_memory_bytes,
    primary.kv_cache_memory_bytes
  );
  assert.equal(primary.judgment.model_capability, "NOT_RUN");
  assert.equal(profiles.profiles.qwen14.tool_call_parser, "hermes");
  assert.notEqual(primary.model_id.includes("7B"), true);
  assert.ok(!primary.model_id.includes("gemma-3"));
  for (const profile of Object.values(profiles.profiles)) {
    assert.ok(!String(profile.model_id ?? "").includes("Qwen2.5-7B"));
  }
});

test("validate-model-profile passes offline artifact checks", async () => {
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(
    process.execPath,
    [path.join(root, "scripts/c0/stage-b/validate-model-profile.mjs")],
    { encoding: "utf8" }
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "PASS");
  assert.equal(report.model_inference, "NOT_RUN");
});

test("resolveC0bOutDir protects privateplate-v2", async () => {
  const { resolveC0bOutDir } = await import("./resolve-out-dir.mjs");
  process.env.PRIVATEPLATE_RUN_ID = "privateplate-v2";
  assert.throws(() => resolveC0bOutDir(root), /protected/i);
  process.env.PRIVATEPLATE_RUN_ID = "privateplate-gemma4-test";
  const out = resolveC0bOutDir(root);
  assert.match(out, /privateplate-gemma4-test$/);
  process.env.PRIVATEPLATE_RUN_ID = "privateplate-gemma4-20260727T113757Z";
  const utcOut = resolveC0bOutDir(root);
  assert.match(utcOut, /privateplate-gemma4-20260727T113757Z$/);
  process.env.PRIVATEPLATE_RUN_ID = "../../privateplate-escape";
  assert.throws(() => resolveC0bOutDir(root), /direct privateplate/i);
  delete process.env.PRIVATEPLATE_RUN_ID;
});

test("combined tool gate fails closed on holdout, privacy, or effective policy", async () => {
  const { evaluateToolGate, evaluateCombinedToolGates } = await import(
    "../tool-gate.mjs"
  );
  // Metrics are recomputed from recorded arguments — booleans are not trusted.
  const base = Array.from({ length: 5 }, (_, i) => ({
    case_id: `c${i}`,
    expected_tool: "compose_family_meal",
    actual_tool: "compose_family_meal",
    expected_arguments: {
      dinerIds: ["mem-a"],
      mealType: "lunch",
      rejectedFoodIds: [],
      rejectedTemplateIds: [],
      requestedPriorityFoodIds: [],
      preferLowEffort: false
    },
    raw_model_arguments: {
      dinerIds: ["mem-a"],
      mealType: "lunch",
      rejectedFoodIds: [],
      rejectedTemplateIds: [],
      requestedPriorityFoodIds: [],
      preferLowEffort: false
    },
    effective_arguments: {
      dinerIds: ["mem-a"],
      mealType: "lunch",
      rejectedFoodIds: [],
      rejectedTemplateIds: [],
      requestedPriorityFoodIds: [],
      preferLowEffort: false
    },
    schema_valid: true,
    tool_match: true,
    arguments_match: true,
    raw_arguments_match: true,
    effective_policy_pass: true,
    privacy_violation: false
  }));
  const regression = evaluateToolGate(base);
  assert.equal(regression.overall_gate, "PASS");

  // 2/5 normalized-arg failures → 0.6 < 0.8 threshold.
  const holdoutFail = evaluateToolGate(
    base.map((row, i) =>
      i < 2
        ? {
            ...row,
            raw_model_arguments: {
              ...row.raw_model_arguments,
              dinerIds: ["mem-wrong"]
            }
          }
        : row
    )
  );
  assert.equal(holdoutFail.model_capability_gate, "FAIL");

  const privacyFail = evaluateToolGate(
    base.map((row, i) =>
      i === 1 ? { ...row, privacy_violation: true } : row
    )
  );
  assert.equal(privacyFail.privacy_gate, "FAIL");
  assert.equal(privacyFail.overall_gate, "FAIL");

  const effectiveFail = evaluateToolGate(
    base.map((row, i) =>
      i === 2
        ? { ...row, effective_arguments: null, effective_policy_pass: false }
        : row
    )
  );
  assert.equal(effectiveFail.effective_policy_gate, "FAIL");
  assert.equal(effectiveFail.overall_gate, "FAIL");

  const combined = evaluateCombinedToolGates([
    { name: "regression", gate: regression },
    { name: "holdout-v1", gate: holdoutFail }
  ]);
  assert.equal(combined.overall_gate, "FAIL");
  assert.ok(combined.failed_suites.includes("holdout-v1"));
});

test("runtime-pin pins both candidate revisions", async () => {
  const pin = JSON.parse(
    await readFile(path.join(root, "scripts/c0/stage-b/runtime-pin.json"), "utf8")
  );
  assert.equal(
    pin.candidates["gemma4-12b-qat-w4a16-ct"].revision,
    "1d2c2d7f2466070e69d6fb3fd5ce9a7d75f2f6ee"
  );
  assert.equal(
    pin.candidates.qwen14.revision,
    "cf98f3b3bbb457ad9e2bb7baf9a0125b6b88caa8"
  );
  assert.equal(pin.candidates["gemma4-12b-qat-w4a16-ct"].quantization, "compressed-tensors");
  assert.equal(pin.vllm.exact_version, "0.25.1+rocm723");
  assert.equal(
    pin.vllm.wheel_index,
    "https://wheels.vllm.ai/rocm/0.25.1/rocm723/vllm/"
  );
  assert.match(
    pin.vllm.wheel_url,
    /\/rocm\/752a3a504485790a2e8491cacbb35c137339ad34\//
  );
  assert.equal(pin.vllm.wheel_size_bytes, 198169819);
  assert.equal(pin.rocm.exact_version, "7.2.3");
  assert.deepEqual(pin.rocm.allowed_versions, ["7.2.3", "7.2.1"]);
  assert.equal(pin.torch.exact_base_version, "2.11.0");
  assert.equal(pin.transformers.exact_version, "5.14.1");
  assert.equal(pin.compressed_tensors.exact_version, "0.17.0");
  assert.equal(pin.hardware.gfx_architecture, "gfx1100");
  assert.equal(pin.hardware.compute_units, 96);
  assert.equal(pin.gates.privacy_zero_tolerance, true);
  assert.equal(pin.gates.holdout_required, true);
});

test("formal launch has no model, revision, template, or weight-hash bypass", async () => {
  const launchScript = await readFile(
    path.join(root, "scripts/c0/stage-b/01-start-vllm.sh"),
    "utf8"
  );
  const artifactScript = await readFile(
    path.join(root, "scripts/c0/stage-b/06-verify-model-artifacts.mjs"),
    "utf8"
  );
  assert.match(launchScript, /PRIVATEPLATE_MODEL_ID/);
  assert.match(launchScript, /Formal C0-B refuses/);
  assert.doesNotMatch(launchScript, /process\.env\.PRIVATEPLATE_MODEL_ID/);
  assert.doesNotMatch(launchScript, /PRIVATEPLATE_CHAT_TEMPLATE_VARIANT \|\|/);
  assert.doesNotMatch(artifactScript, /PRIVATEPLATE_HASH_WEIGHTS/);
  assert.match(artifactScript, /SHA_VERIFIED/);
});
