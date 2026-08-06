/**
 * Offline closed-loop for the v2 formal contract (no vLLM / no Radeon).
 *
 * Covers: trusted policy, health-tag no-fallback, Domain card retrieval for
 * public/holdout retrieval_cards cases, and dual-contract scorer fixture
 * completeness detection. Hidden plaintext is never loaded here.
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
const { pathToFileURL } = require("node:url");

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

async function loadCompiled(relativePath) {
  const abs = path.join(root, relativePath);
  return import(pathToFileURL(abs).href);
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
    rejectedFoodIds: scenario.current_state?.rejectedFoodIds ?? [],
    rejectedTemplateIds: scenario.current_state?.rejectedTemplateIds ?? [],
    expectedRecipientLabel:
      scenario.expected_tool === "preview_caregiver_task"
        ? scenario.expected_arguments?.recipientLabel ?? null
        : null
  };
}

async function loadV2Fixtures() {
  const freeze = JSON.parse(
    await readFile(path.join(root, "fixtures/c0/FIXTURE_FREEZE.json"), "utf8")
  );
  const regressionText = await readFile(
    path.join(root, freeze.v2_regression_path),
    "utf8"
  );
  const holdoutText = await readFile(
    path.join(root, freeze.v2_holdout_path),
    "utf8"
  );
  assert.equal(sha256(regressionText), freeze.v2_regression_sha256);
  assert.equal(sha256(holdoutText), freeze.v2_holdout_sha256);

  const regression = JSON.parse(regressionText);
  const holdout = JSON.parse(holdoutText);
  return {
    freeze,
    dictionary: toDictionary(regression.fixture_id_map),
    suites: [
      { name: "v2-regression", scenarios: regression.scenarios },
      { name: "v2-holdout", scenarios: holdout.scenarios }
    ]
  };
}

test("resolveMemberHealthTags does not silently fall back without constraint talk", async () => {
  const { resolveMemberHealthTags } = await loadCompiled(
    "packages/agent-runtime/dist/model/argument-policy.js"
  );
  const members = [
    {
      id: "mem-mother",
      displayName: "母亲",
      roleLabel: "mother",
      healthTags: ["hypertension_demo"],
      aliases: ["妈妈"]
    },
    {
      id: "mem-father",
      displayName: "父亲",
      roleLabel: "father",
      healthTags: ["stable_type2_diabetes_demo"],
      aliases: ["爸爸"]
    }
  ];
  assert.deepEqual(
    resolveMemberHealthTags(
      ["mem-mother", "mem-father"],
      members,
      "解释这份初次规划为什么优先使用快坏的豆腐。"
    ),
    []
  );
  assert.deepEqual(
    resolveMemberHealthTags(
      ["mem-mother"],
      members,
      "说明妈妈在初次规划中的少盐约束。"
    ),
    ["hypertension_demo"]
  );
});

test("v2 retrieval fixtures hit expected cards via Domain without vLLM", async () => {
  const { PrivatePlateDomain } = await loadCompiled(
    "packages/domain/dist/service/privateplate-domain.js"
  );
  const { applyTrustedArgumentPolicy, resolveMemberHealthTags } =
    await loadCompiled("packages/agent-runtime/dist/model/argument-policy.js");
  const { freeze, dictionary, suites } = await loadV2Fixtures();
  void freeze;

  const domain = await PrivatePlateDomain.create(":memory:");
  try {
    let retrievalCases = 0;
    for (const suite of suites) {
      for (const scenario of suite.scenarios) {
        if (scenario.expected_tool !== "retrieve_approved_guidance") continue;
        if (scenario.scoring_mode !== "retrieval_cards") continue;
        retrievalCases += 1;

        const policy = applyTrustedArgumentPolicy({
          tool: scenario.expected_tool,
          userText: scenario.user_text,
          dinerIdsLocked: Boolean(scenario.diner_ids_locked),
          state: policyState(scenario, dictionary),
          dictionary,
          rawArgs: {
            query: scenario.user_text,
            ...scenario.expected_arguments
          }
        });
        assert.equal(policy.status, "ok", `${suite.name}:${scenario.id}`);
        assert.ok(Array.isArray(policy.effective.memberTags));
        // No silent health-tag fallback: tags only when constraint discussed.
        const expectedTags = resolveMemberHealthTags(
          scenario.expected_arguments.memberIds ?? [],
          dictionary.members,
          scenario.user_text
        );
        assert.deepEqual(
          policy.effective.memberTags,
          expectedTags,
          `${suite.name}:${scenario.id} memberTags`
        );

        const packet = domain.retrieveApprovedGuidance({
          query: String(policy.effective.query),
          memberTags: policy.effective.memberTags,
          planTags: policy.effective.planTags,
          topK: policy.effective.topK
        });
        const actualIds = packet.cards.map((card) => card.sourceId);
        for (const expectedId of scenario.expected_card_ids ?? []) {
          assert.ok(
            actualIds.includes(expectedId),
            `${suite.name}:${scenario.id} expected ${expectedId} in ${JSON.stringify(actualIds)} for query=${scenario.user_text}`
          );
        }
      }
    }
    assert.ok(retrievalCases >= 6, `expected several retrieval cases, got ${retrievalCases}`);
  } finally {
    domain.close();
  }
});

test("v2 compose dish/ingredient and state-pollution cases exist and policy-pass", async () => {
  const { applyTrustedArgumentPolicy } = await loadCompiled(
    "packages/agent-runtime/dist/model/argument-policy.js"
  );
  const { dictionary, suites } = await loadV2Fixtures();
  const wanted = new Map([
    [
      "v2-r-013",
      {
        rejectedFoodIds: [],
        rejectedTemplateIds: ["tpl-tomato-egg"]
      }
    ],
    [
      "v2-r-014",
      {
        rejectTemplateIds: [],
        rejectFoodIds: [],
        preferLowEffort: true
      }
    ],
    [
      "v2-h-007",
      {
        rejectedFoodIds: [],
        rejectedTemplateIds: [],
        requestedPriorityFoodIds: ["food-cabbage"]
      }
    ]
  ]);

  const found = new Set();
  for (const suite of suites) {
    for (const scenario of suite.scenarios) {
      if (!wanted.has(scenario.id)) continue;
      found.add(scenario.id);
      const result = applyTrustedArgumentPolicy({
        tool: scenario.expected_tool,
        userText: scenario.user_text,
        dinerIdsLocked: Boolean(scenario.diner_ids_locked),
        state: policyState(scenario, dictionary),
        dictionary,
        rawArgs: scenario.expected_arguments
      });
      assert.equal(result.status, "ok", scenario.id);
      const expectPartial = wanted.get(scenario.id);
      for (const [key, value] of Object.entries(expectPartial)) {
        assert.deepEqual(result.effective[key], value, `${scenario.id}.${key}`);
      }
    }
  }
  assert.equal(found.size, wanted.size, `missing cases: ${[...wanted.keys()].filter((id) => !found.has(id))}`);
});

test("independent scorer fixture completeness is dual-contract aware", async () => {
  const { scoreToolJsonl } = await import("../score-tool-jsonl.mjs");
  const { writeFile, mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const freeze = JSON.parse(
    await readFile(path.join(root, "fixtures/c0/FIXTURE_FREEZE.json"), "utf8")
  );
  const regression = JSON.parse(
    await readFile(path.join(root, freeze.v2_regression_path), "utf8")
  );
  const holdout = JSON.parse(
    await readFile(path.join(root, freeze.v2_holdout_path), "utf8")
  );
  const hiddenManifest = JSON.parse(
    await readFile(path.join(root, freeze.hidden_suite_v4.manifest_path), "utf8")
  );
  const hiddenV9Manifest = JSON.parse(
    await readFile(path.join(root, freeze.hidden_suite_v9.manifest_path), "utf8")
  );
  const hiddenV10Manifest = JSON.parse(
    await readFile(path.join(root, freeze.hidden_suite_v10.manifest_path), "utf8")
  );

  const dir = await mkdtemp(path.join(tmpdir(), "pp-v2-score-"));
  try {
    const records = [
      ...regression.scenarios.map((scenario) => ({
        schema_version: "3.1",
        stage: "C0-B",
        suite: "v2-regression",
        scoring_contract: "v2",
        case_id: scenario.id,
        fixture_sha256: freeze.v2_regression_sha256,
        expected_tool: scenario.expected_tool,
        actual_tool: scenario.expected_tool,
        expected_arguments: scenario.expected_arguments,
        raw_model_arguments:
          scenario.expected_tool === "retrieve_approved_guidance"
            ? { query: scenario.user_text, ...scenario.expected_arguments }
            : scenario.expected_arguments,
        effective_arguments:
          scenario.expected_tool === "retrieve_approved_guidance"
            ? {
                query: scenario.user_text,
                ...scenario.expected_arguments,
                memberTags: []
              }
            : scenario.expected_arguments,
        scoring_mode: scenario.scoring_mode ?? "args_exact",
        expected_card_ids: scenario.expected_card_ids ?? null,
        actual_card_ids: scenario.expected_card_ids ?? null,
        privacy_violation: false
      })),
      ...holdout.scenarios.map((scenario) => ({
        schema_version: "3.1",
        stage: "C0-B",
        suite: "v2-holdout",
        scoring_contract: "v2",
        case_id: scenario.id,
        fixture_sha256: freeze.v2_holdout_sha256,
        expected_tool: scenario.expected_tool,
        actual_tool: scenario.expected_tool,
        expected_arguments: scenario.expected_arguments,
        raw_model_arguments:
          scenario.expected_tool === "retrieve_approved_guidance"
            ? { query: scenario.user_text, ...scenario.expected_arguments }
            : scenario.expected_arguments,
        effective_arguments:
          scenario.expected_tool === "retrieve_approved_guidance"
            ? {
                query: scenario.user_text,
                ...scenario.expected_arguments,
                memberTags: []
              }
            : scenario.expected_arguments,
        scoring_mode: scenario.scoring_mode ?? "args_exact",
        expected_card_ids: scenario.expected_card_ids ?? null,
        actual_card_ids: scenario.expected_card_ids ?? null,
        privacy_violation: false
      })),
      ...hiddenManifest.cases.map((item) => ({
        schema_version: "3.1",
        stage: "C0-B",
        suite: "hidden-v4",
        scoring_contract: "v2",
        case_id: item.id,
        fixture_sha256: hiddenManifest.full_suite_sha256,
        expected_tool: "compose_family_meal",
        actual_tool: "compose_family_meal",
        expected_arguments: {
          dinerIds: ["mem-admin"],
          mealType: "lunch",
          rejectedFoodIds: [],
          rejectedTemplateIds: [],
          requestedPriorityFoodIds: [],
          preferLowEffort: false
        },
        raw_model_arguments: {
          dinerIds: ["mem-admin"],
          mealType: "lunch",
          rejectedFoodIds: [],
          rejectedTemplateIds: [],
          requestedPriorityFoodIds: [],
          preferLowEffort: false
        },
        effective_arguments: {
          dinerIds: ["mem-admin"],
          mealType: "lunch",
          rejectedFoodIds: [],
          rejectedTemplateIds: [],
          requestedPriorityFoodIds: [],
          preferLowEffort: false
        },
        privacy_violation: false
      }))
    ];
    const jsonlPath = path.join(dir, "tool-calling.jsonl");
    await writeFile(
      jsonlPath,
      `${records.map((record) => JSON.stringify(record)).join("\n")}\n`
    );
    const report = await scoreToolJsonl(jsonlPath);
    assert.equal(report.fixture_completeness.eval_contract, "v2");
    assert.equal(report.fixture_completeness.gate, "PASS");
    assert.equal(report.fixture_completeness.suites["v2-regression"].case_ids_match, true);
    assert.equal(report.fixture_completeness.suites["v2-holdout"].case_ids_match, true);
    assert.equal(report.fixture_completeness.suites["hidden-v4"].case_ids_match, true);

    const hiddenTemplate = records.find(
      (record) => record.suite === "hidden-v4"
    );
    const v10Records = [
      ...records.filter((record) => record.suite !== "hidden-v4"),
      ...hiddenV10Manifest.cases.map((item) => ({
        ...hiddenTemplate,
        suite: "hidden-v10",
        case_id: item.id,
        fixture_sha256: hiddenV10Manifest.full_suite_sha256
      }))
    ];
    await writeFile(
      jsonlPath,
      `${v10Records.map((record) => JSON.stringify(record)).join("\n")}\n`
    );
    const v10Report = await scoreToolJsonl(jsonlPath);
    assert.equal(v10Report.fixture_completeness.gate, "PASS");
    assert.equal(
      v10Report.fixture_completeness.suites["hidden-v10"].case_ids_match,
      true
    );

    const v9Records = [
      ...records.filter((record) => record.suite !== "hidden-v4"),
      ...hiddenV9Manifest.cases.map((item) => ({
        ...hiddenTemplate,
        suite: "hidden-v9",
        case_id: item.id,
        fixture_sha256: hiddenV9Manifest.full_suite_sha256
      }))
    ];
    await writeFile(
      jsonlPath,
      `${v9Records.map((record) => JSON.stringify(record)).join("\n")}\n`
    );
    const v9Report = await scoreToolJsonl(jsonlPath);
    assert.equal(v9Report.fixture_completeness.gate, "PASS");
    assert.equal(
      v9Report.fixture_completeness.suites["hidden-v9"].case_ids_match,
      true
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
