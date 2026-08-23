# dsh-ai-enhancements

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）定制的插件集合，共两个插件包，各自可**独立安装**或**一起安装**：

1. **[`dsh-self-improving/`](#1-dsh-self-improving--跨会话学习)** — 跨会话**自学习层**
2. **[`dsh-rule-enforcement/`](#2-dsh-rule-enforcement--跨项目规则)** — 用户**软规则**引擎

> 文档：[设计文档](docs/design.md) · [插件开发笔记](docs/plugin-dev-notes.md) · [CHANGELOG](CHANGELOG.md)
> English: [README.md](README.md)

***

## 1. `dsh-self-improving/` — 跨会话学习

补上 dsh 缺失的**跨会话学习**。dsh 有完整的运行时自修改能力（`cordis_*` 工具集），但没有学习层：反馈被收集却从不消费、行为参数静态、动态插件重启即失。

本包在确定性循环**之上**加学习层，通过既有扩展点注入，**不修改循环本身**。

### 架构

```
Layer 4: 元认知引擎 (Meta-Cognition)      — 反思回合、提取教训（异步、空闲时跑）
Layer 3: 经验库 (Experience Store)         — 跨会话持久记忆（SQLite）
Layer 2: 行为适配器 (Behavior Adapter)     — 注入所学经验（建议性）
Layer 1: 结果评估器 (Outcome Evaluator)    — 给每回合打分（agent/turn-stopping，只读）
Layer 0: 现有的确定性循环                 — 不变
```

所有注入都是**建议性**的（模型可采纳可忽略）。卸载插件即恢复完全确定性行为。

### 结构

```
src/
├── types/index.ts                    # 共享类型（TurnOutcome, ExperienceRecord, …）
├── store/experience-store.ts         # Layer 3: SQLite 持久记忆
├── evaluator/outcome-evaluator.ts    # Layer 1: 只读回合打分
├── adapter/behavior-adapter.ts       # Layer 2: 建议性经验/偏好注入
├── meta-cognition/meta-cognition-engine.ts # Layer 4: LLM 反思 + 教训提取
└── index.ts                          # 插件入口（apply + 导出）
test/    # 7 + 6 + 8 + 8 个单测，全部通过
benchmark/  # 20 个场景，模拟 A/B 运行器 + HTML 报告
cordis.yml  # dsh 挂载配置
```

### 快速开始

```bash
npm install
npm test
npm run benchmark   # 然后浏览器打开 benchmark-report.html
```

### 在 dsh 中挂载

```yaml
- insert:
    - id: self-improving
      name: dsh-self-improving
      config:
        dbPath: ~/.dsh/experiences.db
        metaCognitionEnabled: true
        behaviorAdapterEnabled: true
        maxRecords: 1000
        minInjectionScore: 0.3
```

### 运作原理

1. **评估** — `OutcomeEvaluator` 在 `agent/turn-stopping` 给每回合打分（目标推进、工具成功率、guard、用户反馈）→ 写入经验库。
2. **注入** — `BehaviorAdapter` 在 `agent/pre-step` 检索相似历史经验（"Past Experience" 块），并在 `system-prompt/assemble` 追加 "Learned Preferences"。
3. **反思** — 空闲时 `MetaCognitionEngine` 用低成本 `deepseek-chat` 对已关闭回合做结构化反思，回写可复用 `lesson`。
4. **保鲜** — 保留最近 1000 条；置信度随复用衰减，除非被新正向结果重新验证。

| 挂载点                      | 模式        | 角色       |
| ------------------------ | --------- | -------- |
| `agent/turn-stopping`    | serial    | 评估器打分    |
| `agent/pre-step`         | waterfall | 注入经验     |
| `system-prompt/assemble` | section   | 注入学习到的偏好 |
| `turn/end`               | durable   | 排队待反思    |
| `agent/run-maintenance`  | event     | 处理反思队列   |
| 插件卸载                     | effect    | 关闭经验库    |

### 现状

Phase 1–3 已实现，29 个测试通过。Phase 4（自适应策略）待做。

***

## 2. `dsh-rule-enforcement/` — 用户软规则注入

一个极简插件：把**一段用户在 WebUI 编辑的文本**（markdown）作为建议注入
agent 的系统提示词，模型可采纳也可忽略。

- 用户编辑入口：Settings → `dsh-rule-enforcement` 的 `rules` 字段
- 内容存 `$DSH_HOME/settings.yaml`，改动**即时生效**（无需重启）
- 唯一依赖 dsh 服务：`settings`（存文本）+ `systemPrompt`（注入）

### 安装

```bash
cd dsh-rule-enforcement
pnpm install        # 装依赖
pnpm run build      # 构建 → dist/
pnpm pack           # 打包 → dsh-rule-enforcement-0.1.4.tgz
dsh plugin --profile web add D:\绝对路径\dsh-rule-enforcement-0.1.4.tgz   # 装进 web profile
```

- tarball 用**绝对路径**
- 重复装同一版本先 `dsh plugin --profile web remove dsh-rule-enforcement`
- `pnpm install` 报 `esbuild` 时，`pnpm-workspace.yaml` 加 `allowBuilds: { esbuild: true }`

### WebUI 编辑面板（可选）

Rules 编辑面板是另一个独立的 GUI 插件，在 `src/gui` 下同样地构建、打包、安装：

```bash
cd dsh-rule-enforcement/src/gui
pnpm install        # 装依赖
pnpm run build      # 构建 → lib/
pnpm run bundle     # 打包客户端 → lib/client.js
pnpm pack           # 打 tarball → dsh-rule-enforcement-gui-版本号.tgz
dsh plugin --profile web add D:\绝对路径\dsh-rule-enforcement-gui-0.1.3.tgz   # 装进 web profile
```

重启 `dsh web` 后，在 设置 → 插件 → **Rules** 里编辑规则。

### 配置

```yaml
# settings.yaml 里插件的 namespace
dsh-rule-enforcement:
  rules: |
    # 你希望 agent 遵守的规则（markdown，注入系统提示词）
    - 用中文回复
    - 提交前先整理 CHANGELOG
```

### 开发

```bash
cd dsh-rule-enforcement
pnpm install
pnpm run typecheck
pnpm test
```

***

## 组合安装

两个包可在同一 profile 里共存——直接在 `cordis.patch.yml` 里并列 insert（dsh 的常规插件组合方式）：

```yaml
- insert:
    - id: self-improving            # 来自 dsh-self-improving
      name: dsh-self-improving
      config: { ... }
    - id: dsh-rule-enforcement      # 来自 dsh-rule-enforcement（软规则）
      name: dsh-rule-enforcement
      config: { ... }
```

一个"一举挂两个"的顶层 preset 包**未实现**——但 dsh 里也不需要，其 profile 组合本身就已扮演顶层 preset 的角色。
