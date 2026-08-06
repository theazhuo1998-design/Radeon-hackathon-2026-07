#!/usr/bin/env node
/**
 * Run frozen five-tool benchmarks against loopback vLLM.
 *
 * Formal contract: v2 (public v2 + holdout-v2 + untouched hidden suite).
 * Historical v1 evidence remains scoreable offline via score-tool-jsonl.mjs.
 *
 * Records immutable raw model arguments, separately normalized/effective
 * arguments, and actual_card_ids from Domain.retrieveApprovedGuidance.
 * Never overwrites protected privateplate-v2 evidence.
 */
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import {
  jsonValuesEqual,
  redactSensitive
} from "../provider-adapter.mjs";
import {
  evaluateCombinedToolGates,
  evaluateCriticalGates,
  evaluatePerToolScores,
  evaluateToolGate,
  recomputeRecordMetrics
} from "../tool-gate.mjs";
import {
  assertLoopbackProvider,
  assertVerifiedRadeonEnvironment
} from "./evidence-guard.mjs";
import { verifyRecordedSource } from "./source-integrity.mjs";
import { resolveC0bOutDir } from "./resolve-out-dir.mjs";

if (process.env.PRIVATEPLATE_I_CONFIRM_RADEON_RUN !== "yes") {
  throw new Error(
    "Refusing to collect C0-B evidence without PRIVATEPLATE_I_CONFIRM_RADEON_RUN=yes."
  );
}

const root = fileURLToPath(new URL("../../../", import.meta.url));
const evalContract = "v2";
const freezePath = path.join(root, "fixtures/c0/FIXTURE_FREEZE.json");
const outDir = resolveC0bOutDir(root);
const environmentPath = path.join(outDir, "environment.json");
const outPath = path.join(outDir, "tool-calling.jsonl");
const summaryPath = path.join(outDir, "tool-calling-summary.json");
const rawDir = path.join(outDir, "raw");
const requestSamplePath = path.join(rawDir, "product-provider-request-sample.json");
const productProviderPath = path.join(
  root,
  "packages/agent-runtime/dist/model/provider.js"
);
const productToolDefinitionsPath = path.join(
  root,
  "packages/agent-runtime/dist/model/tool-definitions.js"
);
const productStatePath = path.join(root, "packages/agent-runtime/dist/state.js");
const domainPath = path.join(
  root,
  "packages/domain/dist/service/privateplate-domain.js"
);

const baseUrl = process.env.PRIVATEPLATE_VLLM_BASE_URL ?? "http://127.0.0.1:8000/v1";
const model =
  process.env.PRIVATEPLATE_MODEL_ACTIVE ??
  process.env.PRIVATEPLATE_MODEL_ID ??
  process.env.PRIVATEPLATE_MODEL;
if (!model) {
  throw new Error(
    "PRIVATEPLATE_MODEL_ACTIVE or PRIVATEPLATE_MODEL_ID is required (no default model)."
  );
}
const timeoutMs = Number(process.env.PRIVATEPLATE_REQUEST_TIMEOUT_MS ?? 120_000);
const baseUrlHost = assertLoopbackProvider(baseUrl);
const environment = await assertVerifiedRadeonEnvironment(environmentPath);
const sourceIntegrity = await verifyRecordedSource(root, environmentPath);

const [
  { OpenAiCompatibleToolProvider },
  {
    PRIVATEPLATE_MODEL_TOOLS,
    parseCanonicalToolArguments,
    toExpectedModelToolArguments
  },
  { AGENT_TOOL_ALLOWLIST },
  { PrivatePlateDomain }
] = await Promise.all([
  importCompiledModule(productProviderPath),
  importCompiledModule(productToolDefinitionsPath),
  importCompiledModule(productStatePath),
  importCompiledModule(domainPath)
]);
const productToolNames = PRIVATEPLATE_MODEL_TOOLS.map(
  (tool) => tool.function.name
);
if (
  productToolNames.length !== 5 ||
  !jsonValuesEqual(productToolNames, AGENT_TOOL_ALLOWLIST)
) {
  throw new Error(
    "Compiled product provider must expose the exact five-tool Agent allowlist."
  );
}

