import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertFactOnlyRecord,
  GOLDEN_THRESHOLDS,
  scoreGoldenSuite
} from "./golden-scorer.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const fixturePath = path.join(
  root,
  "fixtures/evals/public-agent-seed.json"
);
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const validationFailures = validateFixture(fixture);
const recordsPath = argumentValue("--records");

if (validationFailures.length > 0) {
  console.log(
    JSON.stringify(
      {
        mode: "public_golden_spec_validation",
        evidenceEligible: false,
        status: "FAIL",
        failures: validationFailures
      },
      null,
      2
    )
  );
  process.exitCode = 1;
} else if (!recordsPath) {
  console.log(
    JSON.stringify(
      {
        mode: "public_golden_spec_validation",
        evidenceEligible: false,
        status: "PASS",
        sampleCount: fixture.cases.length,
        multiTurnCount: fixture.cases.filter(
          (item) => item.turns.length > 1
        ).length,
        thresholds: GOLDEN_THRESHOLDS,
        note:
          "仅验证公开黄金集与评分入口；未提供真实模型事实记录，因此不产生模型能力分数。"
      },
      null,
      2
    )
  );
} else {
  const absoluteRecordsPath = path.resolve(root, recordsPath);
  const payload = parseRecordsPayload(
    await readFile(absoluteRecordsPath, "utf8"),
    absoluteRecordsPath
  );
  const records = Array.isArray(payload) ? payload : payload.records;
  if (!Array.isArray(records)) {
    throw new Error("Golden records must be an array or an object with records[].");
  }
  records.forEach(assertFactOnlyRecord);
  const score = scoreGoldenSuite(fixture.cases, records);
  console.log(
    JSON.stringify(
      {
        mode: "public_golden_fact_scoring",
        evidenceEligible: false,
        declaredEvidenceEligible: payload.evidenceEligible === true,
        providerMode: payload.providerMode ?? "not_declared",
        source: absoluteRecordsPath,
        note:
          "本入口只评分提供的事实记录；是否具备 Radeon 正式证据资格需由正式采集链另行验证。",
        ...score
      },
      null,
      2
    )
  );
  if (score.overall !== "PASS") process.exitCode = 1;
}

function validateFixture(value) {
  const failures = [];
  const cases = Array.isArray(value?.cases) ? value.cases : [];
  if (value?.schemaVersion !== "1.0") failures.push("schema_version");
  if (value?.role !== "public_golden") failures.push("role");
  if (cases.length < 30 || cases.length > 40) failures.push("sample_count");

  const ids = cases.map((item) => item.id);
  if (new Set(ids).size !== ids.length) failures.push("duplicate_case_id");
  if (cases.filter((item) => item.turns?.length > 1).length < 10) {
    failures.push("multi_turn_coverage");
  }

  const outcomes = new Set(cases.map((item) => item.expectedOutcome));
  if (!outcomes.has("COMPLETE") || !outcomes.has("BLOCKED")) {
    failures.push("outcome_coverage");
  }

  const coreTools = new Set([
    "get_meal_context",
    "compose_family_meal",
    "revise_family_meal",
    "retrieve_approved_guidance",
    "preview_caregiver_task"
  ]);
  const coveredTools = new Set(cases.flatMap((item) => item.requiredTools ?? []));
  for (const tool of coreTools) {
    if (!coveredTools.has(tool)) failures.push(`missing_core_tool:${tool}`);
  }

  for (const item of cases) {
    if (!item.id || !item.goal || !Array.isArray(item.turns)) {
      failures.push(`incomplete_case:${item.id ?? "unknown"}`);
      continue;
    }
    if (
      !Array.isArray(item.requiredTools) ||
      !Array.isArray(item.forbiddenTools) ||
      !item.forbiddenTools.includes("commit_*")
    ) {
      failures.push(`unsafe_tool_contract:${item.id}`);
    }
    for (const turn of item.turns) {
      if (
        typeof turn.user !== "string" ||
        !Array.isArray(turn.allowedModelActions) ||
        turn.allowedModelActions.length === 0
      ) {
        failures.push(`incomplete_turn:${item.id}`);
      }
    }
  }
  return failures;
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function parseRecordsPayload(source, sourcePath) {
  if (sourcePath.endsWith(".jsonl")) {
    return {
      records: source
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line))
    };
  }
  return JSON.parse(source);
}
