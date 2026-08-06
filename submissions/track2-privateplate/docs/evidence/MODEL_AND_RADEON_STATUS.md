# PrivatePlate 模型与 Radeon 当前证据

> 更新日期：2026-08-04
>
> 本文是当前证据结论入口。原始 JSON、日志和失败记录继续保存在 `benchmarks/`，不得修改或删除。

## 当前结论（2026-08-04，取代下方全部 v1 数字）

评测口径已从 36 题 Public Golden（v1）换成 21 条密封题集（v2）。**本节以下的 36 题数字全部是历史记录，不代表当前产品状态，不得用于对外表述。**

最新一次真实模型运行是诊断复跑 `sealed-suite-diag-16k-20260804T161006Z-brfix`（21/21 执行完成，`notABlindClaim: true`，证据目录见该 run id）。**不是盲测成绩。** 唯一正式盲测仍是 `2026-08-04T05:17Z` / 冻结提交 `d78e5fcda26331b3a8647a20751d6aa2d68e2297` / 干净工作树 / `max_model_len 8192`，成绩 model 3/21、product 4/21、safety 4/21。

| 计分栏 | 结果 | 阈值 | 门禁 |
| --- | ---: | ---: | --- |
| Model | 21/21（100%） | 85% | PASS |
| Product | 17/21（81%） | 95% | FAIL |
| Safety | 21/21（100%） | 100% | PASS（安全硬门满足） |
| 三栏全过 | **17/21** | — | — |

整体 `finalConclusion` 仍是 **FAIL**，唯一原因是 product 81% 未达 95%。真实工具调用 83/83；`infrastructureFailures: 0`，`runtimeFailures: 0`；失败根因 domain 4 / model 0。专项：`mealReasonableness` 7/10，`multiTurnObjectRecognition` 1/3，`confirmationAndIdempotency` 3/3。

相对紧邻上一轮诊断结果（product 15/21、safety 19/21），本轮提升来自 `<br>` 呈现规范化：`answer-validate.ts` 的 `extractNumbers` 在行锚定 scrub 前先把 HTML 换行转成真换行（修掉 `unproven_number:4` → 确定性兜底踩安全硬门，使 `ppb-010` 转绿、Safety 19→21）；`formatters.ts` 的 `humanizeProductText` 同步把 `<br>` 转换行并去掉 markdown 粗体。未放松任何阈值、不变量或安全检查。

剩余 4 条 product 失败（均非题集设计问题）：`ppb-005` 为钉住低脂主菜后合成菜谱无法满足父亲脂肪下限，外加修订候选集未携带现行计划菜；`ppb-006` 为全局单一 `mealPortionScale` 无法同时满足方向相反的成员约束（可行集为空），且「不得重复失败选型」守卫未触发；`ppb-008` 一锅餐例外路径 `no_valid_final_plan`（本轮未深挖）；`ppb-021` 为 `rag_source_grounded` 仍抽 `kc-*`（已退役路径），现行语料为 `doc-*` / `knowledge/corpus/*.md`，抽取器是死代码。细节见 `docs/submission/AMD_RADEON_ROCM_ADAPTATION_AND_OPTIMIZATION.md` 第 5 节。

推理速度优化证据见同文档第 6 节：prefix caching TTFT p50 −48.78%（有 vLLM 命中指标佐证），终局架构改造端到端 p50 −71.79% 且质量由 7/9 升至 9/9。

---

以下为 2026-08-02 及更早的历史记录，保留供追溯。

2026-08-03 的第一阶段 v2 评测重构只完成本地 Agent/Domain/SQLite 结构执行与评分器门禁，
没有启动或连接 Radeon，也没有新增 local_vllm 模型结果。下表和目录中的 Radeon 数字仍是历史证据，
不能代表当前工作区已重新验证；新的真实证据还必须绑定干净 commit，或完整 tree/patch SHA-256。

## 一句话结论

PrivatePlate 已在 Radeon + ROCm + vLLM 上跑通产品链路。本轮 **不增加 System Prompt** 的工程修复后最新全测：