const freeze = JSON.parse(await readFile(freezePath, "utf8"));
const scenarioSets = await loadScenarioSets(freeze, root);
const retrievalDomain = await PrivatePlateDomain.create(":memory:");
const plannerCatalog = retrievalDomain.getCatalog();

for (const set of scenarioSets) {
  if (!Array.isArray(set.scenarios) || set.scenarios.length === 0) {
    throw new Error(`Fixture suite ${set.suite} has no scenarios.`);
  }
  for (const scenario of set.scenarios) {
    if (scenario.expect_no_tool || scenario.expected_tool == null) {
      continue;
    }
    if (!productToolNames.includes(scenario.expected_tool)) {
      throw new Error(`Invalid fixture contract: ${scenario.id}`);
    }
    if (scenario.expected_arguments != null) {
      const parseArgs =
        scenario.scoring_mode === "retrieval_cards" &&
        scenario.expected_tool === "retrieve_approved_guidance"
          ? {
              query: scenario.user_text ?? "query",
              ...scenario.expected_arguments
            }
          : scenario.expected_arguments;
      parseCanonicalToolArguments(scenario.expected_tool, parseArgs);
    }
  }
}

await mkdir(outDir, { recursive: true });
await mkdir(rawDir, { recursive: true });
await assertFileDoesNotExist(outPath);
await assertFileDoesNotExist(summaryPath);

let currentExchanges = [];
let requestSample = null;
const provider = new OpenAiCompatibleToolProvider({
  baseUrl,
  model,
  apiKey: process.env.PRIVATEPLATE_VLLM_API_KEY,
  timeoutMs,
  fetchImpl: async (input, init) => {
    const requestBody = parseRequestBody(init?.body);
    const requestHash = sha256(JSON.stringify(requestBody));
    const exchange = {
      request_sha256: requestHash,
      request_body: redactSensitive(requestBody),
      response_status: null,
      response_body: null
    };
    currentExchanges.push(exchange);
    requestSample ??= {
      captured_at_utc: new Date().toISOString(),
      adapter: "OpenAiCompatibleToolProvider",
      compiled_product_provider: relativePath(productProviderPath),
      eval_contract: evalContract,
      request: redactSensitive(requestBody)
    };
    const response = await fetch(input, init);
    const responseText = await response.clone().text();
    exchange.response_status = response.status;
    exchange.response_body = redactSensitive(parseResponseBody(responseText));
    return response;
  }
});

const records = [];

