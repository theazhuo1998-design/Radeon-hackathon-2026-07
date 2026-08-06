#!/usr/bin/env node
/**
 * Independent scorer for C0 tool-calling JSONL.
 *
 * Trusts recorded raw, normalized and effective evidence, never summary PASS fields.
 * Raw completeness is diagnostic; normalized args gate model capability and
 * effective args gate business safety.
 *
 * Usage:
 *   node scripts/c0/score-tool-jsonl.mjs --jsonl path/to/tool-calling.jsonl
 *   node scripts/c0/score-tool-jsonl.mjs --jsonl path --write path/to/rescore.json
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateCombinedToolGates,
  evaluateCriticalGates,
  evaluatePerToolScores,
  evaluateToolGate
} from "./tool-gate.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));

export async function scoreToolJsonl(jsonlPath, options = {}) {
  const text = await readFile(jsonlPath, "utf8");
  const records = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(`Invalid JSONL at line ${index + 1} of ${jsonlPath}`);
      }
    });

  if (records.length === 0) {
    throw new Error(`No records in ${jsonlPath}`);
  }

  const bySuite = new Map();
  for (const record of records) {
    const suite = record.suite ?? "default";
    if (!bySuite.has(suite)) bySuite.set(suite, []);
    bySuite.get(suite).push(record);
  }

  const suiteResults = [];
  for (const [name, suiteRecords] of bySuite) {
    suiteResults.push({
      name,
      gate: evaluateToolGate(suiteRecords, options.thresholds),
      sample_count: suiteRecords.length
    });
  }

  const combined =
    suiteResults.length > 1
      ? evaluateCombinedToolGates(suiteResults)
      : {
          overall_gate: suiteResults[0].gate.overall_gate,
          suites: { [suiteResults[0].name]: suiteResults[0].gate },
          failed_suites:
            suiteResults[0].gate.overall_gate === "PASS"
              ? []
              : [suiteResults[0].name],
          privacy_gate: suiteResults[0].gate.privacy_gate,
          effective_policy_gate: suiteResults[0].gate.effective_policy_gate,
          model_capability_gate: suiteResults[0].gate.model_capability_gate
        };

  const perTool = evaluatePerToolScores(records, options.thresholds);
  const critical = evaluateCriticalGates(records);
  const fixtureCompleteness = await evaluateFixtureCompleteness(records);

  const overall =
    combined.overall_gate === "PASS" &&
    critical.gate === "PASS" &&
    perTool.overall_gate === "PASS" &&
    fixtureCompleteness.gate !== "FAIL"
      ? "PASS"
      : "FAIL";

  return {
    schema_version: "1.1",
    scorer: "scripts/c0/score-tool-jsonl.mjs",
    scored_at_utc: new Date().toISOString(),
    jsonl_path: path
      .relative(root, path.resolve(jsonlPath))
      .split(path.sep)
      .join("/"),
    jsonl_sha256: createHash("sha256").update(text).digest("hex"),
    sample_count: records.length,
    suites: Object.fromEntries(
      suiteResults.map((suite) => [
        suite.name,
        { ...suite.gate, sample_count: suite.sample_count }
      ])
    ),
    combined_gate: combined,
    per_tool: perTool,
    critical_gates: critical,
    fixture_completeness: fixtureCompleteness,
    overall_gate: overall,
    trust_note:
      "Recomputed from expected fields plus raw, normalized and effective arguments. Self-reported booleans are ignored. Raw completeness is diagnostic; normalized arguments gate model capability; effective arguments gate business safety. Per-tool and critical failures block overall PASS."
  };
}

/**
 * Detect formal eval contract from JSONL.
 * v2 is the formal default suite family; historical v1 rescore remains supported.
 */
