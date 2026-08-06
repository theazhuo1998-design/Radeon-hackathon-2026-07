#!/usr/bin/env node
/**
 * Deterministic rule baseline for the same public fixture contracts.
 * No model: intent classification + trusted argument policy only.
 * Used to prove whether a model is better than a fixed script on open language.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { jsonValuesEqual } from "./tool-gate.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));

async function loadPolicyModules() {
  const policyPath = path.join(
    root,
    "packages/agent-runtime/dist/model/argument-policy.js"
  );
  const intentPath = path.join(root, "packages/agent-runtime/dist/policy.js");
  return {
    ...(await import(pathToFileURL(policyPath).href)),
    ...(await import(pathToFileURL(intentPath).href))
  };
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
      ([id, name]) => ({
        id,
        name,
        aliases: name.includes("蒸蛋") ? ["蒸蛋"] : []
      })
    ),
    planTags: Object.entries(fixtureIdMap.guidance_plan_tags ?? {}).map(
      ([id, label]) => ({ id, label })
    ),
    caregiverRecipientLabels: Object.keys(
      fixtureIdMap.caregiver_recipients ?? {
        家庭保姆: "家庭保姆",
        保姆: "保姆",
        阿姨: "阿姨"
      }
    )
  };
}

function inferRole(id, member) {
  if (/father|父|爸/.test(`${id}${member.display_name}`)) return "father";
  if (/mother|母|妈/.test(`${id}${member.display_name}`)) return "mother";
  if (/admin|管理/.test(`${id}${member.display_name}`)) return "admin";
  return "member";
}

function intentToTool(intent, state) {
  switch (intent) {
    case "inspect_context":
      return "get_meal_context";
    case "plan_meal":
      return "compose_family_meal";
    case "revise_meal":
      return state.activePlanId ? "revise_family_meal" : null;
    case "handoff_task":
      return state.activePlanId ? "preview_caregiver_task" : null;
    default:
      return null;
  }
}

export async function runRuleBaseline(fixturePath) {
  const { applyTrustedArgumentPolicy, classifyIntent } =
    await loadPolicyModules();
  const fixtureText = await readFile(fixturePath, "utf8");
  const fixture = JSON.parse(fixtureText);
  const dictionary = toDictionary(fixture.fixture_id_map);
  const records = [];

  for (const scenario of fixture.scenarios) {
    const state = {
      dinerIds:
        scenario.current_state?.dinerIds ??
        dictionary.members.map((member) => member.id),
      activePlanId: scenario.current_state?.activePlanId ?? null,
      activePlanVersion: scenario.current_state?.activePlanVersion ?? null,
      rejectedFoodIds: scenario.current_state?.rejectedFoodIds ?? [],
      rejectedTemplateIds: scenario.current_state?.rejectedTemplateIds ?? []
    };
    const decision = classifyIntent(scenario.user_text);
    const tool = intentToTool(decision.intent, state);
    const expectedTool = scenario.expected_tool;
    let toolMatch = tool === expectedTool;
    let argumentsMatch = false;
    let effective = null;
    let outcome = "NO_TOOL";

    if (tool) {
      const policy = applyTrustedArgumentPolicy({
        tool,
        userText: scenario.user_text,
        dinerIdsLocked: Boolean(scenario.diner_ids_locked),
        state,
        dictionary,
        rawArgs: null
      });
      if (policy.status === "ok") {
        effective = policy.effective;
        argumentsMatch =
          toolMatch &&
          jsonValuesEqual(effective, scenario.expected_arguments);
        outcome = argumentsMatch ? "FULL_MATCH" : "ARGUMENTS_MISMATCH";
      } else {
        outcome = "NEEDS_CLARIFICATION";
        toolMatch = false;
      }
    }

    records.push({
      case_id: scenario.id,
      suite: fixture.suite ?? path.basename(fixturePath, ".json"),
      expected_tool: expectedTool,
      actual_tool: tool,
      expected_arguments: scenario.expected_arguments,
      effective_arguments: effective,
      raw_model_arguments: null,
      schema_valid: tool != null,
      tool_match: toolMatch,
      arguments_match: argumentsMatch,
      raw_arguments_match: false,
      effective_policy_pass: argumentsMatch,
      privacy_violation: false,
      outcome,
      baseline: "deterministic_rule"
    });
  }

  const toolMatchRate =
    records.filter((record) => record.tool_match).length / records.length;
  const fullMatchRate =
    records.filter((record) => record.arguments_match).length / records.length;

  return {
    schema_version: "1.0",
    baseline: "deterministic_rule_policy",
    fixture_path: path.relative(root, fixturePath).split(path.sep).join("/"),
    fixture_sha256: createHash("sha256").update(fixtureText).digest("hex"),
    sample_count: records.length,
    metrics: {
      tool_match_rate: toolMatchRate,
      full_argument_match_rate: fullMatchRate
    },
    records,
    note: "Rule baseline has no raw model arguments. Compare model raw rates against these tool/arg rates to justify LLM value."
  };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const fixture =
    process.argv[2] ??
    path.join(root, "fixtures/c0/tool-calling-scenarios.json");
  const out = process.argv[3];
  const report = await runRuleBaseline(fixture);
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (out) await writeFile(out, text, "utf8");
  else process.stdout.write(text);
}