for (const set of scenarioSets) {
  for (const scenario of set.scenarios) {
    const started = performance.now();
    const expectedArguments =
      scenario.expected_tool === "compose_family_meal" &&
      scenario.expected_arguments
        ? parseCanonicalToolArguments(
            scenario.expected_tool,
            scenario.expected_arguments
          )
        : scenario.expected_arguments;
    let record = {
      schema_version: "3.4",
      stage: "C0-B",
      suite: set.suite,
      scoring_contract: set.scoring_contract ?? evalContract,
      scoring_mode: scenario.scoring_mode ?? "args_exact",
      case_id: scenario.id,
      provider_mode: "local_vllm_radeon",
      remote_api: false,
      model,
      base_url_host: baseUrlHost,
      expected_tool: scenario.expected_tool,
      expected_arguments: expectedArguments,
      expected_model_arguments:
        scenario.expected_tool && expectedArguments
          ? toExpectedModelToolArguments(
              scenario.expected_tool,
              expectedArguments
            )
          : null,
      expected_card_ids: scenario.expected_card_ids ?? null,
      card_match: scenario.card_match ?? null,
      top_k_explicit: scenario.top_k_explicit === true,
      expect_no_tool: Boolean(
        scenario.expect_no_tool || scenario.expected_tool == null
      ),
      expect_clarification: Boolean(scenario.expect_clarification),
      expect_safe_stop_or_no_write: Boolean(
        scenario.expect_safe_stop_or_no_write
      ),
      evidence_eligible: true,
      measurement_scope: "real_model_product_provider_five_tool_routing",
      product_provider_request_mode: null,
      fixture_sha256: set.fixture_sha256
    };

    try {
      currentExchanges = [];
      const decision = await provider.route(
        createProductProviderInput(
          scenario,
          set.fixture.fixture_id_map,
          plannerCatalog
        )
      );

      if (decision.kind === "final" || decision.kind === "refuse") {
        record = {
          ...record,
          latency_ms: Math.round(performance.now() - started),
          actual_tool: null,
          raw_model_arguments: null,
          normalized_model_arguments: null,
          effective_arguments: null,
          actual_arguments: null,
          normalized_retrieval_card_ids: null,
          effective_retrieval_card_ids: null,
          actual_card_ids: null,
          privacy_violation: decision.privacy_violation === true,
          outcome: decision.kind.toUpperCase(),
          format_retry_count: decision.format_retry_count,
          format_retry_reasons: decision.format_retry_reasons,
          provider_exchange: currentExchanges.at(-1) ?? null,
          provider_exchanges: currentExchanges
        };
      } else if (decision.kind === "ask_user") {
        const raw = decision.raw_model_arguments;
        const normalized = decision.normalized_model_arguments;
        record = {
          ...record,
          latency_ms: Math.round(performance.now() - started),
          actual_tool: decision.tool,
          raw_model_arguments: raw ? redactSensitive(raw) : null,
          normalized_model_arguments: normalized
            ? redactSensitive(normalized)
            : null,
          effective_arguments: null,
          actual_arguments: raw ? redactSensitive(raw) : null,
          normalized_retrieval_card_ids: null,
          effective_retrieval_card_ids: null,
          actual_card_ids: null,
          privacy_violation: decision.privacy_violation === true,
          outcome: "NEEDS_CLARIFICATION",
          policy_reasons: decision.reasons,
          format_retry_count: decision.format_retry_count,
          format_retry_reasons: decision.format_retry_reasons,
          provider_exchange: currentExchanges.at(-1) ?? null,
          provider_exchanges: currentExchanges
        };
      } else {
        let normalizedCardIds = null;
        let effectiveCardIds = null;
        if (
          decision.tool === "retrieve_approved_guidance" &&
          decision.effective_arguments &&
          typeof decision.effective_arguments === "object"
        ) {
          const normalized = decision.normalized_model_arguments;
          if (normalized && typeof normalized === "object") {
            const packet = retrievalDomain.retrieveApprovedGuidance({
              query: String(normalized.query ?? ""),
              memberTags: [],
              planTags: Array.isArray(normalized.planTags)
                ? normalized.planTags
                : [],
              topK:
                typeof normalized.topK === "number" ? normalized.topK : 3
            });
            normalizedCardIds = packet.cards.map((card) => card.sourceId);
          }
          const packet = retrievalDomain.retrieveApprovedGuidance({
            query: String(decision.effective_arguments.query ?? ""),
            memberTags: Array.isArray(decision.effective_arguments.memberTags)
              ? decision.effective_arguments.memberTags
              : [],
            planTags: Array.isArray(decision.effective_arguments.planTags)
              ? decision.effective_arguments.planTags
              : [],
            topK:
              typeof decision.effective_arguments.topK === "number"
                ? decision.effective_arguments.topK
                : 3
          });
          effectiveCardIds = packet.cards.map((card) => card.sourceId);
        }

        record = {
          ...record,
          latency_ms: Math.round(performance.now() - started),
          actual_tool: decision.tool,
          raw_model_arguments: redactSensitive(decision.raw_model_arguments),
          normalized_model_arguments: redactSensitive(
            decision.normalized_model_arguments
          ),
          effective_arguments: redactSensitive(decision.effective_arguments),
          actual_arguments: redactSensitive(decision.raw_model_arguments),
          normalized_retrieval_card_ids: normalizedCardIds,
          effective_retrieval_card_ids: effectiveCardIds,
          actual_card_ids: effectiveCardIds,
          privacy_violation: decision.privacy_violation === true,
          outcome: "TOOL",
          policy_reasons: decision.policy.reasons,
          format_retry_count: decision.format_retry_count,
          format_retry_reasons: decision.format_retry_reasons,
          provider_exchange: currentExchanges.at(-1) ?? null,
          provider_exchanges: currentExchanges
        };
      }
    } catch (error) {
      record = {
        ...record,
        latency_ms: Math.round(performance.now() - started),
        privacy_violation: false,
        normalized_retrieval_card_ids: null,
        effective_retrieval_card_ids: null,
        actual_card_ids: null,
        outcome: "ERROR",
        provider_exchange: currentExchanges.at(-1) ?? null,
        provider_exchanges: currentExchanges,
        error: {
          name: error?.name ?? "Error",
          message: String(error?.message ?? error)
        }
      };
    }

    const requestModes = currentExchanges.map((exchange) =>
      providerRequestMode(exchange.request_body)
    );
    record.product_provider_request_mode = requestModes.at(-1) ?? null;
    record.product_provider_request_modes = requestModes;
    records.push(record);
    const metrics = recomputeRecordMetrics(record);
    console.log(
      [
        record.suite,
        record.case_id,
        record.outcome,
        `${record.latency_ms ?? "?"}ms`,
        `schema=${metrics.schema_valid}`,
        `tool=${metrics.tool_match}`,
        `cards=${Array.isArray(record.actual_card_ids) ? record.actual_card_ids.join("|") : "-"}`,
        `privacy_violation=${record.privacy_violation}`
      ].join(" ")
    );
  }
}

