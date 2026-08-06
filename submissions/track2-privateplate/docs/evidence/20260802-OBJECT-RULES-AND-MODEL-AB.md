# 对象规则修复与同协议模型 A/B（2026-08-02）

## 范围

1. 本地对象规则（priority / focus / revise noop）@ `fe96f68`。
2. **Qwen 缓存路径契约** @ `9ca7274`：校验同时识别 `$HF_HOME/hub` 与遗留 flat `$HF_HOME`。
3. 同协议 Radeon `agent_diagnostic`：
   - **A**：Gemma 4 12B QAT @ `fe96f68`
   - **B**：Qwen2.5-14B @ `9ca7274`（复跑成功）

协议相同：原生 function call、五工具 + 控制决策、Trusted policy、Gateway、Domain、评分器 v2。

## Qwen 缓存路径契约（根因与修复）

| 项 | 旧行为 | 新行为 |
| --- | --- | --- |
| `01-start-vllm.sh` | `HUGGINGFACE_HUB_CACHE` 默认 = `$HF_HOME`（无 hub/） | 默认 = `$HF_HOME/hub` |
| `06-verify-model-artifacts.mjs` | 只查 `resolveHubCache()` → 常指向 `…/hub` | `resolveModelSnapshotDir()` 搜索 hub + flat |
| 本地测试 | 无双布局覆盖 | `evidence-gates.test.mjs` 双布局集成测试 |

遗留 Qwen 权重若在 `$HF_HOME/models--Qwen--…`，校验仍可 SHA 通过；新下载写入标准 hub。

## A 组：Gemma @ fe96f68

目录：`benchmarks/c0/stage-b/privateplate-gemma4-ab-a-20260801T170747Z-fe96f68/`

| 门 | 分数 |
| --- | ---: |
| Model | 22/36（61.1%） |
| Product | 23/36（63.9%） |
| Safety | 36/36 |
| 产品 Agent | 2/5 |

## B 组：Qwen14 @ 9ca7274（复跑）

目录：`benchmarks/c0/stage-b/privateplate-qwen14-ab-b-20260802T042558Z-9ca7274/`

| 门 | 分数 |
| --- | ---: |
| 权重校验 | **PASS（8/8 SHA_VERIFIED）** |
| snapshot | `…/hub/models--Qwen--Qwen2.5-14B-Instruct/snapshots/cf98f3b3…`（或 flat 回退） |
| Model | **23/36（63.9%）** |
| Product | **20/36（55.6%）** |
| Safety | 36/36 |
| 产品 Agent | 1/5（failed_count=4） |

首次 Qwen 尝试（`…172430Z-fe96f68`）因路径契约失败，无质量分数，仅作历史。

## 对象题 A/B

| 题 | Gemma A | Qwen B |
| --- | --- | --- |
| golden-016 switch-member | FAIL | FAIL |
| golden-017 ingredient-priority | **PASS** | **PASS** |
| golden-019 this-dish | FAIL | FAIL |
| golden-021 keep-other | FAIL | **PASS** |

## 结论

1. **缓存路径契约已修好**；B 组权重 8/8 校验通过并可完整跑分。
2. 同协议下 Qwen Model 略高于 Gemma（23 vs 22），Product 低于 Gemma（20 vs 23）；两者均远低于 85%/95%。
3. 对象规则对 017 双边有效；021 上 Qwen 更好；016/019 两边仍主要是模型动作问题。
4. 不因 Qwen Model +1 而切换主候选；主路径仍是 Gemma + 结构/协议修复。

详情：`MODEL_AND_RADEON_STATUS.md`。