function detectEvalContract(records) {
  const contracts = new Set(
    records
      .map((record) => record.scoring_contract ?? record.eval_contract)
      .filter(Boolean)
      .map((value) => String(value).toLowerCase())
  );
  if (contracts.has("v2")) return "v2";
  if (contracts.has("v1")) return "v1";

  const suites = new Set(records.map((record) => record.suite).filter(Boolean));
  if (
    suites.has("v2-regression") ||
    suites.has("v2-holdout") ||
    suites.has("hidden-v2") ||
    suites.has("hidden-v3") ||
    suites.has("hidden-v4") ||
    suites.has("hidden-v5") ||
    suites.has("hidden-v6") ||
    suites.has("hidden-v7") ||
    suites.has("hidden-v8") ||
    suites.has("hidden-v9") ||
    suites.has("hidden-v10")
  ) {
    return "v2";
  }
  if (
    suites.has("regression") ||
    suites.has("holdout-v1") ||
    suites.has("hidden-v1")
  ) {
    return "v1";
  }
  return "v1";
}

async function evaluateFixtureCompleteness(records) {
  const formal = records.some(
    (record) =>
      record.stage === "C0-B" ||
      /^3\.\d+$/.test(String(record.schema_version ?? ""))
  );
  if (!formal) {
    return {
      gate: "NOT_APPLICABLE",
      failures: [],
      note: "Fixture completeness is enforced for formal C0-B records."
    };
  }

  const freeze = JSON.parse(
    await readFile(path.join(root, "fixtures/c0/FIXTURE_FREEZE.json"), "utf8")
  );
  const evalContract = detectEvalContract(records);
  let expectedSuites;
  if (evalContract === "v2") {
    const regression = JSON.parse(
      await readFile(path.join(root, freeze.v2_regression_path), "utf8")
    );
    const holdout = JSON.parse(
      await readFile(path.join(root, freeze.v2_holdout_path), "utf8")
    );
    const hiddenSuite = selectV2HiddenSuite(records, freeze);
    const hiddenManifest = JSON.parse(
      await readFile(
        path.join(root, hiddenSuite.config.manifest_path),
        "utf8"
      )
    );
    expectedSuites = [
      {
        name: "v2-regression",
        aliases: ["v2-regression", "public_regression_v2"],
        sha256: freeze.v2_regression_sha256,
        ids: regression.scenarios.map((scenario) => scenario.id)
      },
      {
        name: "v2-holdout",
        aliases: ["v2-holdout", "public_validation_v2"],
        sha256: freeze.v2_holdout_sha256,
        ids: holdout.scenarios.map((scenario) => scenario.id)
      },
      {
        name: hiddenSuite.name,
        aliases: hiddenSuite.aliases,
        sha256: hiddenManifest.full_suite_sha256,
        ids: hiddenManifest.cases.map((scenario) => scenario.id)
      }
    ];
  } else {
    const regression = JSON.parse(
      await readFile(path.join(root, freeze.regression_path), "utf8")
    );
    const holdout = JSON.parse(
      await readFile(path.join(root, freeze.holdout_v1_path), "utf8")
    );
    const hiddenManifest = JSON.parse(
      await readFile(
        path.join(root, freeze.hidden_suite.manifest_path),
        "utf8"
      )
    );
    expectedSuites = [
      {
        name: "regression",
        aliases: ["regression", "public_regression"],
        sha256: freeze.regression_sha256,
        ids: regression.scenarios.map((scenario) => scenario.id)
      },
      {
        name: "holdout-v1",
        aliases: ["holdout-v1", "public_validation"],
        sha256: freeze.holdout_v1_sha256,
        ids: holdout.scenarios.map((scenario) => scenario.id)
      },
      {
        name: "hidden-v1",
        aliases: ["hidden-v1", "hidden_blind"],
        sha256: hiddenManifest.full_suite_sha256,
        ids: hiddenManifest.cases.map((scenario) => scenario.id)
      }
    ];
  }

  const failures = [];
  const suites = {};
  for (const expected of expectedSuites) {
    const suiteRecords = records.filter((record) =>
      expected.aliases.includes(record.suite)
    );
    const actualIds = suiteRecords.map((record) => record.case_id).sort();
    const expectedIds = [...expected.ids].sort();
    const duplicateIds = actualIds.filter(
      (id, index) => actualIds.indexOf(id) !== index
    );
    const idsMatch = jsonArraysEqual(actualIds, expectedIds);
    const shaMatch =
      suiteRecords.length > 0 &&
      suiteRecords.every(
        (record) => record.fixture_sha256 === expected.sha256
      );
    if (!idsMatch) failures.push(`${expected.name}:case_ids`);
    if (duplicateIds.length > 0) {
      failures.push(`${expected.name}:duplicate_case_ids`);
    }
    if (!shaMatch) failures.push(`${expected.name}:fixture_sha256`);
    suites[expected.name] = {
      expected_count: expectedIds.length,
      actual_count: actualIds.length,
      case_ids_match: idsMatch,
      fixture_sha256_match: shaMatch
    };
  }

  return {
    gate: failures.length === 0 ? "PASS" : "FAIL",
    failures,
    suites,
    eval_contract: evalContract,
    note:
      evalContract === "v2"
        ? `Formal v2 scoring requires frozen public v2 regression, v2 holdout, and ${expectedSuites[2].name} with exact case ids and fixture checksums. Historical hidden versions remain independently rescoreable when present in the JSONL.`
        : "Formal v1 scoring requires the frozen public regression, public validation, and sealed hidden-v1 suites with exact case ids and fixture checksums."
  };
}