retrievalDomain.close();

const suiteResults = scenarioSets.map((set) => {
  const suiteRecords = records.filter((record) => record.suite === set.suite);
  return {
    name: set.role,
    suite: set.suite,
    gate: evaluateToolGate(suiteRecords),
    sample_count: suiteRecords.length,
    fixture_sha256: set.fixture_sha256
  };
});
const primaryGate = suiteResults[0]?.gate ?? evaluateToolGate([]);
const combinedGate = evaluateCombinedToolGates(
  suiteResults.map((item) => ({ name: item.name, gate: item.gate }))
);
const criticalGates = evaluateCriticalGates(records);
const perTool = evaluatePerToolScores(records);
const overallPass =
  combinedGate.overall_gate === "PASS" &&
  criticalGates.gate === "PASS" &&
  perTool.overall_gate === "PASS";
const [
  productProviderDist,
  productToolDefinitionsDist
] = await Promise.all([
  readFile(productProviderPath),
  readFile(productToolDefinitionsPath)
]);

const summary = {
  schema_version: "3.6",
  stage: "C0-B",
  eval_contract: evalContract,
  model_tool_contract: "typed-meal-preferences-v2",
  status: overallPass ? "PASS" : "FAIL",
  sample_count: records.length,
  suite_sample_counts: Object.fromEntries(
    suiteResults.map((item) => [item.suite, item.sample_count])
  ),
  fixture_roles: Object.fromEntries(
    scenarioSets.map((set) => [set.suite, set.role])
  ),
  fixture_sha256_by_suite: Object.fromEntries(
    scenarioSets.map((set) => [set.suite, set.fixture_sha256])
  ),
  suite_gates: Object.fromEntries(
    suiteResults.map((item) => [item.suite, item.gate])
  ),
  // Collection evaluator still keys public suites as regression/holdout.
  // Map formal v2 public suites onto those names without inventing gates.
  regression_gate:
    suiteResults.find((item) => item.suite === "v2-regression")?.gate ??
    suiteResults.find((item) => item.suite === "regression")?.gate ??
    null,
  holdout_gate:
    suiteResults.find((item) => item.suite === "v2-holdout")?.gate ??
    suiteResults.find((item) => item.suite === "holdout-v1")?.gate ??
    null,
  combined_gate: combinedGate,
  critical_gates: criticalGates,
  per_tool: perTool,
  overall_gate: overallPass ? "PASS" : "FAIL",
  model_capability_gate: combinedGate.model_capability_gate,
  production_safety_gate:
    combinedGate.privacy_gate === "PASS" &&
    combinedGate.effective_policy_gate === "PASS"
      ? "PASS"
      : "FAIL",
  privacy_gate: combinedGate.privacy_gate,
  effective_policy_gate: combinedGate.effective_policy_gate,
  metrics: primaryGate.metrics,
  minimum_routing_gate: primaryGate.minimum_routing_gate,
  full_arguments_gate: primaryGate.full_arguments_gate,
  model,
  model_profile: process.env.PRIVATEPLATE_MODEL_PROFILE ?? null,
  run_id: process.env.PRIVATEPLATE_RUN_ID ?? null,
  provider_mode: "local_vllm_radeon",
  remote_api: false,
  evidence_eligible: true,
  scoring_policy: {
    eval_contract: evalContract,
    retrieval:
      "retrieval_cards cases require Domain.retrieveApprovedGuidance actual_card_ids",
    model_capability:
      "typed rejections and requested dishes normalize to the frozen canonical contract; retrieval quality is judged by approved cards, member scope, and explicit result counts",
    production_safety:
      "zero privacy_violation and 100% effective_policy_pass on every business outcome",
    independent_rescore: "scripts/c0/score-tool-jsonl.mjs",
    metrics_trust:
      "Self-reported booleans are ignored; raw arguments remain diagnostic, normalized arguments gate model capability, and effective arguments gate product correctness and safety",
    overall:
      "FAIL closed if suite gates, per-tool gates, privacy, effective-policy, or critical fields fail",
    note: "v1 fixtures remain frozen for historical rescore. Formal default is v2.",
    product_agent_path:
      "Also run scripts/c0/stage-b/02b-run-product-agent.mjs for Agent→Domain multi-turn with full modelTrace (not tool-route only)."
  },
  product_provider: {
    adapter: "OpenAiCompatibleToolProvider",
    measurement_scope: "model_tool_routing_only_unless_02b_also_run",
    request_mode: { tool_choice: "auto", stream: false },
    tool_names: productToolNames,
    compiled_provider_path: relativePath(productProviderPath),
    compiled_provider_sha256: sha256(productProviderDist),
    compiled_tool_definitions_path: relativePath(productToolDefinitionsPath),
    compiled_tool_definitions_sha256: sha256(productToolDefinitionsDist),
    git_commit: environment.git_commit ?? null,
    git_dirty: environment.git_dirty ?? null,
    source_integrity_mode: sourceIntegrity.mode,
    source_manifest_sha256: sourceIntegrity.manifest_sha256,
    source_file_count: sourceIntegrity.file_count
  },
  output: relativePath(outPath),
  protected_evidence_untouched: [
    "benchmarks/c0/stage-b/privateplate-v2/tool-calling.jsonl",
    "benchmarks/c0/stage-b/privateplate-v2.attempt1-arg-fail/tool-calling.jsonl",
    "benchmarks/c0/stage-b/privateplate-gemma4-20260727T130313Z/tool-calling.jsonl"
  ]
};

