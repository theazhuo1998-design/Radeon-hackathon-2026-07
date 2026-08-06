# PrivatePlate Claim-to-Code and Evidence Matrix

This file is an internal review checklist for keeping judge-facing claims aligned with the implementation. It separates:

1. behavior implemented in source code;
2. behavior covered by offline tests;
3. measurements recorded on the Radeon environment;
4. artifacts available in the current branch snapshot.

Internal engineering thresholds are not official Track 2 judging rules and must not be converted into a contest verdict.

## Status legend

| Status | Meaning |
| --- | --- |
| Implemented | The behavior exists in the current branch source code |
| Tested offline | Repository tests cover the behavior without proving a real Radeon model run |
| Radeon-recorded | A committed project record describes a real Radeon result |
| Raw artifacts present | Per-request artifacts needed to recalculate a measurement are included in this branch |
| Limited | The implementation or evidence has a stated boundary |
| Not implemented | The product does not currently provide this behavior |

## Product and architecture claims

| Claim | Source-of-truth code | Current status | Allowed wording |
| --- | --- | --- | --- |
| Product mode uses a real model provider | `apps/server/src/runtime-config.ts`; `packages/agent-runtime/src/model/provider.ts` | Implemented | Product mode uses the OpenAI-compatible `local_vllm` provider |
| Model endpoints must be loopback | `packages/agent-runtime/src/model/provider.ts` | Implemented | The application rejects non-loopback model URLs |
| No third-party hosted model API is required | Provider loopback check; Radeon serving scripts | Implemented, with deployment nuance | Self-hosted inference on a user-controlled Radeon node; an SSH tunnel may connect the app to that node |
| Everything runs on one physical local PC | No single-host guarantee in code or contest deployment | Unsupported | Do not claim this |
| Nine model-visible tools | `packages/agent-runtime/src/model/tool-definitions.ts`; `packages/agent-runtime/src/state.ts` | Implemented | Nine read, compute, or preview tools |
| The model cannot directly commit writes | Tool definitions and confirmation routes in Agent/server code | Implemented | The model has no `commit_*` tool; writes use a separate confirmation path |
| Meal planning uses deterministic nutrition and hard constraints | `packages/domain/src/**`; `finalize_meal_plan` gateway path | Implemented | The model selects; Domain validates and calculates |
| Local household persistence | SQLite-backed Domain and server state | Implemented | Household day state is stored locally in SQLite |
| Caregiver handoff | Agent preview tool and local state | Limited | Privacy-filtered preview plus confirmed local simulated inbox write |
| Real SMS, email, or external caregiver delivery | No external delivery integration | Not implemented | Do not say the task was sent to a real recipient |
| Image intake | `apps/server/src/intake-service.ts`; intake routes | Implemented, outside benchmark scope | Image intake exists in code; no Radeon benchmark claim is made for it |
| Audio intake | `apps/server/src/intake-service.ts` | Limited | Optional path; recorded environment lacked the vLLM audio dependency |
| Grocery ordering or cooking-video search | No implementation | Not implemented | Future extension only |
| Open-source project | Root `package.json` declares `UNLICENSED`; no license file is granted | Unsupported | Do not describe the repository as open source unless the owner adds a license |

## RAG claims

| Claim | Source-of-truth code or data | Current status | Allowed wording |
| --- | --- | --- | --- |
| Local knowledge corpus | `fixtures/knowledge/corpus/` | Implemented | Retrieval uses a repository-local corpus |
| Radeon-hosted embeddings | vLLM embedding configuration and scripts | Radeon-recorded | BGE embeddings were served on the Radeon node on loopback port `8001` |
| Offline hash mode is real embedding evidence | Application fallback mode | Unsupported | Hash mode is for deterministic tests only |

## Engineering validation claims

