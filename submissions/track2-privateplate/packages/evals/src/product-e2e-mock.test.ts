/**
 * R0-3: product E2E through PrivatePlateAgent + ScriptedProductProvider.
 * Proves create / revise / handoff / confirm / cancel / provider-failure
 * share one business path (not a separate demo engine).
 */
import { describe, expect, it } from "vitest";
import { ScriptedProductProvider } from "@privateplate/agent-runtime";
import { runScenario } from "./run-scenario.js";
import type { AgentScenario } from "./types.js";

const productE2eScenarios: AgentScenario[] = [
  {
    id: "product-e2e-mock-main-loop",
    initialFixture: "demo-household",
    userTurns: [
      "中午我们三个人吃什么？豆腐今天最好吃掉，但我不想再吃鸡腿了。",
      "蒸蛋今天也不想吃，换一道，其他都保留。",
      "发给保姆"
    ],
    expectedTools: [
      "compose_family_meal",
      "revise_family_meal",
      "preview_caregiver_task"
    ],
    forbiddenTools: ["commit_*"],
    expectedFinalState: "AWAITING_CONFIRMATION",
    expectedPlanVersion: 2,
    assertions: [
      "plan_version_2",
      "rejected_chicken",
      "rejected_steamed_egg",
      "preview_only_no_inbox",
      "ui_only_token_present",
      "model_traces_present",
      "model_effective_args_present",
      "confirm_then_replay_single_inbox"
    ]
  },
  {
    id: "product-e2e-mock-cancel",
    initialFixture: "demo-household",
    userTurns: [
      "帮我规划午餐，优先用豆腐，不要鸡腿。",
      "发给保姆"
    ],
    expectedTools: ["compose_family_meal", "preview_caregiver_task"],
    forbiddenTools: ["commit_*"],
    expectedFinalState: "AWAITING_CONFIRMATION",
    assertions: [
      "preview_only_no_inbox",
      "ui_only_token_present",
      "model_traces_present",
      "cancel_blocks_confirm"
    ]
  },
  {
    id: "product-e2e-mock-clarify-handoff",
    initialFixture: "demo-household",
    userTurns: [
      "规划午餐，不要鸡腿。",
      "请预览任务卡并准备发送"
    ],
    expectedTools: ["compose_family_meal"],
    forbiddenTools: ["preview_caregiver_task", "commit_*"],
    expectedFinalState: "AWAITING_USER",
    assertions: ["has_plan", "model_traces_present", "preview_only_no_inbox"]
  },
  {
    id: "product-e2e-mock-clarify-then-保姆",
    initialFixture: "demo-household",
    userTurns: [
      "规划午餐，不要鸡腿。",
      "请预览任务卡并准备发送",
      "保姆"
    ],
    expectedTools: ["compose_family_meal", "preview_caregiver_task"],
    forbiddenTools: ["commit_*"],
    expectedFinalState: "AWAITING_CONFIRMATION",
    assertions: [
      "has_plan",
      "model_traces_present",
      "preview_only_no_inbox",
      "ui_only_token_present"
    ]
  },
  {
    id: "product-e2e-mock-provider-failure",
    initialFixture: "demo-household",
    userTurns: ["帮我规划一顿午餐，不要鸡腿。"],
    expectedTools: [],
    forbiddenTools: ["commit_*"],
    expectedFinalState: "ERROR",
    assertions: ["provider_error_no_success", "no_tools"]
  }
];

describe("R0-3 product E2E with ScriptedProductProvider", () => {
  it("runs create → revise → preview → confirm once via model-routed path", async () => {
    const provider = new ScriptedProductProvider();
    const result = await runScenario(productE2eScenarios[0]!, {
      provider,
      requireModelRouting: true
    });
    expect(result.pass, result.failures.join("; ")).toBe(true);
    expect(result.modelTraceCount).toBeGreaterThan(0);
    expect(result.routingKinds?.every((k) => k !== "deterministic_demo")).toBe(
      true
    );
  });

  it("cancel leaves zero inbox writes", async () => {
    const provider = new ScriptedProductProvider();
    const result = await runScenario(productE2eScenarios[1]!, {
      provider,
      requireModelRouting: true
    });
    expect(result.pass, result.failures.join("; ")).toBe(true);
  });

  it("missing recipient clarifies without writing", async () => {
    const provider = new ScriptedProductProvider();
    const result = await runScenario(productE2eScenarios[2]!, {
      provider,
      requireModelRouting: true
    });
    expect(result.pass, result.failures.join("; ")).toBe(true);
  });

  it("follow-up 保姆 after clarify completes handoff preview", async () => {
    const provider = new ScriptedProductProvider();
    const result = await runScenario(productE2eScenarios[3]!, {
      provider,
      requireModelRouting: true
    });
    expect(result.pass, result.failures.join("; ")).toBe(true);
    expect(result.phase).toBe("AWAITING_CONFIRMATION");
  });

  it("provider failure does not claim success or write inbox", async () => {
    const provider = new ScriptedProductProvider({
      steps: [{ kind: "throw", message: "simulated vLLM outage" }]
    });
    const result = await runScenario(productE2eScenarios[4]!, {
      provider,
      requireModelRouting: true
    });
    expect(result.pass, result.failures.join("; ")).toBe(true);
    expect(result.phase).toBe("ERROR");
  });
});
