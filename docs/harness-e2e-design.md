# Harness E2E 测试框架设计

## 解决的问题

前两轮 E2E 测试的教训：

1. **任务单一** — 固定 5 个 prompt，dsh 只需要执行，不需要"学习"。真实人类交互中会根据 agent 的输出发出纠正、追问、改需求等指令
2. **Baseline 不可比** — 无插件时工具调用计数方式不同，导致 baseline 和 enabled 的数据无法直接对比
3. **经验注入无效** — 独立任务或简单连续任务中，经验注入对 agent 完成任务没有帮助

## 核心思路

用一个 **测试 agent**（LLM）模拟人类用户的行为，驱动两个 dsh 实例对比：

```
  测试 agent (LLM)           DSH-A (with self-improving)    DSH-B (without)
  ┌─────────────┐           ┌─────────────┐               ┌─────────────┐
  │ 生成 prompt  │──prompt──→│ dsh headless │               │ dsh headless │
  │ 看输出决定   │←─output──│ (有经验注入) │               │ (无经验注入) │
  │ 下一步      │           └─────────────┘               └─────────────┘
  │             │──prompt──────────────────────────────────→│             │
  │             │←─output───────────────────────────────────│             │
  │ 评估质量     │           工作目录 A                      工作目录 B
  └─────────────┘
```

测试 agent 扮演有经验的开发者，每轮看到 dsh 的输出后决定：
- **继续** — 发新指令（如添加功能、修 bug、改需求）
- **纠正** — "你刚才的代码有 bug，XX 行应该 YY"
- **评估** — 给代码质量打分（1-10）
- **结束** — 任务完成

## 对比指标

| 指标 | 来源 | 说明 |
|---|---|---|
| 工具调用次数 | dsh stderr 日志 | 每轮的工具调用数，总和越少越好 |
| outcome score | self-improving 日志 | 0-1 评分，仅 with-self 有 |
| 代码质量评分 | 测试 agent 评估 | 1-10 分，对比两个工作目录的最终代码 |
| 经验注入次数 | self-improving 日志 | with-self 的注入率 |
| 交互轮数 | 测试 agent 决定 | 测试 agent 何时认为任务完成 |

## 文件结构

```
test/harness/
├── README.md        # 使用方法和测试指南
├── types.ts         # 类型定义
├── test-agent.ts    # 测试 agent：生成 prompt、决定下一步、评估质量
├── dsh-runner.ts    # dsh 调用：运行任务、解析日志、切换 patch
└── run.ts           # 主运行器：串联测试 agent + 两个 dsh 实例
```

## 运行方式

```bash
# 预估 token（不执行）
npx tsx test/harness/run.ts --dry-run

# 默认场景（REST API todo app），6 轮
npx tsx test/harness/run.ts

# 自定义场景和轮数
npx tsx test/harness/run.ts --scenario "Build a CLI tool for file conversion" --rounds 8

# 测试 agent 用不同 model
npx tsx test/harness/run.ts --model qwen3.7-plus-2026-05-26 --agent-model qwen3-8b
```

## 流程

```
Phase 1: 测试 agent 生成交互序列
  ├─ 生成第一个 prompt
  ├─ 同时发给 DSH-A (with-self) 和 DSH-B (without-self)
  ├─ 测试 agent 看输出，决定下一步 prompt
  └─ 重复 3-6 轮，直到测试 agent 评估或达到上限

Phase 2: 重跑完整序列
  ├─ 清空两个工作目录
  ├─ DSH-A: 带 self-improving 重跑所有 prompt（经验在多轮中积累）
  └─ DSH-B: 不带 self-improving 重跑所有 prompt

Phase 3: 评估代码质量
  ├─ 测试 agent 读取 with-self 工作目录的代码，打分
  └─ 测试 agent 读取 without-self 工作目录的代码，打分

Phase 4: 对比报告
  ├─ 逐轮工具调用对比
  ├─ 评分对比
  ├─ 代码质量对比
  └─ 测试 agent 的每轮意图
```

## Token 预估

| 环节 | 每轮消耗 | 6 轮总计 |
|---|---|---|
| 测试 agent 决策 | ~2,000 | 12,000 |
| DSH-A (with-self) | ~5,000 | 30,000 |
| DSH-B (without-self) | ~5,000 | 30,000 |
| 质量评估 (2次) | ~2,000 × 2 | 4,000 |
| **合计** | **12,000/轮** | **76,000** |

预算 500,000 token，占 15.2%。

## 与之前 E2E 测试的区别

| | 之前 E2E | Harness E2E |
|---|---|---|
| Prompt 来源 | 固定 5 个，人工写死 | 测试 agent 动态生成，根据 dsh 输出调整 |
| 交互方式 | 单轮（发一个 prompt 就结束） | 多轮（看输出后决定下一步） |
| 任务类型 | 预定义编程任务 | 测试 agent 模拟真实开发者行为 |
| 对比指标 | 步数、评分 | 步数、评分 + **代码质量评估** |
| 基准 | baseline vs enabled | with-self vs without-self，同样 prompt |
| Token 预估 | 无 | dry-run 先行 |
