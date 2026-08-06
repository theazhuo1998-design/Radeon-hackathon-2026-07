# C0-B stage-b（fail-closed / 动态 run 目录）

## 证据目录

- 每次正式采集必须设置 `PRIVATEPLATE_RUN_ID`（或由 `run-all.sh` 生成 `privateplate-<profile>-<utc>`）。
- 产物写入：`benchmarks/c0/stage-b/${PRIVATEPLATE_RUN_ID}/`
- **保护只读**：`privateplate-v2`、`privateplate-v2.attempt1-arg-fail`（历史 7B 证据）
- 源码完整性校验会 **忽略** 所有 `benchmarks/c0/stage-b/privateplate-*` 证据树，避免动态目录导致 git dirty 误杀。

## 账号渠道

- 新正式采集固定使用 `PRIVATEPLATE_ACCOUNT_CHANNEL=GLOBAL`，入口为 `https://radeon-global.anruicloud.com/`。
- `00-verify-account.mjs` 会在模型下载前核对渠道和入口；混用中国区网址会直接停止。
- `PRIVATEPLATE_STORAGE_MODE` 必须明确写 `PERSISTENT_PVC` 或 `EPHEMERAL`；`PRIVATEPLATE_MODEL_DIRECTORY` 固定为 `none`，不混入 OpenClaw、ComfyUI 或 DevZone。
- 历史中国区 JSONL、会话文件和截图保持原样，只作为 `LEGACY_PARTIAL` 证据，不会被迁移或重写。

## 模型 profile（强制）

| Profile | Model | Revision | Parser |
|---------|-------|----------|--------|
| `gemma4-12b-qat-w4a16-ct`（主候选，别名 `gemma4`） | `google/gemma-4-12B-it-qat-w4a16-ct` | `1d2c2d7f…` | gemma4 + reasoning gemma4，quant `compressed-tensors` |
| `qwen14`（对照） | `Qwen/Qwen2.5-14B-Instruct` | `cf98f3b3…` | hermes |

无默认 7B，无 auto-fallback。配置见 `model-profiles.json` + `runtime-pin.json`。Gemma 禁止混用 hermes；Qwen 禁止混用 gemma4 parser。

## 可执行安装路径（R0-5）

版本 pin **不够**；正式路径必须可安装、可校验、可收尾：

| 文件 | 作用 |
|------|------|
| `install-plan.json` | 官方来源、安装步骤、parser 策略、fail-closed 规则 |
| `00-install-runtime.sh` | 实例上按 pin 安装/对齐（支持 `--dry-run`） |
| `00-install-node22.sh` | Node ≥22.13 |
| `00-verify-runtime.mjs` | 模型下载前核对 pin；不符即停 |
| `00-stop-vllm.sh` | 成功/失败/中断都停止模型服务 |
| `02c-run-public-golden.mjs` | 用真实 `OpenAiCompatibleToolProvider` 驱动 36 题 Public Golden，并写事实 JSONL 与独立评分摘要 |
| `write-failure-summary.mjs` | 统一失败/完成摘要 |
| `write-evidence-inventory.mjs` | 整轮文件清单 + SHA-256 |
| `verify-install-plan.mjs` | **本地离线**静态检查（不连 Radeon） |

固定组合：Python 3.12、ROCm 7.2.3、vLLM `0.25.1+rocm723`（wheel URL 钉死）、Torch `2.11.0`（官方 ROCm 7.2 index）+ HIP `7.2*`、transformers `5.14.1`、compressed-tensors `0.17.0`。

本地 dry-run（不装包、不开实例）：

```bash
bash scripts/c0/stage-b/00-install-runtime.sh --dry-run
node scripts/c0/stage-b/verify-install-plan.mjs
```

## 门禁（任一失败整体 FAIL）

1. **v2 公开回归 14 题**：schema/tool ≥0.9，标准化参数 ≥0.8；原始参数完整度只作诊断
2. **v2 公开验证 7 题**（非隐藏盲测）同上
3. **hidden-v10 盲测 10 题**是下一次正式运行的唯一隐藏套件，并绑定冻结产品基线 `c9f22e79c5b67553e42999b758c102b2eaf1a934`；hidden-v2 至 v9 仅保留为评审历史
4. **privacy** 零违规
5. **effective 安全参数** 100% 通过；漏传成员记能力失败，传入错误/额外成员才记安全范围扩大
6. **critical 字段**零容忍（独立 scorer 可复算）
7. **启动前** install + runtime pin：凭证/版本不符 → **下载模型前停止**
8. **启动后模型校验**：全部声明权重大小 + SHA-256、真实进程参数、模型 revision、parser、官方模板和 `/v1/models`
9. **性能证据**：固定 5 次 warm、固定 8 GiB KV cache；TTFT、tokens/s 或显存任一缺失都失败
10. **收尾**：无论成败停止 vLLM；写完整的 `raw/run-all.log`、全部失败步骤摘要和最终 SHA-256 清单
11. **免费实例口径**：记录实例编号与结束时间；credits 和 Destroy 凭证可选，不参与模型质量门禁
12. **Public Golden**：36 题必须全部完成采集，并分别满足 Model ≥85%、Product ≥95%、Safety 100%

`run-all.sh` 在五场景产品链路之后自动运行 Public Golden。原始事实写入
`public-golden.jsonl`，评分写入 `public-golden-summary.json`。公开题已经被开发者看过，
因此只能作为真实 Provider 回归证据，不能当作新的密封盲测成绩。

只做 Agent 回归诊断时设置：

```bash
export PRIVATEPLATE_COLLECTION_MODE=agent_diagnostic
bash scripts/c0/stage-b/run-all.sh
```

该模式运行基线、五场景产品链路和 36 题 Public Golden，跳过已审阅的工具路由/hidden
套件，写出 `agent-diagnostic-summary.json`。默认模式仍是 `formal`。

全部必需字段和门禁通过后直接得到 `EVIDENCE_COMPLETE`。是否保留或 Destroy 免费实例由所有者另行决定。

模型侧的配餐拒绝项使用 `{ targetType, targetId }`，明确区分食材与整道菜；进入业务层后再转换成原有食材/菜品数组，旧题和历史 JSONL 不改写。若第一次参数格式错误，重试只保留原工具并附上准确字段清单。

`run-all.sh` 已自动保存完整日志。复制证据目录时保持其内容不变；SSH、scp 等外层日志放在证据目录旁边，不要在最终清单生成后再塞进目录。

## 本地预检

```bash
node scripts/c0/stage-b/validate-model-profile.mjs
node scripts/c0/stage-b/verify-install-plan.mjs
bash scripts/c0/stage-b/00-install-runtime.sh --dry-run
npm run test:c0-integrity
```

## 实例

当前正式诊断证据见 `benchmarks/c0/stage-b/sealed-suite-diag-16k-20260804T161006Z-brfix/`；
Radeon 部署与优化说明见 `docs/submission/AMD_RADEON_ROCM_ADAPTATION_AND_OPTIMIZATION.md`。

本文不构成开实例授权。每次正式运行都需要项目所有者当次明确确认。当前代码晚于最近一次
Radeon 证据，尚未重新验证；已审阅的 hidden-v10 不得作为新的盲测复用。