| Claim | Evidence source | Allowed wording |
| --- | --- | --- |
| Latest diagnostic: Model 21/21 | `benchmarks/c0/stage-b/sealed-suite-diag-16k-20260804T161006Z-brfix/summary.json` | Project-recorded diagnostic result; not blind |
| Latest diagnostic: Product 17/21 | Same | Project-recorded diagnostic result; internal Product gate remains **FAIL** |
| Latest diagnostic: Safety 21/21 | Same | Project-recorded diagnostic result; not an official contest score |
| Real tool calls 83/83 | Same | Project-recorded diagnostic statistic |
| Full evaluation passed | Same record says `finalConclusion=FAIL` | Do not claim a full pass |
| Latest result is a blind score | Same record / `notABlindClaim: true` | Do not claim this |
| Earlier frozen blind run | `docs/evidence/MODEL_AND_RADEON_STATUS.md` (`d78e5fc…`, 3/21 · 4/21 · 4/21) | May be described only as the earlier project-recorded blind run |
| Internal project thresholds | Engineering configuration | Guide development; not official Track 2 rules |

## Performance claims

| Claim | Committed methodology and summary | Raw artifacts in this branch | Allowed wording |
| --- | --- | --- | --- |
| Prefix caching reduces TTFT p50 by 48.78% | Radeon adaptation document | `benchmarks/prefix-caching-ab-retry-20260803T071404Z/results/` | Project-recorded controlled A/B measurement |
| Prefix caching changes generation throughput substantially | Summary shows +0.43% | Same | Do not claim a major token-generation-speed gain |
| Trusted presenter reduces target E2E p50 by 71.79% | Radeon adaptation document | `benchmarks/terminal-finalization-ab-20260803T094112Z-05/results/` | Project-recorded controlled A/B measurement |
| Trusted presenter removes the model from the Agent | Source code and methodology contradict this | Not applicable | It removes only the redundant terminal rewrite |
| Small quality check improved from 7/9 to 9/9 | Radeon adaptation document | Same terminal A/B directory | Limit the claim to the recorded nine checks |

## Official submission requirement map

| Track 2 requirement | Repository artifact | Audit status |
| --- | --- | --- |
| Application scenarios | `PROJECT_SPECIFICATION.md`, Section 1 | Ready |
| Agent architecture diagram | `PROJECT_SPECIFICATION.md`, Section 2; root `README.md` | Ready, nine-tool count corrected |
| Core capabilities | `PROJECT_SPECIFICATION.md`, Section 3 | Ready, media and caregiver boundaries corrected |
| Model introduction and local deployment plan | `PROJECT_SPECIFICATION.md`, Section 4; root `README.md` | Ready, self-hosted node wording corrected |
| AMD Radeon inference optimization | `AMD_RADEON_ROCM_ADAPTATION_AND_OPTIMIZATION.md` | Ready as project-recorded measurements within the documented scope |
| Complete source code | Must be copied into the official contest pull request | Not satisfied by a private repository link alone |
| Environment, startup, dependencies | Root `README.md` | Ready |
| Demo video | YouTube URL in root README and PR draft | URL present; final visibility and duration require manual verification |
| Supplementary PPT | `docs/submission/PrivatePlate_Track2_Submission.pptx` | PPT only; poster not part of contest submission |
| English PR and judge-facing materials | Root README, Spec, Radeon doc, PR draft | Primary materials are English |

## Submission actions

1. Include the complete project source in the official contest pull request.
2. Regenerate or manually correct the binary PPT so it uses nine tools and the current deployment wording.
3. Verify the unlisted video opens without authentication and visibly shows the Radeon-backed execution path.
4. Optionally add sanitized per-request artifacts for easier recalculation of the two optimization studies.
5. Choose a license only if the owner intends to grant one.

## Final language rules

Use these phrases consistently:

- **Use:** "self-hosted on an AMD Radeon node through ROCm and vLLM"
- **Use:** "no third-party hosted model API"
- **Use:** "nine model-visible read, compute, or preview tools"
- **Use:** "confirmed local simulated caregiver inbox write"
- **Use:** "project-recorded diagnostic re-run, not a blind result"
- **Use:** "internal suite remains FAIL because Product is 17/21"
- **Use:** "project-recorded controlled A/B measurement"
- **Use:** evidence paths under `benchmarks/…`

Avoid these phrases:

- "everything stays on one local machine"
- "eight tools"
- "sent to the caregiver"
- "audio fully verified"
- "all gates passed" / "Product passed"
- "blind 21/21 result"
- "open source" while the repository remains `UNLICENSED`
