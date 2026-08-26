/**
 * 类型定义 — harness-e2e 测试框架
 */

/** 一轮交互的记录 */
export interface InteractionTurn {
  /** 测试 agent 发出的 prompt */
  prompt: string
  /** 测试 agent 发这个 prompt 的意图 */
  intent: string
  /** dsh 的输出 */
  dshOutput: string
  /** dsh stderr (含 self-improving 日志, 如有) */
  dshStderr: string
  /** 工具调用次数 */
  toolCalls: number
  /** outcome score (仅 self-improving 模式有) */
  outcomeScore: number | null
  /** difficulty (仅 self-improving 模式有) */
  difficulty: string | null
  /** 是否注入了经验 */
  injected: boolean
  /** 退出码 */
  exitCode: number
}

/** 一个 dsh 实例的完整交互历史 */
export interface InstanceHistory {
  /** 实例标识: 'with-self' 或 'without-self' */
  instanceId: string
  /** 工作目录 */
  workDir: string
  /** 所有交互轮次 */
  turns: InteractionTurn[]
  /** 测试 agent 对最终代码质量的评估 (1-10) */
  qualityScore: number | null
  /** 测试 agent 的评估理由 */
  qualityReason: string | null
}

/** 一次完整对比测试的结果 */
export interface ComparisonResult {
  timestamp: string
  testAgentModel: string
  dshModel: string
  /** 任务场景描述 */
  scenario: string
  withSelf: InstanceHistory
  withoutSelf: InstanceHistory
  /** 对比汇总 */
  summary: {
    withSelfAvgTools: number
    withoutSelfAvgTools: number
    withSelfAvgScore: number | null
    withoutSelfAvgScore: number | null
    withSelfQuality: number | null
    withoutSelfQuality: number | null
    withSelfInjections: number
    withoutSelfInjections: number
    withSelfTurns: number
    withoutSelfTurns: number
  }
}
