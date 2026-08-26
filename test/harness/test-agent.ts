/**
 * 测试 agent — 模拟人类用户，通过 LLM 驱动多轮交互
 *
 * 角色：扮演一个有经验的开发者，用 dsh 完成一个编程项目。
 * 每轮看到 dsh 的输出后，决定下一步：继续、纠正、追问、或结束。
 *
 * LLM 调用通过 dsh headless 模式实现（用测试 agent 自己的 model）。
 * 实际上测试 agent 也是一个 dsh headless 调用——给它一段对话历史，
 * 让它输出下一步 prompt 或判断任务是否完成。
 */

import { spawnSync } from 'node:child_process'

export type AgentAction =
  | { type: 'prompt'; content: string; intent: string }
  | { type: 'evaluate'; qualityScore: number; reason: string }
  | { type: 'done' }

/**
 * 用 LLM 生成第一个 prompt
 */
export function generateInitialPrompt(
  testAgentModel: string,
  scenario: string,
): { prompt: string; intent: string } {
  const systemPrompt = `You are a developer testing a coding agent. Your task: ${scenario}

You need to give the coding agent its first instruction. Write a clear, specific instruction that a real developer would give. Do NOT write code yourself — just describe what you want the agent to do.

Output ONLY the instruction text, nothing else.`

  const result = spawnSync('dsh', ['--profile', 'headless', systemPrompt], {
    cwd: '/tmp',
    timeout: 60_000,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  const output = (result.stdout || '').trim()
  return { prompt: output, intent: 'initial task instruction' }
}

/**
 * 看到上一轮 dsh 的输出后，决定下一步操作
 */
export function decideNextAction(
  testAgentModel: string,
  scenario: string,
  history: { prompt: string; dshOutput: string }[],
): AgentAction {
  const historyText = history
    .map((h, i) => `--- Turn ${i + 1} ---\nYou said: ${h.prompt}\nAgent replied:\n${h.dshOutput.slice(0, 500)}\n`)
    .join('\n')

  const systemPrompt = `You are a developer testing a coding agent. 

Project goal: ${scenario}

So far you have had ${history.length} turn(s) with the agent:
${historyText}

Current workspace files:
(check the agent's last reply for what files exist)

Decide your next action. You have 3 options:

1. If the agent's work needs correction or you want to add a new requirement, respond with:
   ACTION: prompt
   INTENT: <why you're saying this>
   CONTENT: <your instruction to the agent>

2. If you think the project is complete and you want to evaluate the agent's work, respond with:
   ACTION: evaluate
   SCORE: <1-10>
   REASON: <why this score>

3. If evaluation is already done, respond with:
   ACTION: done

Rules:
- Be a realistic developer: sometimes correct mistakes, sometimes add features, sometimes ask for fixes
- Keep instructions concise (1-3 sentences)
- Do NOT write code yourself, only describe what you want
- After 3-6 turns, you should evaluate
- Score based on: correctness, completeness, code quality, and how few corrections were needed`

  // 用测试 agent model 调用 LLM
  const result = spawnSync('dsh', ['--profile', 'headless', systemPrompt], {
    cwd: '/tmp',
    timeout: 60_000,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  const output = (result.stdout || '').trim()

  // 解析 LLM 输出
  if (output.includes('ACTION: evaluate') || output.includes('ACTION: evaluate')) {
    const scoreMatch = output.match(/SCORE:\s*(\d+)/)
    const reasonMatch = output.match(/REASON:\s*(.+)/s)
    return {
      type: 'evaluate',
      qualityScore: scoreMatch ? parseInt(scoreMatch[1]) : 5,
      reason: reasonMatch ? reasonMatch[1].trim() : 'No reason provided',
    }
  }

  if (output.includes('ACTION: done')) {
    return { type: 'done' }
  }

  // 默认: prompt
  const intentMatch = output.match(/INTENT:\s*(.+)/)
  const contentMatch = output.match(/CONTENT:\s*([\s\S]+?)(?:\nACTION:|$)/)

  return {
    type: 'prompt',
    intent: intentMatch ? intentMatch[1].trim() : 'continuation',
    content: contentMatch ? contentMatch[1].trim() : output,
  }
}
