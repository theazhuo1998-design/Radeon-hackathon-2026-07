#!/usr/bin/env node
/**
 * R0-6: Formal product-path collection on Radeon.
 *
 * Unlike 02-run-tool-real.mjs (provider.route only), this drives:
 *   PrivatePlateAgent → OpenAiCompatibleToolProvider → Domain / gateway
 * and records full modelTrace + toolTrace per turn.
 *
 * Requires built packages (run-all already builds product provider).
 * Does not touch protected privateplate-v2 evidence.
 */
import { createHash } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import {
  assertLoopbackProvider,
  assertVerifiedRadeonEnvironment
} from "./evidence-guard.mjs";
import { redactSensitive } from "../provider-adapter.mjs";
import {
  assertFactOnlyRecord,
  scoreProductAgentScenario
} from "../golden-scorer.mjs";
import { verifyRecordedSource } from "./source-integrity.mjs";
import { resolveC0bOutDir } from "./resolve-out-dir.mjs";

if (process.env.PRIVATEPLATE_I_CONFIRM_RADEON_RUN !== "yes") {
  throw new Error(
    "Refusing product-agent collection without PRIVATEPLATE_I_CONFIRM_RADEON_RUN=yes."
  );
}

const root = fileURLToPath(new URL("../../../", import.meta.url));
const outDir = resolveC0bOutDir(root);
const rawDir = path.join(outDir, "raw");
const environmentPath = path.join(outDir, "environment.json");
const outPath = path.join(outDir, "product-agent-e2e.jsonl");
const summaryPath = path.join(outDir, "product-agent-e2e-summary.json");

const baseUrl = process.env.PRIVATEPLATE_VLLM_BASE_URL ?? "http://127.0.0.1:8000/v1";
const model =
  process.env.PRIVATEPLATE_MODEL_ACTIVE ??
  process.env.PRIVATEPLATE_MODEL_ID ??
  process.env.PRIVATEPLATE_MODEL;
if (!model) {
  throw new Error("Active model id required for product-agent collection.");
}
assertLoopbackProvider(baseUrl);
const environment = await assertVerifiedRadeonEnvironment(environmentPath);
await verifyRecordedSource(root, environmentPath);

async function importDist(rel) {
  const abs = path.join(root, rel);
  await access(abs);
  return import(pathToFileURL(abs).href);
}

const agentRuntime = await importDist("packages/agent-runtime/dist/index.js");
const domainPkg = await importDist("packages/domain/dist/index.js");

const { PrivatePlateAgent, OpenAiCompatibleToolProvider } = agentRuntime;
const { PrivatePlateDomain } = domainPkg;
if (typeof PrivatePlateDomain?.create !== "function") {
  throw new Error("packages/domain must export PrivatePlateDomain.create");
}

