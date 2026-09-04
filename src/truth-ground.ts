/**
 * Truth-ground layer (v2) — 真值信号判定
 *
 * 解决 v1 的根本缺陷：评分用「过程代理指标」（工具成功率/步数效率）衡量"执行
 * 流畅度"，而非"任务是否真正做对"。本模块产出任务单元（TaskUnit）级的
 * `OutcomeVerdict`（pass / fail / unknown）+ 真值来源级别 + 置信度。
 *
 * 三级回退（可信度降序）：
 *   L0 用户显式终局反馈（messageFeedback 的 positive/negative）
 *   L1 可执行验收标准自评（LLM 对照任务开始前生成的 criteria 判定）
 *   L2 硬性可观测事实（工具退出码 / 测试结果）
 *   L3 过程代理弱先验（goal phase + 工具成功率，仅作最低限度兜底）
 *
 * 关键不变式：
 *   - 拿不到真值的任务一律落 `unknown`，绝不臆断成败（否决 v1 的"未知给满分"）。
 *   - `active`/`paused` 是"进行中"，不产生结论（否决 v1 的 `active→advanced`）。
 *
 * 本文件保持纯函数 + 依赖注入（IO 通过参数传入），便于单元测试。
 */

import type { OutcomeVerdict, VerdictSource } from './types/index.js'
import { computeVerdictConfidence } from './types/index.js'
import { HARD_FACT_FAIL_TOOL_MIN } from './types/constants.js'

/** 一次工具执行结果（与 index.ts 运行时格式对齐：{ name, success }）。 */
export interface TruthToolResult {
  name: string
  success: boolean
}

/** 硬性事实（L2）判定输入：本 TaskUnit 内累积的工具结果。 */
export interface HardFactInput {
  toolResults: TruthToolResult[]
}

/** 过程代理弱先验（L3）判定输入。 */
export interface ProxyPriorInput {
  /** goal phase（来自 ctx.goals，权威字段），可能为 undefined。 */
  goalPhase?: 'active' | 'paused' | 'blocked' | 'complete'
  /** 工具成功率 0.0–1.0。 */
  toolSuccessRate: number
}

/** 判定所需的所有信号（按级别组织，缺失用 undefined 表示）。 */
export interface VerdictInput {
  /** L0：用户终局反馈，'positive' | 'negative' 或 undefined（无反馈）。 */
  userRating?: 'positive' | 'negative'
  /** L1：LLM 对照验收标准的判定，'pass' | 'fail' | 'unknown' 或 undefined。 */
  llmJudgment?: OutcomeVerdict
  /** L2：硬性事实输入。 */
  hardFacts?: HardFactInput
  /** L3：过程代理弱先验。 */
  proxyPrior?: ProxyPriorInput
}

/** 判定结果：verdict + 来源级别 + 置信度。 */
export interface VerdictResult {
  verdict: OutcomeVerdict
  source: VerdictSource
  outcomeConfidence: number
}

/**
 * L2 硬性事实判定：只认客观可观测信号，不臆断。
 *
 * 规则（阶段 A 范围）：
 *   - 存在「失败工具结果」（success === false）→ fail（工具报错/退出码非零是
 *     硬失败信号）。
 *   - 全部成功 → 不足以判定 pass（"没报错"不等于"做对了"），返回 null 让
 *     上层回退到更弱的先验。
 *   - 无工具结果 → null（无事实可依）。
 *
 * 注意：硬事实是"能确证 fail"的信号，pass 需要更高层级的确认（L0/L1），
 * 因此本函数只产出 fail 或 null，不产出 pass。
 */
export function hardFactVerdict(input: HardFactInput | undefined): OutcomeVerdict | null {
  if (!input || !Array.isArray(input.toolResults) || input.toolResults.length === 0) {
    return null
  }
  const failedCount = input.toolResults.filter((t) => t && t.success === false).length
  if (failedCount >= HARD_FACT_FAIL_TOOL_MIN) {
    return 'fail'
  }
  // 无失败工具不足以证明 pass，返回 null 交由上层回退。
  return null
}

/**
 * L3 过程代理弱先验：最低限度的兜底，仅在 L0/L1/L2 全部缺失时使用。
 *
 * 修正 v1 失真：
 *   - 只有 `complete` 才映射为 pass 候选。
 *   - `blocked` 映射为 fail 候选。
 *   - `active`/`paused`/undefined 一律 `unknown`（进行中 ≠ 成功/失败）。
 */
export function proxyPriorVerdict(input: ProxyPriorInput | undefined): OutcomeVerdict {
  if (!input) return 'unknown'
  const phase = input.goalPhase
  if (phase === 'complete') return 'pass'
  if (phase === 'blocked') return 'fail'
  if (phase === 'active' || phase === 'paused') return 'unknown'
  // 无 goal phase（undefined）——不能凭工具成功率臆断成败，落 unknown。
  return 'unknown'
}

/**
 * 主入口：按 L0 > L1 > L2 > L3 顺序解析最终 verdict + 来源 + 置信度。
 *
 * - L0 有用户终局反馈（positive→pass / negative→fail）时最高优先。
 * - L1 有 LLM 判定（pass/fail）时次之；LLM 判定为 unknown 则继续回退。
 * - L2 硬事实只产出 fail（见 hardFactVerdict）。
 * - L3 弱先验兜底。
 * - 全部缺失/未知 → unknown（置信度用 L3 最低档，因为无法确证）。
 */
export function resolveVerdict(input: VerdictInput): VerdictResult {
  // L0：用户显式终局反馈
  if (input.userRating === 'positive') {
    return { verdict: 'pass', source: 'L0', outcomeConfidence: computeVerdictConfidence('L0') }
  }
  if (input.userRating === 'negative') {
    return { verdict: 'fail', source: 'L0', outcomeConfidence: computeVerdictConfidence('L0') }
  }

  // L1：LLM 对照验收标准自评
  if (input.llmJudgment === 'pass') {
    return { verdict: 'pass', source: 'L1', outcomeConfidence: computeVerdictConfidence('L1') }
  }
  if (input.llmJudgment === 'fail') {
    return { verdict: 'fail', source: 'L1', outcomeConfidence: computeVerdictConfidence('L1') }
  }

  // L2：硬性可观测事实（只产出 fail）
  const hard = hardFactVerdict(input.hardFacts)
  if (hard === 'fail') {
    return { verdict: 'fail', source: 'L2', outcomeConfidence: computeVerdictConfidence('L2') }
  }

  // L3：过程代理弱先验
  const prior = proxyPriorVerdict(input.proxyPrior)
  if (prior !== 'unknown') {
    return { verdict: prior, source: 'L3', outcomeConfidence: computeVerdictConfidence('L3') }
  }

  // 全部缺失/未知：诚实返回 unknown，绝不臆断成败。
  return { verdict: 'unknown', source: 'L3', outcomeConfidence: computeVerdictConfidence('L3') }
}