if (requestSample) {
  await writeFile(
    requestSamplePath,
    `${JSON.stringify(requestSample, null, 2)}\n`,
    "utf8"
  );
}
await writeFile(
  outPath,
  `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
  "utf8"
);
await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

console.log(JSON.stringify(summary, null, 2));
if (!overallPass) {
  process.exitCode = 2;
}

async function loadScenarioSets(freeze, repoRoot) {
  const hiddenConfig = freeze.hidden_suite_v10;
  if (
    hiddenConfig?.status !== "SEALED" ||
    hiddenConfig.role !== "hidden_blind_v10"
  ) {
    throw new Error(
      "No active sealed blind suite. hidden-v10 is reviewed history and cannot be reused as blind evidence. Seal a new hidden suite first."
    );
  }

  return loadNamedScenarioSets(
    {
      regressionPath: freeze.v2_regression_path,
      regressionSha: freeze.v2_regression_sha256,
      regressionSuite: "v2-regression",
      regressionRole: "public_regression_v2",
      holdoutPath: freeze.v2_holdout_path,
      holdoutSha: freeze.v2_holdout_sha256,
      holdoutSuite: "v2-holdout",
      holdoutRole: "public_validation_v2",
      hiddenFull:
        process.env.PRIVATEPLATE_HIDDEN_SUITE_PATH ??
        "fixtures/c0/hidden/v10/scenarios.full.json",
      hiddenManifest: hiddenConfig.manifest_path,
      hiddenSuite: "hidden-v10",
      hiddenRole: hiddenConfig.role,
      productBaselineCommit: hiddenConfig.product_baseline_commit,
      scoring_contract: "v2"
    },
    repoRoot
  );
}

async function loadNamedScenarioSets(paths, repoRoot) {
  const regressionAbs = path.join(repoRoot, paths.regressionPath);
  const holdoutAbs = path.join(repoRoot, paths.holdoutPath);
  const regressionText = await readFile(regressionAbs, "utf8");
  const holdoutText = await readFile(holdoutAbs, "utf8");
  const regressionSha = sha256(regressionText);
  const holdoutSha = sha256(holdoutText);
  if (regressionSha !== paths.regressionSha) {
    throw new Error(
      `Regression fixture SHA mismatch: expected ${paths.regressionSha}, got ${regressionSha}`
    );
  }
  if (holdoutSha !== paths.holdoutSha) {
    throw new Error(
      `Holdout fixture SHA mismatch: expected ${paths.holdoutSha}, got ${holdoutSha}`
    );
  }
  const regression = JSON.parse(regressionText);
  const holdout = JSON.parse(holdoutText);
  const sets = [
    {
      suite: paths.regressionSuite,
      role: paths.regressionRole,
      scoring_contract: paths.scoring_contract,
      fixture: regression,
      scenarios: regression.scenarios,
      fixture_sha256: regressionSha
    },
    {
      suite: paths.holdoutSuite,
      role: paths.holdoutRole,
      scoring_contract: paths.scoring_contract,
      fixture: holdout,
      scenarios: holdout.scenarios,
      fixture_sha256: holdoutSha
    }
  ];

  const hiddenAbs = path.isAbsolute(paths.hiddenFull)
    ? paths.hiddenFull
    : path.join(repoRoot, paths.hiddenFull);
  const hiddenText = await readFile(hiddenAbs, "utf8");
  const hiddenSha = sha256(hiddenText);
  const hiddenManifest = JSON.parse(
    await readFile(path.join(repoRoot, paths.hiddenManifest), "utf8")
  );
  if (
    hiddenManifest.suite !== paths.hiddenSuite ||
    hiddenManifest.role !== paths.hiddenRole ||
    hiddenManifest.product_baseline_commit !== paths.productBaselineCommit
  ) {
    throw new Error(
      `Hidden suite manifest metadata mismatch for ${paths.hiddenSuite}.`
    );
  }
  if (hiddenSha !== hiddenManifest.full_suite_sha256) {
    throw new Error(
      `Hidden suite SHA mismatch: expected ${hiddenManifest.full_suite_sha256}, got ${hiddenSha}`
    );
  }
  const hidden = JSON.parse(hiddenText);
  sets.push({
    suite: paths.hiddenSuite,
    role: paths.hiddenRole,
    scoring_contract: paths.scoring_contract,
    fixture: {
      ...hidden,
      fixture_id_map:
        hidden.fixture_id_map ??
        regression.fixture_id_map ??
        holdout.fixture_id_map
    },
    scenarios: hidden.scenarios,
    fixture_sha256: hiddenSha
  });
  return sets;
}

async function assertFileDoesNotExist(filePath) {
  try {
    await access(filePath);
  } catch {
    return;
  }
  throw new Error(
    `Refusing to overwrite existing evidence: ${path.relative(root, filePath)}`
  );
}

async function importCompiledModule(filePath) {
  try {
    await access(filePath);
  } catch {
    throw new Error(
      `Compiled product provider is missing: ${relativePath(filePath)}. Run 00-prepare-product-provider.sh before starting vLLM.`
    );
  }
  return import(pathToFileURL(filePath).href);
}

function createProductProviderInput(scenario, fixtureIdMap, plannerCatalog) {
  const members = Object.entries(fixtureIdMap.members ?? {}).map(
    ([id, member]) => ({
      id,
      displayName: member.aliases?.[0] ?? member.display_name,
      roleLabel: inferRoleLabel(id, member),
      healthTags: member.health_tags ?? [],
      aliases: member.aliases ?? []
    })
  );
  const foods = Object.entries(fixtureIdMap.foods ?? {}).map(
    ([id, name]) => ({
      id,
      name,
      aliases: []
    })
  );
  const ingredientIdsByTemplate = new Map(
    (plannerCatalog?.templates ?? []).map((template) => [
      template.id,
      template.ingredientsPerStandardServing.map(
        (ingredient) => ingredient.foodId
      )
    ])
  );
  const templates = Object.entries(
    fixtureIdMap.meal_templates ?? {}
  ).map(([id, name]) => ({
    id,
    name,
    ingredientFoodIds: ingredientIdsByTemplate.get(id) ?? []
  }));
  const planTags = Object.entries(
    fixtureIdMap.guidance_plan_tags ?? {}
  ).map(([id, label]) => ({ id, label }));
  const caregiverRecipientLabels = Object.keys(
    fixtureIdMap.caregiver_recipients ?? {
      家庭保姆: "家庭保姆",
      保姆: "保姆",
      阿姨: "阿姨"
    }
  );
  const currentState = scenario.current_state ?? {};
  const activePlan = createActivePlanContext(
    scenario,
    currentState,
    templates
  );

  return {
    userText: scenario.user_text,
    conversationHistory: normalizeConversationHistory(
      scenario.conversation_history
    ),
    activePlan,
    pendingClarification:
      scenario.pending_clarification === "handoff_recipient"
        ? {
            tool: "preview_caregiver_task",
            missing: ["recipientLabel"],
            known: {
              serveAt:
                scenario.pending_known?.serveAt ?? "unspecified"
            }
          }
        : null,
    state: {
      phase: "CLASSIFYING",
      dinerIds: currentState.dinerIds ?? members.map((member) => member.id),
      activePlanId: currentState.activePlanId ?? null,
      activePlanVersion: currentState.activePlanVersion ?? null,
      rejectedFoodIds: currentState.rejectedFoodIds ?? [],
      rejectedTemplateIds: currentState.rejectedTemplateIds ?? []
    },
    dinerIdsLocked: Boolean(scenario.diner_ids_locked),
    memberDirectory: members,
    fixtureDirectory: {
      foods,
      templates,
      planTags,
      caregiverRecipientLabels
    }
  };
}

function createActivePlanContext(scenario, currentState, templates) {
  if (!currentState.activePlanId) return null;
  const supplied = scenario.active_plan;
  if (supplied && typeof supplied === "object") {
    return {
      id: currentState.activePlanId,
      version: currentState.activePlanVersion ?? supplied.version ?? 1,
      mealType: supplied.mealType === "dinner" ? "dinner" : "lunch",
      dinerIds: supplied.dinerIds ?? currentState.dinerIds ?? [],
      menu: supplied.menu ?? templates.map(toPlanMenuItem),
      rejectedFoodIds: supplied.rejectedFoodIds ?? [],
      rejectedTemplateIds: supplied.rejectedTemplateIds ?? [],
      pinnedTemplateIds: supplied.pinnedTemplateIds ?? [],
      requestedPriorityFoodIds: supplied.requestedPriorityFoodIds ?? [],
      preferLowEffort: supplied.preferLowEffort === true
    };
  }
  return {
    id: currentState.activePlanId,
    version: currentState.activePlanVersion ?? 1,
    mealType: "lunch",
    dinerIds: currentState.dinerIds ?? [],
    menu: templates.map(toPlanMenuItem),
    rejectedFoodIds: currentState.rejectedFoodIds ?? [],
    rejectedTemplateIds: currentState.rejectedTemplateIds ?? [],
    pinnedTemplateIds: currentState.pinnedTemplateIds ?? [],
    requestedPriorityFoodIds: currentState.requestedPriorityFoodIds ?? [],
    preferLowEffort: currentState.preferLowEffort === true
  };
}

function toPlanMenuItem(template) {
  return { templateId: template.id, name: template.name };
}

function normalizeConversationHistory(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (turn) =>
        turn &&
        typeof turn.user === "string" &&
        typeof turn.assistant === "string"
    )
    .map((turn) => ({
      user: turn.user,
      assistant: turn.assistant,
      tools: Array.isArray(turn.tools) ? turn.tools : []
    }))
    .slice(-6);
}

function providerRequestMode(requestBody) {
  if (!requestBody || typeof requestBody !== "object") return null;
  return {
    tool_choice: requestBody.tool_choice ?? null,
    stream: requestBody.stream === true,
    tool_names: Array.isArray(requestBody.tools)
      ? requestBody.tools
          .map((tool) => tool?.function?.name)
          .filter((name) => typeof name === "string")
      : []
  };
}

function inferRoleLabel(id, member) {
  if (member.role_label) return member.role_label;
  if (/father|父|爸/.test(`${id}${member.display_name ?? ""}`)) return "father";
  if (/mother|母|妈/.test(`${id}${member.display_name ?? ""}`)) return "mother";
  if (/admin|管理/.test(`${id}${member.display_name ?? ""}`)) return "admin";
  return "member";
}

function parseRequestBody(body) {
  if (typeof body !== "string") return null;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

function parseResponseBody(body) {
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function relativePath(filePath) {
  return path.relative(root, filePath).split(path.sep).join("/");
}
