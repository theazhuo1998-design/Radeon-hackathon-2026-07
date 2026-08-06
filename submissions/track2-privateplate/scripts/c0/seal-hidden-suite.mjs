#!/usr/bin/env node
/**
 * Seal a hidden suite from an *external or gitignored* full JSON file.
 *
 * This script intentionally does NOT embed questions or answers in source.
 * Owner maintains scenarios.full.json out-of-band (gitignored). Seal only
 * writes committed digests to manifest.json.
 *
 *   node scripts/c0/seal-hidden-suite.mjs
 *   PRIVATEPLATE_HIDDEN_SEAL_SOURCE=/path/to/full.json node scripts/c0/seal-hidden-suite.mjs
 *
 * Full file: fixtures/c0/hidden/v{1..10}/scenarios.full.json (gitignored)
 * Manifest:  fixtures/c0/hidden/v{1..10}/manifest.json (committed digests only)
 *
 *   PRIVATEPLATE_HIDDEN_SUITE_VERSION=v2 node scripts/c0/seal-hidden-suite.mjs
 */
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const suiteVersion = (process.env.PRIVATEPLATE_HIDDEN_SUITE_VERSION ?? "v1").toLowerCase();
const productBaselineCommit =
  process.env.PRIVATEPLATE_HIDDEN_BASELINE_COMMIT?.trim() ?? null;
const supportedVersions = Array.from({ length: 10 }, (_, index) => `v${index + 1}`);
const baselineBoundVersions = new Set(["v9", "v10"]);
if (!supportedVersions.includes(suiteVersion)) {
  throw new Error(
    `PRIVATEPLATE_HIDDEN_SUITE_VERSION must be v1 through v10; got ${suiteVersion}`
  );
}
if (
  baselineBoundVersions.has(suiteVersion) &&
  !/^[0-9a-f]{40}$/.test(productBaselineCommit ?? "")
) {
  throw new Error(
    `PRIVATEPLATE_HIDDEN_BASELINE_COMMIT must be the exact 40-character product commit when sealing ${suiteVersion}.`
  );
}
const outDir = path.join(root, "fixtures/c0/hidden", suiteVersion);
const defaultFull = path.join(outDir, "scenarios.full.json");
const sourcePath = process.env.PRIVATEPLATE_HIDDEN_SEAL_SOURCE
  ? path.resolve(process.env.PRIVATEPLATE_HIDDEN_SEAL_SOURCE)
  : defaultFull;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

try {
  await access(sourcePath);
} catch {
  console.error(
    JSON.stringify(
      {
        status: "FAIL",
        reason: "hidden_full_suite_missing",
        expected: sourcePath,
        note: "Hidden full text must not live in this script. Provide gitignored scenarios.full.json or PRIVATEPLATE_HIDDEN_SEAL_SOURCE."
      },
      null,
      2
    )
  );
  process.exit(2);
}

const fullText = await readFile(sourcePath, "utf8");
const suite = JSON.parse(fullText);
if (!Array.isArray(suite.scenarios) || suite.scenarios.length === 0) {
  throw new Error("Hidden suite source has no scenarios.");
}

await mkdir(outDir, { recursive: true });

// Keep gitignored full file under the standard path when sealing from elsewhere.
if (path.resolve(sourcePath) !== path.resolve(defaultFull)) {
  await writeFile(defaultFull, fullText.endsWith("\n") ? fullText : `${fullText}\n`, "utf8");
}

// Committed manifest: digests + categories only — no user_text, no expected args bodies.
const cases = suite.scenarios.map((scenario) => {
  const scoringMode =
    scenario.scoring_mode ??
    (Array.isArray(scenario.expected_card_ids) ? "retrieval_cards" : "args_exact");
  return {
    id: scenario.id,
    category: scenario.category ?? "unspecified",
    user_text_sha256: sha256(String(scenario.user_text ?? "")),
    expected_tool_sha256: scenario.expected_tool
      ? sha256(String(scenario.expected_tool))
      : null,
    expected_arguments_sha256: scenario.expected_arguments
      ? sha256(JSON.stringify(scenario.expected_arguments))
      : null,
    expected_card_ids_sha256: Array.isArray(scenario.expected_card_ids)
      ? sha256(JSON.stringify(scenario.expected_card_ids))
      : null,
    scoring_mode: scoringMode,
    top_k_explicit: scenario.top_k_explicit === true,
    expect_no_tool: Boolean(scenario.expect_no_tool),
    expect_clarification: Boolean(scenario.expect_clarification),
    expect_safe_stop_or_no_write: Boolean(scenario.expect_safe_stop_or_no_write),
    critical_field_names_sha256: sha256(
      JSON.stringify(scenario.critical_fields ?? [])
    )
  };
});