function selectV2HiddenSuite(records, freeze) {
  const suites = new Set(
    records
      .map((record) => String(record.suite ?? "").toLowerCase())
      .filter(Boolean)
  );
  const candidates = [
    {
      version: "v10",
      key: "hidden_suite_v10",
      aliases: ["hidden-v10", "hidden_blind_v10", "reviewed_validation_v10"]
    },
    {
      version: "v9",
      key: "hidden_suite_v9",
      aliases: ["hidden-v9", "hidden_blind_v9", "reviewed_validation_v9"]
    },
    {
      version: "v8",
      key: "hidden_suite_v8",
      aliases: ["hidden-v8", "hidden_blind_v8", "reviewed_validation_v8"]
    },
    {
      version: "v7",
      key: "hidden_suite_v7",
      aliases: ["hidden-v7", "hidden_blind_v7", "reviewed_validation_v7"]
    },
    {
      version: "v6",
      key: "hidden_suite_v6",
      aliases: ["hidden-v6", "hidden_blind_v6", "reviewed_validation_v6"]
    },
    {
      version: "v5",
      key: "hidden_suite_v5",
      aliases: ["hidden-v5", "hidden_blind_v5", "reviewed_validation_v5"]
    },
    {
      version: "v4",
      key: "hidden_suite_v4",
      aliases: [
        "hidden-v4",
        "hidden_blind_v4",
        "reviewed_validation_v4"
      ]
    },
    {
      version: "v3",
      key: "hidden_suite_v3",
      aliases: ["hidden-v3", "tuned_validation_v3"]
    },
    {
      version: "v2",
      key: "hidden_suite_v2",
      aliases: ["hidden-v2", "locked_validation_v2"]
    }
  ];
  const selected =
    candidates.find((candidate) =>
      candidate.aliases.some((alias) => suites.has(alias))
    ) ?? candidates[0];
  const config = freeze[selected.key];
  if (!config?.manifest_path) {
    throw new Error(`Missing freeze entry for hidden-${selected.version}.`);
  }
  return {
    name: `hidden-${selected.version}`,
    aliases: selected.aliases,
    config
  };
}

function jsonArraysEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function parseArgs(argv) {
  const out = { jsonl: null, write: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--jsonl") out.jsonl = argv[++i];
    else if (argv[i] === "--write") out.write = argv[++i];
  }
  return out;
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.jsonl) {
    console.error(
      "Usage: node scripts/c0/score-tool-jsonl.mjs --jsonl <file> [--write out.json]"
    );
    process.exit(1);
  }
  const report = await scoreToolJsonl(args.jsonl);
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (args.write) {
    await writeFile(args.write, text, "utf8");
  }
  process.stdout.write(text);
  process.exitCode = report.overall_gate === "PASS" ? 0 : 2;
}