const scenarios = [
  {
    id: "product-agent-plan-revise-handoff-clarify",
    turns: [
      {
        text: "规划午餐，不要鸡腿。",
        model_decision: "tool",
        model_tool: "compose_family_meal",
        terminal_decision: "final",
        arguments: {
          dinerIds: ["mem-admin", "mem-father", "mem-mother"],
          mealType: "lunch",
          rejectedFoodIds: ["food-chicken-leg"],
          rejectedTemplateIds: [],
          pinnedTemplateIds: [],
          requestedPriorityFoodIds: [],
          preferLowEffort: false
        },
        required_executed_tools: ["compose_family_meal"],
        allowed_executed_tools: [
          "get_meal_context",
          "compose_family_meal",
          "retrieve_approved_guidance"
        ],
        task_outcome: {
          goal: "compose_meal",
          status: "COMPLETE",
          verification_passed: true
        },
        phase: "PRESENTING_PLAN"
      },
      {
        text: "还是更省事一点。",
        model_decision: "tool",
        model_tool: "revise_family_meal",
        terminal_decision: "final",
        arguments: {
          rejectTemplateIds: [],
          rejectFoodIds: [],
          preferLowEffort: true
        },
        required_executed_tools: ["revise_family_meal"],
        allowed_executed_tools: [
          "revise_family_meal",
          "retrieve_approved_guidance"
        ],
        task_outcome: {
          goal: "revise_meal",
          status: "COMPLETE",
          verification_passed: true
        },
        phase: "PRESENTING_PLAN"
      },
      {
        text: "请预览任务卡并准备发送",
        model_outcomes: [
          {
            decision: "ask_user",
            tool: "preview_caregiver_task"
          },
          { decision: "ask_user", tool: null }
        ],
        terminal_decision: "ask_user",
        required_executed_tools: [],
        allowed_executed_tools: [],
        task_outcome: {
          goal: "send_handoff",
          status: "BLOCKED",
          verification_passed: true
        },
        phase: "AWAITING_USER"
      },
      {
        text: "保姆",
        model_decision: "tool",
        model_tool: "preview_caregiver_task",
        terminal_decision: "final",
        arguments: {
          recipientLabel: "保姆",
          serveAt: "unspecified"
        },
        required_executed_tools: ["preview_caregiver_task"],
        allowed_executed_tools: ["preview_caregiver_task"],
        task_outcome: {
          goal: "send_handoff",
          status: "BLOCKED",
          verification_passed: true
        },
        phase: "AWAITING_CONFIRMATION"
      }
    ],
    final_phase: "AWAITING_CONFIRMATION",
    require_pending_action: true
  },
  {
    id: "product-agent-inspect-after-plan",
    turns: [
      {
        text: "规划午餐，不要鸡腿。",
        model_decision: "tool",
        model_tool: "compose_family_meal",
        terminal_decision: "final",
        arguments: {
          dinerIds: ["mem-admin", "mem-father", "mem-mother"],
          mealType: "lunch",
          rejectedFoodIds: ["food-chicken-leg"],
          rejectedTemplateIds: [],
          pinnedTemplateIds: [],
          requestedPriorityFoodIds: [],
          preferLowEffort: false
        },
        required_executed_tools: ["compose_family_meal"],
        allowed_executed_tools: [
          "get_meal_context",
          "compose_family_meal",
          "retrieve_approved_guidance"
        ],
        task_outcome: {
          goal: "compose_meal",
          status: "COMPLETE",
          verification_passed: true
        },
        phase: "PRESENTING_PLAN"
      },
      {
        text: "查看家庭库存",
        model_decision: "tool",
        model_tool: "get_meal_context",
        terminal_decision: "final",
        arguments: {
          dinerIds: ["mem-admin", "mem-father", "mem-mother"]
        },
        required_executed_tools: ["get_meal_context"],
        allowed_executed_tools: ["get_meal_context"],
        task_outcome: {
          goal: "inspect_context",
          status: "COMPLETE",
          verification_passed: true
        },
        phase: "COMPLETED"
      }
    ],
    final_phase: "COMPLETED",
    require_pending_action: false
  },
  {
    id: "product-agent-food-polarity",
    turns: [
      {
        text: "规划晚餐，牛肉优先，不要豆腐。",
        model_decision: "tool",
        model_tool: "compose_family_meal",
        terminal_decision: "final",
        arguments: {
          dinerIds: ["mem-admin", "mem-father", "mem-mother"],
          mealType: "dinner",
          rejectedFoodIds: ["food-tofu"],
          rejectedTemplateIds: [],
          pinnedTemplateIds: [],
          requestedPriorityFoodIds: ["food-beef"],
          preferLowEffort: false
        },
        required_executed_tools: ["compose_family_meal"],
        allowed_executed_tools: [
          "get_meal_context",
          "compose_family_meal",
          "retrieve_approved_guidance"
        ],
        task_outcome: {
          goal: "compose_meal",
          status: "COMPLETE",
          verification_passed: true
        },
        phase: "PRESENTING_PLAN"
      }
    ],
    final_phase: "PRESENTING_PLAN",
    require_pending_action: false
  },
  {
    id: "product-agent-dish-revision",
    turns: [
      {
        text: "规划午餐。",
        model_decision: "tool",
        model_tool: "compose_family_meal",
        terminal_decision: "final",
        arguments: {
          dinerIds: ["mem-admin", "mem-father", "mem-mother"],
          mealType: "lunch",
          rejectedFoodIds: [],
          rejectedTemplateIds: [],
          pinnedTemplateIds: [],
          requestedPriorityFoodIds: [],
          preferLowEffort: false
        },
        required_executed_tools: ["compose_family_meal"],
        allowed_executed_tools: [
          "get_meal_context",
          "compose_family_meal",
          "retrieve_approved_guidance"
        ],
        task_outcome: {
          goal: "compose_meal",
          status: "COMPLETE",
          verification_passed: true
        },
        phase: "PRESENTING_PLAN"
      },
      {
        text: "上一版的香菇蒸蛋不要了，别的照旧。",
        model_decision: "tool",
        model_tool: "revise_family_meal",
        terminal_decision: "final",
        arguments: {
          rejectTemplateIds: ["tpl-shiitake-egg"],
          rejectFoodIds: [],
          preferLowEffort: false
        },
        required_executed_tools: ["revise_family_meal"],
        allowed_executed_tools: [
          "revise_family_meal",
          "retrieve_approved_guidance"
        ],
        task_outcome: {
          goal: "revise_meal",
          status: "COMPLETE",
          verification_passed: true
        },
        phase: "PRESENTING_PLAN"
      }
    ],
    final_phase: "PRESENTING_PLAN",
    require_pending_action: false
  },
  {
    id: "product-agent-ingredient-replacement",
    turns: [
      {
        text: "全家午饭吃土豆炖鸡腿，正常做。",
        model_decision: "tool",
        model_tool: "compose_family_meal",
        terminal_decision: "final",
        arguments: {
          dinerIds: ["mem-admin", "mem-father", "mem-mother"],
          mealType: "lunch",
          rejectedFoodIds: [],
          rejectedTemplateIds: [],
          pinnedTemplateIds: ["tpl-potato-chicken"],
          requestedPriorityFoodIds: [],
          preferLowEffort: false
        },
        required_executed_tools: ["compose_family_meal"],
        allowed_executed_tools: [
          "get_meal_context",
          "compose_family_meal",
          "retrieve_approved_guidance"
        ],
        task_outcome: {
          goal: "compose_meal",
          status: "COMPLETE",
          verification_passed: true
        },
        phase: "PRESENTING_PLAN",
        required_menu_template_ids: ["tpl-potato-chicken"],
        menu_count: 3
      },
      {
        text: "鸡腿不要了，换一道菜，其他保持不变。",
        model_decision: "tool",
        model_tool: "revise_family_meal",
        terminal_decision: "final",
        arguments: {
          rejectTemplateIds: [],
          rejectFoodIds: ["food-chicken-leg"],
          preferLowEffort: false
        },
        required_executed_tools: ["revise_family_meal"],
        allowed_executed_tools: [
          "revise_family_meal",
          "retrieve_approved_guidance"
        ],
        task_outcome: {
          goal: "revise_meal",
          status: "COMPLETE",
          verification_passed: true
        },
        phase: "PRESENTING_PLAN",
        forbidden_menu_template_ids: ["tpl-potato-chicken"],
        menu_count: 3
      }
    ],
    final_phase: "PRESENTING_PLAN",
    require_pending_action: false
  }
];

