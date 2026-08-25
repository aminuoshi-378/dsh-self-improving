# 变更日志

`dsh-self-improving` 的所有显著变更都记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)，本仓库遵循 [语义化版本](https://semver.org/spec/v2.0.0.html)。

## [Unreleased]

### 新增
- **`dsh-rule-enforcement` 插件包** — 用户软规则注入
  - 极简插件：把用户编辑的一段 markdown 软规则文本（经 `$DSH_HOME/settings.yaml` 或 WebUI 修改）作为**建议**注入 agent 系统提示词（`systemPrompt.section`，order 100）
  - 仅软规则：移除硬性红色拦截规则
  - 热加载：改动无需重启即生效（`settings.watch`）
  - `dsh-rule-enforcement-gui@0.1.3` — WebUI Rules 编辑页（Settings → Plugins → Rules）
    - 通过 `ctx.settingsScope.bind` 读写（修复：`Cannot read properties of undefined (reading 'save')` — slot 系统把 inject 注入面平铺成顶层 props，而非嵌套 `inject` 对象）
  - 文档：精简中英文 README（只保留命令与简要说明）
  - 修复：`getRulesFilePath` 测试改用 `normalize()` 进行跨平台路径分隔符比较（Windows 上原会失败）
  - 文档：按 AGENTS.md 恢复英文 `README.md` 并与 `README.zh-CN.md` 同步；GUI 子 README 不再硬编码过时的 tarball 版本号
  - 修复：`better-sqlite3@11` → `^12.11.1`，并新增 `.npmrc`（npmmirror 预编译镜像），使原生模块在 Node 24 下无需 VS C++ 工具链即可安装（v11 无 Node-24 预编译，会回退到失败的 `node-gyp`）

### 本次安装插件的实战经验（Windows / Node 环境）
整个 `dsh plugin` 安装链路在 Windows 上踩过的坑与改动，均已有对应修复：
1. **Node 版本**：dsh 依赖的 `better-sqlite3@11` 无 Node 24 预编译；本仓库已升到 `@12` 支持 Node 24；而 dsh 仓库内部仍锁 v11，需切到 **Node 22**（自带 abi127 预编译）。已在用户环境装 nvm-windows + Node 22.20.0，并把 nvm 符号链接目录前置到系统 PATH。
2. **预编译二进制镜像**：better-sqlite3 默认从 GitHub 下载，国内常 `ECONNRESET`/`Request timed out`。修复：`.npmrc` 设 `better_sqlite3_binary_host=https://registry.npmmirror.com/-/binary/better-sqlite3`。**注意 host 必须带包名段** `/binary/better-sqlite3`（仅 `/binary` 会拼出错误 URL）。
3. **`allowBuilds`**：dsh profile（`~/.dsh/profiles/web/pnpm-workspace.yaml`）里 `better-sqlite3: set this to true or false` 是待填占位符，pnpm 因此忽略构建脚本报 `ERR_PNPM_IGNORED_BUILDS`。修复：改为 `better-sqlite3: true`。
4. **端口占用**：若已有残留的旧 dsh web 进程占用 `127.0.0.1:3080`，重启会 `EADDRINUSE`。需停掉旧进程后再 `dsh web`。

### 计划中
- **阶段 4** — 自适应策略调整（Adaptive Strategy Adjustment）
  - `agent/request` 瀑布：基于历史成功率选择模型
  - `tools/restrict`：基于历史使用模式推荐工具
  - `repeat-tool-reminder` 守卫阈值自适应

### 文档与规划
- `docs/design.md` 全篇译为中文，与既有中文 README 保持一致
- `todo.md` 重构：按主题域去重重组，并新增「前置项」，明确任务边界（有 goal 按 goal 聚合 / 无 goal 按多步工具簇 / 纯问答不存储）与存储单元；评审引入分层记忆、冲突裁决、提炼升华方向（对应 P6 建议）
- 移除 `src/index.ts` 中未使用的 `createHash` import（还原占位残迹，避免提交空 import）

## [0.1.0] - 2026-08-23

### 新增
- **阶段 1 — 经验库 + 结果评分器（最小闭环）**
  - 基于 SQLite 的 `ExperienceStore`（复用会话持久化基础设施）
    - 表结构：`(context_hash, task_pattern, tools_used, workspace_digest, actions, outcome_score, user_feedback, lesson, tags, confidence, reuse_count)`
    - 索引：`context_hash`、`task_pattern`、`outcome_score DESC`
    - 保留策略：最近 1000 条；按 `outcome_score` + 新近度淘汰
    - 置信度衰减：未再次验证则随复用次数权重递减
  - `OutcomeEvaluator`（第 1 层）— 只读回合评分器
    - 挂载到 `agent/turn-stopping`（串行）
    - 输入：`goalProgress`、`toolCallCount`、`toolSuccessRate`、`guardTriggerCount`、`userFeedback`
    - 输出：加权综合 `outcomeScore`（0.0–1.0），基于 `SCORE_WEIGHTS`
  - 7 个存储测试 + 6 个评分器测试

- **阶段 2 — 行为适配器（建议性经验注入）**
  - `BehaviorAdapter`（第 2 层）— 三个注入点
    - `agent/pre-step`（waterfall）："过去经验" markdown 块（必须调用 `next()`）
    - `system-prompt/assemble`：动态 `Learned Preferences` 段（order 450）
    - `agent/request`（waterfall）：按历史成功率选择模型/参数
  - 上下文指纹模糊匹配（任务模式 + 工具组合 + 工作区摘要）
  - 从累积反馈中提取偏好
  - 8 个适配器测试

- **阶段 3 — 元认知引擎（LLM 反思）**
  - `MetaCognitionEngine`（第 4 层）
    - 挂载到 `turn/end`（durable）→ 入队反思
    - 挂载到 `agent/run-maintenance` → 异步处理队列（空闲时间）
    - 使用低成本 `deepseek-chat`（而非 `deepseek-reasoner`）以控制开销
    - 生成 `{what_worked, what_failed, what_to_try_differently, reusable_lesson}`
    - 写 `lesson` 到经验库，再次验证时提升置信度
  - 可选：通过 `metaCognitionEnabled: false` 关闭；阶段 1–3 仍构成完整闭环
  - 8 个元认知测试

- **插件入口** — `apply(ctx, config)` Cordis 插件
  - 优雅降级：当 `ctx.on` / `ctx.systemPrompt` / `ctx.effect` 缺失时（独立测试模式）所有层变为 no-op
  - 自动清理：插件卸载时关闭存储
  - 配置 schema：`dbPath`、`metaCognitionEnabled`、`behaviorAdapterEnabled`、`maxRecords`、`minInjectionScore`

- **基准测试套件**（A/B 对比）
  - `benchmark/task-suite.ts` — 20 个预定义 agent 任务场景（含最优路径）
  - `benchmark/sim-agent.ts` — 模拟 agent（有/无经验模式）
  - `benchmark/run-benchmark.ts` — 运行器 + HTML 报告生成器
  - 输出 `benchmark-report.html` / `benchmark-report.json`

- **文档**
  - `README.md` — 概述、结构、快速上手、挂载指南
  - `docs/design.md` — 完整四层架构、安全边界、分阶段实施路径
  - `docs/plugin-dev-notes.md` — 从代码库提炼的 dsh 插件开发实用规范

- **挂载配置** — `cordis.yml`，用于 dsh profile 集成

### 安全
- 所有注入均为**建议性**（模型可听从或忽略）— 不强制修改配置
- 评分器为**只读** — 绝不修改 agent 行为或回合输出
- 经验库**仅本地**（与会话日志同信任边界）；无显式 opt-in 不外传遥测
- 插件**可卸载** — 卸载后 agent 完全恢复确定性行为

### 依赖
- 运行时：`@langchain/core`、`agentevals`、`better-sqlite3`、`promptfoo`、`ulid`
- 开发：`tsx`、`typescript` 5.6、`@types/node`、`@types/better-sqlite3`
- Node 引擎：`>=20.0.0`

[Unreleased]: https://github.com/aminuoshi-378/dsh-self-improving/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/aminuoshi-378/dsh-self-improving/releases/tag/v0.1.0