| 提交 | 模式 | Model | Product | Safety | 产品 Agent |
| --- | --- | ---: | ---: | ---: | ---: |
| `128c6c9`（改前基线） | full diagnostic | **25/36 (69.4%)** | **25/36 (69.4%)** | 36/36 | 2/5 |
| `ea23049`（loop/预览闭环） | full diagnostic | **28/36 (77.8%)** | **28/36 (77.8%)** | 36/36 | 2/5 |
| `9daec7e`（preview vs send 收紧） | full diagnostic | **25/36 (69.4%)** | **26/36 (72.2%)** | 36/36 | 2/5 |

- 峰值工程结果：`ea23049` Model/Product **+3**（相对 128c6c9）；修了 010 重复工具、022/023 新规划、029 不可行原因、031 卡命中评分等。
- `9daec7e` 为修 009/027 发送边界回退，部分 preview COMPLETE 题短暂回落；HEAD 另有 serveAt/意图小修未再全测。
- 仍未达 85%/95%。Safety 持续 100%。

## 当前能证明什么

| 层级 | 最近结果 | 可以怎样表述 |
| --- | --- | --- |
| 本地代码 | `npm run check` 绿；loop FINAL_ONLY、预览闭环、handoff 意图 | 状态机与边界有本地测试 |
| Public Golden 规格 | 36 题结构校验通过 | 无真实模型事实时不产生模型成绩 |
| Radeon 产品链路 | loopback vLLM 可运行 | 不依赖远程模型 API |
| 最近 Radeon 峰值 | Model **28/36**，Product **28/36**，Safety 36/36 | `ea23049`；非密封盲测 |
| 结构层 | Checkpoint + TaskState + 动作授权 | 不等于自然语言全对 |

## 最近一次真实 Radeon 运行

运行目录：

`benchmarks/c0/stage-b/privateplate-gemma4-full-20260802T065519Z-9daec7e/`

- 日期：2026-08-02；提交：`9daec7e`；模式：`agent_diagnostic`
- 对照峰值：`benchmarks/c0/stage-b/privateplate-gemma4-full-20260802T064052Z-ea23049/`（Model/Product 28/36）
- 模型：`google/gemma-4-12B-it-qat-w4a16-ct` / 本机 vLLM / `gfx1100`

### 质量结果（9daec7e）

| 门 | 结果 | 阈值 | 结论 |
| --- | ---: | ---: | --- |
| 5 个产品 Agent 场景 | 2/5 | — | FAIL |
| Public Golden 模型能力 | **25/36（69.4%）** | 85% | FAIL |
| Public Golden 产品完成 | **26/36（72.2%）** | 95% | FAIL |
| Public Golden 系统安全 | 36/36（100%） | 100% | PASS |

### 峰值结果（ea23049，同日）

| 门 | 结果 |
| --- | ---: |
| Model | **28/36（77.8%）** |
| Product | **28/36（77.8%）** |
| Safety | 36/36 |

相对 128c6c9 修通/改善：010、022、023、029、031 等；残余见对话结论（模型侧为主）。

## 当前开发优先级

1. 残余失败多为 **模型选择**（模糊指代、priority/pin、无计划时 compose vs revise、犹豫不改菜），非再堆 System Prompt；
2. 少量工程可继续：serveAt 口语、handoff 意图、评分卡命中（已做一部分）；
3. 要冲 85%/95% 需要更强基座或针对性训练/蒸馏，而不是继续加提示词。

## 原始证据入口

- 峰值：`benchmarks/c0/stage-b/privateplate-gemma4-full-20260802T064052Z-ea23049/`
- 收紧边界：`benchmarks/c0/stage-b/privateplate-gemma4-full-20260802T065519Z-9daec7e/`
- 改前：`benchmarks/c0/stage-b/privateplate-gemma4-full-20260802T052512Z-128c6c9/`
- 复跑入口：`docs/evidence/RADEON_RUNBOOK.md`

未经项目所有者明确批准，不启动、连接或操作 Radeon 实例。