let currentExchanges = [];
const provider = new OpenAiCompatibleToolProvider({
  baseUrl,
  model,
  apiKey: process.env.PRIVATEPLATE_VLLM_API_KEY,
  timeoutMs: Number(process.env.PRIVATEPLATE_REQUEST_TIMEOUT_MS ?? 120_000),
  fetchImpl: async (input, init) => {
    const requestBody = parseRequestBody(init?.body);
    const exchange = {
      request_sha256: createHash("sha256")
        .update(JSON.stringify(requestBody))
        .digest("hex"),
      request_body: redactSensitive(requestBody),
      response_status: null,
      response_body: null
    };
    currentExchanges.push(exchange);
    const response = await fetch(input, init);
    const responseText = await response.clone().text();
    exchange.response_status = response.status;
    exchange.response_body = redactSensitive(parseResponseBody(responseText));
    return response;
  }
});

await mkdir(rawDir, { recursive: true });
const records = [];
const caseResults = [];
let failures = 0;

for (const scenario of scenarios) {
  const domain = await PrivatePlateDomain.create(":memory:");
  const agent = new PrivatePlateAgent(
    domain,
    `product-agent-${scenario.id}`,
    provider
  );
  const turnRows = [];
  for (const turnSpec of scenario.turns) {
    currentExchanges = [];
    const started = performance.now();
    const turn = await agent.handleUserMessage(turnSpec.text);
    const activePlan = agent.state.activePlanId
      ? domain.getPlanById(agent.state.activePlanId)
      : null;
    const activeMenuTemplateIds =
      activePlan?.sharedTemplates.map((item) => item.templateId) ?? [];
    turnRows.push({
      user_text: turnSpec.text,
      phase: turn.phase,
      answer_preview: String(turn.answer ?? "").slice(0, 240),
      toolTrace: turn.toolTrace,
      modelTrace: turn.modelTrace ?? null,
      modelSteps: turn.modelSteps,
      taskOutcome: turn.taskOutcome,
      provider_exchanges: currentExchanges,
      routingEvidenceKind: turn.routingEvidenceKind ?? null,
      validationOk: turn.validationOk === true,
      pending_action_id: turn.state.pendingActionId,
      activeMenuTemplateIds,
      latency_ms: Math.round(performance.now() - started)
    });
  }

  const toolsUsed = turnRows.flatMap((row) =>
    (row.toolTrace ?? []).filter((t) => t.ok).map((t) => t.tool)
  );
  const modelTraces = turnRows.filter((row) => row.modelTrace).length;
  const modelSteps = turnRows.reduce(
    (count, row) => count + row.modelSteps.length,
    0
  );
  const privacyHits = turnRows.filter(
    (row) =>
      row.modelSteps.some((step) => step.policy.privacyViolation) ||
      row.modelTrace?.privacy_violation === true
  ).length;
  const factualRecord = assertFactOnlyRecord({
    schema_version: "1.2",
    stage: "C0-B",
    suite: "product_agent_e2e",
    case_id: scenario.id,
    provider_mode: "local_vllm_radeon_product_agent",
    remote_api: false,
    evidence_eligible: true,
    measurement_scope: "agent_domain_gateway_full_path",
    model,
    base_url_host: new URL(baseUrl).hostname,
    turns: turnRows,
    tools_used: toolsUsed,
    model_trace_count: modelTraces,
    model_step_count: modelSteps,
    privacy_violation_count: privacyHits,
    final_phase: agent.state.phase,
    final_active_plan_id: agent.state.activePlanId,
    final_pending_action_id: agent.state.pendingActionId
  });
  records.push(factualRecord);

  const evaluation = scoreProductAgentScenario(scenario, {
    turns: turnRows,
    finalPhase: agent.state.phase,
    finalPendingActionId: agent.state.pendingActionId
  });
  caseResults.push({
    case_id: scenario.id,
    status: evaluation.status,
    failures: evaluation.failures
  });
  if (evaluation.status !== "PASS") failures += 1;
}

const summary = {
  schema_version: "1.3",
  stage: "C0-B",
  measurement_scope: "agent_domain_gateway_full_path",
  status: failures === 0 ? "PASS" : "FAIL",
  sample_count: records.length,
  failed_count: failures,
  cases: caseResults,
  model,
  model_profile: process.env.PRIVATEPLATE_MODEL_PROFILE ?? null,
  run_id: process.env.PRIVATEPLATE_RUN_ID ?? null,
  git_commit: environment.git_commit ?? null,
  claim_boundary:
    "PASS requires every product turn to use the model, choose the expected tool, match normalized and effective arguments, execute the expected domain tools, produce the required menu state, reach the expected phase, pass answer validation, and avoid privacy violations. Raw request/response exchanges are retained per turn; raw argument completeness remains diagnostic.",
  lifecycle_note:
    "Product-agent collection does not manage the free Global instance. run-all stops the local vLLM service during finalization."
};

await writeFile(
  outPath,
  `${records.map((r) => JSON.stringify(r)).join("\n")}\n`,
  "utf8"
);
await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify(summary, null, 2));
if (failures > 0) process.exitCode = 2;

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
