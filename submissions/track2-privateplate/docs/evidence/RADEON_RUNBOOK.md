# Radeon 复跑入口

> 本文只说明何时可以复跑、跑前需要具备什么。它不构成开实例授权。

## 当前状态

- 当前没有可直接用于新正式成绩的密封隐藏题集；已使用的 hidden-v10 只能作为历史。
- 最近一次真实 Radeon 结果见 `MODEL_AND_RADEON_STATUS.md`，整体仍为 FAIL；名义 Product 含假阳性，不能当接近过线。
- 当前优先补齐 TaskState 生命周期与评分事实源，**不要**在结构未稳时直接做模型 A/B。
- 脏工作树不能打包正式证据；诊断可用干净提交 + `agent_diagnostic`。
- 未经项目所有者明确批准，不启动、连接或操作 Radeon 实例。

## 正式复跑前必须满足

1. 当前业务改动完成本地检查并形成一个干净提交；
2. 新建、冻结并密封一套从未被开发者查看的新隐藏题集；
3. 记录精确 commit、模型 ID、revision、镜像和运行配置；
4. 项目所有者明确授权本次 Radeon 操作；
5. 使用 `scripts/c0/stage-b/run-all.sh` 一次性采集环境、质量、性能和收尾记录；
6. 原始 JSONL、失败轮和完整日志原样保留；
7. 结果按 Model、Product、Safety 三层分别汇报，不能只报一个总分。

## 固定候选路线

- 主模型：`google/gemma-4-12B-it-qat-w4a16-ct`
- revision：`1d2c2d7f2466070e69d6fb3fd5ce9a7d75f2f6ee`
- 量化：QAT W4A16 `compressed-tensors`
- 推理：本机 loopback vLLM
- 运行时 pin：`scripts/c0/stage-b/runtime-pin.json`
- 模型 profile：`scripts/c0/stage-b/model-profiles.json`

候选路线可以由用户改，但必须在运行前决定；不能在失败后自动切换模型并把两次结果混成一次成绩。

## 本地预检

以下检查不开实例，也不连接 Radeon：

```bash
node scripts/c0/stage-b/validate-model-profile.mjs
node scripts/c0/stage-b/verify-install-plan.mjs
bash scripts/c0/stage-b/00-install-runtime.sh --dry-run
npm run test:c0-integrity
```

`pack-for-instance.sh` 会拒绝脏工作树，也会拒绝复用已审阅的 hidden-v10。只有新密封题集和冻结提交就绪后，才应调整打包清单并正式复跑。

## 复跑后的最低交付物

- 环境与精确源码来源；
- 模型文件和运行配置校验；
- 完整产品链路与逐轮工具事实；
- Public Golden 回归与新隐藏题集结果；
- TTFT、tokens/s、显存及其采样范围；
- 成功与失败的原始记录；
- vLLM 停止和证据清单。

操作细节由 `scripts/c0/stage-b/README.md` 与脚本自身维护，不在本文复制易过时的命令。