// Prefer hashing the exact on-disk bytes of scenarios.full.json for stability.
const onDiskFull = await readFile(defaultFull);
const fullSuiteSha = sha256(onDiskFull);

const suiteName = suite.suite ?? `hidden-${suiteVersion}`;
const roleByVersion = {
  v1: "hidden_blind",
  v2: "locked_validation_v2",
  v3: "tuned_validation_v3",
  v4: "reviewed_validation_v4",
  v5: "reviewed_validation_v5",
  v6: "reviewed_validation_v6",
  v7: "reviewed_validation_v7",
  v8: "reviewed_validation_v8",
  v9: "reviewed_validation_v9",
  v10: "hidden_blind_v10"
};
const noteByVersion = {
  v1: "Full plaintext is gitignored. Historical v1 args_exact contract.",
  v2: "Full plaintext is gitignored. This suite is locked validation because it participated in local development.",
  v3: "Full plaintext is gitignored. This suite is tuned validation because repeated Radeon repair runs used it.",
  v4: "Full plaintext is gitignored. This suite is reviewed validation because its Radeon results informed later fixes.",
  v5: "Full plaintext is gitignored. This suite is reviewed validation because its Radeon results informed the typed-rejection and scoring fixes.",
  v6: "Full plaintext is gitignored. This suite is reviewed validation because its Radeon results informed the requested-dish, retrieval, and pending-clarification fixes.",
  v7: "Full plaintext is gitignored. This suite is reviewed validation because its Radeon results informed transport normalization, entity grounding, and retrieval fixes.",
  v8: "Full plaintext is gitignored. Retained unchanged for audit history; its Radeon results informed the retrieval contract fixes.",
  v9: "Full plaintext is gitignored. Retained unchanged as reviewed history after the formal v9 evaluation.",
  v10: `Full plaintext is gitignored. Sealed for the next formal Radeon evaluation against product baseline ${productBaselineCommit}. Do not use it for prompt, policy, scorer, or model tuning before that evaluation.`
};
const manifest = {
  schema_version: "2.0",
  suite: suiteName,
  role: roleByVersion[suiteVersion],
  scoring_contract: suite.scoring_contract ?? suiteVersion,
  ...(baselineBoundVersions.has(suiteVersion)
    ? { product_baseline_commit: productBaselineCommit }
    : {}),
  sealed_at_utc: new Date().toISOString(),
  full_suite_path: `fixtures/c0/hidden/${suiteVersion}/scenarios.full.json`,
  full_suite_gitignored: true,
  full_suite_sha256: fullSuiteSha,
  case_count: cases.length,
  cases,
  scoring:
    "Score with scripts/c0/score-tool-jsonl.mjs on raw JSONL. Metrics recomputed; critical fields zero-tolerance. Do not trust summary PASS.",
  policy:
    "Do not embed full hidden text in repo source. Do not use for prompt engineering, LoRA, or post-hoc threshold tuning.",
  seal_source_note:
    "This seal script never contains questions or answers; it only digests an external/gitignored full suite.",
  note: noteByVersion[suiteVersion]
};

const manifestPath = path.join(outDir, "manifest.json");
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

const readmePath = path.join(outDir, "README.md");
await writeFile(
  readmePath,
  `# Hidden suite ${suiteVersion}

- **Committed:** \`manifest.json\` (digests + categories only — no prompts, no expected args)
- **Gitignored:** \`scenarios.full.json\` (full prompts + expected args)
- Re-seal digests (requires local full file): \`${baselineBoundVersions.has(suiteVersion) ? `PRIVATEPLATE_HIDDEN_SUITE_VERSION=${suiteVersion} PRIVATEPLATE_HIDDEN_BASELINE_COMMIT=<40-char-product-commit>` : `PRIVATEPLATE_HIDDEN_SUITE_VERSION=${suiteVersion}`} node scripts/c0/seal-hidden-suite.mjs\`
- Run on instance only when owner provides full suite path:
  \`PRIVATEPLATE_HIDDEN_SUITE_PATH=fixtures/c0/hidden/${suiteVersion}/scenarios.full.json\`
${baselineBoundVersions.has(suiteVersion) ? `- Product baseline commit: \`${productBaselineCommit}\`` : ""}

The seal script does **not** contain the questions or answers. Implementers must
not use a blind suite's full text for tuning. Public regression and public
validation remain the in-repo fixtures.
`,
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status: "SEALED",
      full_suite_sha256: fullSuiteSha,
      case_count: cases.length,
      manifest: path.relative(root, manifestPath),
      full: path.relative(root, defaultFull),
      product_baseline_commit: baselineBoundVersions.has(suiteVersion)
        ? productBaselineCommit
        : null,
      answers_in_script: false
    },
    null,
    2
  )
);
