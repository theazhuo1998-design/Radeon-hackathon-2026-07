# PrivatePlate Track 2 Submission Pack

This directory contains the judge-facing materials and the internal assembly checklist for the AMD AI DevMaster 2026 Track 2 submission.

The primary judge-facing sources of truth are:

1. [`../../README.md`](../../README.md)
2. [`PROJECT_SPECIFICATION.md`](./PROJECT_SPECIFICATION.md)
3. [`AMD_RADEON_ROCM_ADAPTATION_AND_OPTIMIZATION.md`](./AMD_RADEON_ROCM_ADAPTATION_AND_OPTIMIZATION.md)
4. [`CLAIM_EVIDENCE_MATRIX.md`](./CLAIM_EVIDENCE_MATRIX.md)
5. [`PR_BODY.md`](./PR_BODY.md)

Chinese drafts, narration notes, and storyboards are internal production aids. When they conflict with the English files above, the English files win.

## Official requirement map

| # | Track 2 requirement | Artifact | Current status |
| --- | --- | --- | --- |
| 1 | Project Specification Document | [`PROJECT_SPECIFICATION.md`](./PROJECT_SPECIFICATION.md) | Ready in English |
| 1a | Application scenarios | Spec Section 1 | Ready |
| 1b | Agent architecture diagram | Spec Section 2 and root README | Ready; corrected to nine tools |
| 1c | Core capabilities | Spec Section 3 | Ready; media and caregiver boundaries stated accurately |
| 1d | Model and local deployment plan | Spec Section 4 and root README | Ready; self-hosted Radeon node wording used |
| 1e | AMD Radeon inference optimization | Radeon adaptation document | Ready as project-recorded measurements; raw latest run directories remain absent |
| 2 | Complete source code | Must be included in the official contest pull request | **Manual blocking action** |
| 2a | README with environment, startup, dependencies | Root README | Ready |
| 3 | Demo video showing a real Radeon-backed run | YouTube demo linked from the root README | URL present; visibility, duration, and final content need manual verification |
| 4 | One supplementary PPT | [`PrivatePlate_Track2_Submission.pptx`](./PrivatePlate_Track2_Submission.pptx) | PPT only (poster not submitted) |

## Correct submission language

Use these statements consistently:

- PrivatePlate runs self-hosted vLLM inference on an AMD Radeon node through ROCm.
- The application uses loopback model endpoints and does not call a third-party hosted model API.
- The Agent has nine model-visible read, compute, or preview tools and no `commit_*` tool.
- Persistent writes require a separate user-confirmation route.
- Caregiver handoff is a confirmed write to a local simulated inbox, not real external delivery.
- Diagnostic re-run: Model 21/21 · Product **17/21** · Safety 21/21; internal suite remains `FAIL` (project-owned 95% Product gate, not Track 2 scoring).
- Not a blind formal score (`notABlindClaim`).
- Prefix caching and trusted terminal presentation are project-recorded controlled A/B measurements.
- Evidence lives under `benchmarks/` (sealed diagnostic + two A/B result trees; per-case SQLite omitted).

Do not use:

- eight tools;
- everything runs on one physical local machine;
- sent to the caregiver;
- audio fully verified;
- all evaluation gates passed / Product passed;
- blind 21/21 result;
- open source while the repository remains `UNLICENSED`.

## Final pull request workflow

1. Fork or update the official contest repository.
2. Copy the complete clean project source into the contest submission branch. Do not replace the source submission with a link to the private development repository.
3. Exclude secrets, local databases, dependency directories, model weights, and private tokens.
4. Keep the judge-facing project README and documents in English.
5. Use the title: `Track 2, Thea Zhuo, PrivatePlate`.
6. Paste [`PR_BODY.md`](./PR_BODY.md) into the pull request description.
7. Verify every relative path from the contest pull request, especially the Spec, Radeon document, PPT, and claim-evidence matrix.
8. Open the unlisted video in a logged-out/private browser window and confirm that it plays.
9. Confirm that the video visibly includes the application flow, Radeon/vLLM evidence, and the final result.
10. Decide whether to add sanitized raw result artifacts. When they are not added, keep the evidence-scope note beside the performance figures.
11. Review the existing binary PPT for stale wording. The current Markdown audit cannot guarantee that the already-generated `.pptx` reflects the corrected nine-tool and evidence language.
12. Decide whether to add a license. Do not change `UNLICENSED` casually, because selecting a license is an owner decision.
13. Read the full diff in the contest fork before opening the pull request.

## Artifact inventory

| Artifact | Role | Authority |
| --- | --- | --- |
| [`PROJECT_SPECIFICATION.md`](./PROJECT_SPECIFICATION.md) | Required project specification | Judge-facing source of truth |
| [`AMD_RADEON_ROCM_ADAPTATION_AND_OPTIMIZATION.md`](./AMD_RADEON_ROCM_ADAPTATION_AND_OPTIMIZATION.md) | Radeon deployment and speed evidence | Judge-facing source of truth |
| [`CLAIM_EVIDENCE_MATRIX.md`](./CLAIM_EVIDENCE_MATRIX.md) | Audit trail for major claims | Internal review and optional transparency appendix |
| [`PR_BODY.md`](./PR_BODY.md) | Contest PR description draft | Judge-facing source of truth |
| [`PrivatePlate_Track2_Submission.pptx`](./PrivatePlate_Track2_Submission.pptx) | Supplementary presentation | Needs final binary review |
| [`PPT内容稿.md`](./PPT内容稿.md) | Internal slide source copy | Internal only |
| [`演示视频分镜脚本.md`](./演示视频分镜脚本.md) | Internal recording plan | Internal only; timestamps are not authoritative |
| [`语音文本.md`](./语音文本.md) | Internal narration copy | Internal only |
| [`AMD适配与优化说明-中文导读.md`](./AMD适配与优化说明-中文导读.md) | Internal Chinese guide | Internal only |

## Evidence status

Committed evidence summaries exist under [`../evidence/`](../evidence/), including [`MODEL_AND_RADEON_STATUS.md`](../evidence/MODEL_AND_RADEON_STATUS.md).

During this audit, the following named latest raw directories were not found in the branch tree:

- `sealed-suite-diag-16k-20260804T161006Z-brfix`
- `prefix-caching-ab-retry-20260803T071404Z`
- `terminal-finalization-ab-20260803T094112Z-05`

This does not invalidate the recorded measurements. It means the current branch snapshot does not provide every per-request artifact needed for independent recalculation, so the results should be described as project-recorded measurements within the documented experimental scope.

## Current release decision

The Markdown submission pack is aligned with the current code and official Track 2 deliverables. Internal engineering thresholds are not presented as contest verdicts. The remaining work is operational:

- include the complete source in the official contest pull request;
- verify the demo video;
- correct or regenerate the binary PPT if it still uses older claims;
- choose whether to include sanitized raw evidence;
- make an explicit license decision only if desired.
