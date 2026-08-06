#!/usr/bin/env bash
# Pack the source needed to build the product provider on the Radeon Notebook.
set -euo pipefail
export COPYFILE_DISABLE=1
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
OUT="${1:-/tmp/privateplate-c0b.tgz}"

cd "${ROOT}"
commit="$(git rev-parse HEAD)"
dirty_source="$(git status --porcelain --untracked-files=all -- . ':(exclude)benchmarks/c0/stage-b/privateplate-*')"
if [[ -n "${dirty_source}" ]]; then
  echo "Refusing to pack C0-B source from a dirty worktree." >&2
  exit 1
fi

node -e '
  const { readFileSync } = require("node:fs");
  const freeze = JSON.parse(readFileSync(process.argv[1], "utf8"));
  const config = freeze.hidden_suite_v10;
  const manifest = JSON.parse(readFileSync(process.argv[2], "utf8"));
  if (
    config?.status !== "SEALED" ||
    config.role !== "hidden_blind_v10" ||
    manifest.suite !== "hidden-v10" ||
    manifest.role !== config.role ||
    manifest.full_suite_sha256 !== config.full_suite_sha256 ||
    manifest.product_baseline_commit !== config.product_baseline_commit
  ) {
    throw new Error(
      "No active sealed baseline-bound blind suite. hidden-v10 is reviewed history and cannot be packaged for a new formal run. Seal a new hidden suite first."
    );
  }
' "${ROOT}/fixtures/c0/FIXTURE_FREEZE.json" \
  "${ROOT}/fixtures/c0/hidden/v10/manifest.json"

metadata_dir="$(mktemp -d)"
trap 'rm -rf "${metadata_dir}"' EXIT
archive_root="${metadata_dir}/privateplate"
mkdir -p "${archive_root}"

git archive --format=tar HEAD \
  apps \
  packages \
  scripts/c0 \
  fixtures/c0 \
  fixtures/foods \
  fixtures/household \
  fixtures/meal-templates \
  fixtures/knowledge \
  fixtures/MANIFEST.json \
  benchmarks/c0/stage-b/README.md \
  AGENT_CONTEXT.md \
  PRIVATEPLATE_HACKATHON_PRD_V1.md \
  PRIVATEPLATE_CODEX_BUILD_SPEC_V1.md \
  docs/evidence/MODEL_AND_RADEON_STATUS.md \
  docs/evidence/RADEON_RUNBOOK.md \
  docs/submission/AMD_RADEON_ROCM_ADAPTATION_AND_OPTIMIZATION.md \
  package.json \
  package-lock.json \
  tsconfig.base.json \
  README.md \
  .gitignore |
  tar -xf - -C "${archive_root}"

# Formal packages include only the active sealed suite. Reviewed hidden
# histories remain in Git for audit, but their plaintext is never repackaged.
# Historical v1 evidence is rescored offline and does not need hidden plaintext.
pack_hidden_suite() {
  local version="$1"
  local hidden_suite="${ROOT}/fixtures/c0/hidden/${version}/scenarios.full.json"
  local hidden_manifest="${ROOT}/fixtures/c0/hidden/${version}/manifest.json"
  if [[ ! -s "${hidden_suite}" ]]; then
    echo "Sealed hidden suite is required for a formal package: ${hidden_suite}" >&2
    exit 1
  fi
  if [[ ! -s "${hidden_manifest}" ]]; then
    echo "Hidden suite manifest is required for a formal package: ${hidden_manifest}" >&2
    exit 1
  fi
  node -e '
    const { createHash } = require("node:crypto");
    const { readFileSync } = require("node:fs");
    const suite = readFileSync(process.argv[1]);
    const manifest = JSON.parse(readFileSync(process.argv[2], "utf8"));
    const actual = createHash("sha256").update(suite).digest("hex");
    if (actual !== manifest.full_suite_sha256) {
      throw new Error(`Hidden suite SHA mismatch (${process.argv[3]}): ${actual}`);
    }
  ' "${hidden_suite}" "${hidden_manifest}" "${version}"
  mkdir -p "${archive_root}/fixtures/c0/hidden/${version}"
  cp "${hidden_suite}" \
    "${archive_root}/fixtures/c0/hidden/${version}/scenarios.full.json"
  cp "${hidden_manifest}" \
    "${archive_root}/fixtures/c0/hidden/${version}/manifest.json"
}

pack_hidden_suite "v10"

node -e '
  const { writeFileSync } = require("node:fs");
  writeFileSync(
    process.argv[1],
    JSON.stringify({
      schema_version: "1.0",
      git_commit: process.argv[2],
      git_dirty: false,
      packed_at_utc: new Date().toISOString()
    }, null, 2) + "\n"
  );
' "${archive_root}/PRIVATEPLATE_SOURCE_PROVENANCE.json" "${commit}"

node scripts/c0/stage-b/source-integrity.mjs \
  generate \
  "${archive_root}" \
  "${commit}"

tar czf "${OUT}" -C "${archive_root}" .

ls -lh "${OUT}"
echo "Packed clean commit ${commit}"
echo "Upload ${OUT} to the instance, then extract it and run: bash scripts/c0/stage-b/run-all.sh"
