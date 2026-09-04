/**
 * LLM bridge — dynamically access ctx.llm without hard dependency.
 * Used by lesson generation (I2), lesson merging (C5), and preference distillation (A1-b).
 */

import type { ExperienceRecord, CorrectionType } from './types/index.js'
import { randomUUID } from 'node:crypto'

/**
 * Try to complete a prompt using ctx.llm. Returns null if LLM is unavailable.
 * J6: Includes 30s timeout via AbortController.
 *
 * W1 (fix): dsh's `GenerateOptions` requires a `provider` and `model` (the
 * provider selects the adapter), and `messages[].content` is `ContentBlock[]`
 * (not a plain string). The prior implementation passed only `messages` +
 * `signal` with a string content, so every call failed and silently fell back
 * to rule-based reflection — meaning LLM lesson generation never actually ran.
 */
export async function tryLLMComplete(
  ctx: any,
  prompt: string,
  model?: { provider: string; model: string },
): Promise<string | null> {
  const chunks: string[] = []
  try {
    const llm = ctx.get?.('llm')
    if (!llm || typeof llm.stream !== 'function') return null
    if (!model?.provider || !model?.model) return null

    // J6: Timeout protection — abort after 30s
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000)

    try {
      // W4: build a minimal valid dsh `Message` BY HAND instead of importing
      // @deepseek-ai/dsh-llm. That package is a nested dependency of the dsh CLI
      // (dsh/node_modules/@deepseek-ai/dsh-llm), not resolvable from an
      // out-of-tree link plugin's dist/ directory — so `await import(...)` fails.
      //
      // dsh's Message requires `id` (MessageId — a plain string, no runtime
      // validation) and `source`. `createUserMessage` only adds role='user' and
      // id=randomUUID(), which we replicate here.
      const message = {
        id: randomUUID(),
        role: 'user' as const,
        content: [{ type: 'text' as const, text: prompt }],
        source: { kind: 'plugin' as const, plugin: 'self-improving' },
      }
      let sawChunk = false
      let chunkTypes = new Set<string>()
      let finishReason = ''
      for await (const chunk of llm.stream({
        provider: model.provider,
        model: model.model,
        messages: [message],
        signal: controller.signal,
      })) {
        sawChunk = true
        if (chunk?.type) chunkTypes.add(chunk.type)
        if (chunk?.type === 'text-delta' && chunk.text) {
          chunks.push(chunk.text)
        } else if (chunk?.type === 'reasoning-delta' && chunk.text) {
          chunks.push(chunk.text)
        } else if (typeof chunk === 'string') {
          chunks.push(chunk)
        } else if (chunk?.type === 'finish') {
          finishReason = JSON.stringify(chunk.reason ?? '')
        }
      }
      // W5: diagnostic — what did the stream actually yield?
      process.stderr.write(`[self-improving] tryLLMComplete stream: sawChunk=${sawChunk} types=[${[...chunkTypes].join(',')}] textLen=${chunks.join('').length} finish=${finishReason}\n`)
      return chunks.length > 0 ? chunks.join('') : null
    } finally {
      clearTimeout(timeout)
    }
  } catch (err) {
    // W3: diagnostic — surface the actual failure so LLM bridge issues are visible.
    const msg = err instanceof Error ? err.message : String(err)
    process.stderr.write(`[self-improving] tryLLMComplete error: ${msg}\n`)
    // P9: Return partial result if we got some chunks before the error/timeout
    return chunks.length > 0 ? chunks.join('') : null
  }
}

/**
 * C5: LLM-based lesson merging — consolidate related lessons into one general lesson.
 * Falls back to rule-based merging if LLM is unavailable.
 */
export async function llmMergeLessons(
  ctx: any,
  records: ExperienceRecord[],
  ruleBasedFallback: (records: ExperienceRecord[]) => {
    whatWorked: string; whatFailed: string; whatToTryDifferently: string; reusableLesson: string
  },
  model?: { provider: string; model: string },
): Promise<{ whatWorked: string; whatFailed: string; whatToTryDifferently: string; reusableLesson: string }> {
  const lessons = records.map(r => {
    try {
      const parsed = JSON.parse(r.lesson ?? '{}')
      return parsed.reusable_lesson ?? parsed.reusableLesson ?? r.lesson ?? ''
    } catch { return r.lesson ?? '' }
  }).filter(l => l.length > 0)

  const prompt = `You are a lesson consolidation engine. Merge these related lessons into a single consolidated lesson.

## Input Lessons
${JSON.stringify(lessons, null, 2)}

## Task
Find the common pattern across these lessons and produce a single, more general but still actionable lesson.

## Output Format
Respond with ONLY valid JSON, no markdown fences:
{"whatWorked":"merged description","whatFailed":"merged description","whatToTryDifferently":"suggestion","reusableLesson":"consolidated actionable lesson under 50 words"}`

  const response = await tryLLMComplete(ctx, prompt, model)
  if (response) {
    try {
      const clean = response.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
      const parsed = JSON.parse(clean)
      return {
        whatWorked: parsed.whatWorked ?? parsed.what_worked ?? '',
        whatFailed: parsed.whatFailed ?? parsed.what_failed ?? '',
        whatToTryDifferently: parsed.whatToTryDifferently ?? parsed.what_to_try_differently ?? '',
        reusableLesson: parsed.reusableLesson ?? parsed.reusable_lesson ?? '',
      }
    } catch { /* fall through to rule-based */ }
  }
  return ruleBasedFallback(records)
}

/**
 * Δ7.1: LLM-based correction intent extraction — turn the user's short correction
 * text into an expected-alternative directive. Returns null when LLM unavailable
 * (caller falls back to rule-based via extractCorrectionIntentRuleBased).
 */
export async function extractCorrectionIntent(
  ctx: any,
  userText: string,
  model?: { provider: string; model: string },
): Promise<string | null> {
  const prompt = `You extract a user's correction intent from a short correction message in an AI-agent session.

Goal: capture BOTH what the user does NOT accept AND the expected alternative direction, in one concise sentence. Reply in the same language as the input (Chinese if the input is Chinese).

## User correction message
${userText}

## Output
Respond with ONLY one concise sentence describing the expected alternative (the corrected direction). No labels, no JSON, no markdown.`
  const response = await tryLLMComplete(ctx, prompt, model)
  if (!response) return null
  const cleaned = response
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  return cleaned.replace(/^["'“‘]|["'”’]+$/g, '').slice(0, 160) || null
}

/**
 * Δ7.b: Rule-rule catch — LLM-based correction classification for candidate
 * user messages that the keyword rules missed. Tries to decide whether each
 * candidate is a genuine correction (and of which type) via one batched LLM
 * call, returning null when the LLM is unavailable so callers can skip.
 *
 * Goal is to avoid false positives (the rule layer is the conservative floor);
 * the LLM only *adds* a correction event for messages the rules skipped.
 */
export async function classifyCorrectionCandidatesWithLLM(
  ctx: any,
  candidates: string[],
  model?: { provider: string; model: string },
): Promise<{ index: number; type: CorrectionType | null }[] | null> {
  if (candidates.length === 0) return []
  const prompt = `You decide whether each user message in an AI-agent session is a user correction of the agent's prior work.
Classification is a one-of enum:
- correction: the user clarifies/redirects what was previously mis-done (semantic correction, even without keywords)
- revert:    the user wants to undo/rollback/go back
- redo:      the user wants to try again / take a different approach
- interrupt: the user stopped the agent and restated
- NOT a correction: ordinary follow-up, new request, acknowledgement, or question

A message may be a correction even when it contains no trigger keyword (e.g. "the file wasn't supposed to be overwritten", "I meant the other module"). Only classify as a correction when the user is clearly rejecting/correcting something the agent did. Otherwise return null.

## Candidate messages
${candidates.map((c, i) => `[${i}] ${c}`).join('\n')}

## Output
Respond with ONLY valid JSON, no markdown: an array of objects where element i corresponds to [i]. Each object is either {"type":"correction"|"revert"|"redo"|"interrupt"} or null when not a correction.
Example: [null, {"type":"redo"}, null]`
  const response = await tryLLMComplete(ctx, prompt, model)
  if (!response) return null
  const clean = response.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  try {
    const parsed = JSON.parse(clean)
    if (!Array.isArray(parsed)) return null
    const out: { index: number; type: CorrectionType | null }[] = []
    for (let i = 0; i < parsed.length; i++) {
      const item = parsed[i]
      const type = item && typeof item.type === 'string' ? item.type : null
      if (type === 'correction' || type === 'revert' || type === 'redo' || type === 'interrupt') {
        out.push({ index: i, type })
      }
    }
    return out
  } catch {
    return null
  }
}

/**
 * L1 (v2): 生成可执行验收标准（acceptance criteria）。
 *
 * 任务开始时调用一次，产出「可客观验证」的完成判定清单（如"仓库根目录存在
 * hello.js 且 `node hello.js` 退出码为 0"），供任务结束时 judgeTaskOutcome 对照。
 * 关键：criteria 在任务开始前生成，避免事后诸葛亮式自评偏差。
 *
 * 返回 null 当 LLM 不可用或无法生成（纯聊天/开放式任务 → 由调用方落 unknown）。
 */
export async function generateAcceptanceCriteria(
  ctx: any,
  taskText: string,
  model?: { provider: string; model: string },
): Promise<string | null> {
  if (!taskText || taskText.trim().length === 0) return null
  const prompt = `You generate objectively verifiable acceptance criteria for an agent task.

Goal: produce a short checklist of concrete, machine-checkable success conditions. Favor observable facts (file exists, command exit code 0, tests pass, output matches) over subjective judgments. If the task is open-ended chat or cannot be objectively verified, respond with the single word NONE.

## Task
${taskText.slice(0, 2000)}

## Output
Respond with ONLY the criteria, one line each, no markdown, no preamble. Or respond with ONLY "NONE" if the task cannot be objectively verified.`
  const response = await tryLLMComplete(ctx, prompt, model)
  if (!response) return null
  const cleaned = response.trim().replace(/^```(?:text)?\s*/i, '').replace(/\s*```$/i, '').trim()
  if (!cleaned || cleaned.toUpperCase() === 'NONE') return null
  return cleaned.slice(0, 2000)
}

/**
 * L1 (v2): 对照验收标准判定任务是否达成。
 *
 * 任务结束时调用，LLM 对照任务开始前生成的 criteria + 最终产物证据，输出
 * pass / fail / unknown。unknown 表示证据不足以判定（拿不准就说不知道，
 * 不臆断）。返回 null 当 LLM 不可用（由上层回退到 L2/L3）。
 */
export async function judgeTaskOutcome(
  ctx: any,
  acceptanceCriteria: string,
  finalEvidence: string,
  model?: { provider: string; model: string },
): Promise<'pass' | 'fail' | 'unknown' | null> {
  if (!acceptanceCriteria || acceptanceCriteria.trim().length === 0) return null
  const prompt = `You judge whether an agent task met its acceptance criteria.

## Acceptance criteria
${acceptanceCriteria}

## Final evidence (what the agent actually produced / observed)
${finalEvidence.slice(0, 4000) || '(no evidence provided)'}

## Task
Compare the evidence against each criterion. Respond with EXACTLY one word:
- "pass" if all material criteria are clearly satisfied
- "fail" if any material criterion is clearly NOT satisfied
- "unknown" if the evidence is insufficient to judge

Do not hallucinate success. When in doubt, say "unknown".`
  const response = await tryLLMComplete(ctx, prompt, model)
  if (!response) return null
  const cleaned = response.trim().toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, '')
  if (cleaned === 'pass') return 'pass'
  if (cleaned === 'fail') return 'fail'
  if (cleaned === 'unknown') return 'unknown'
  return null
}

/**
 * v2 (stage C): Generate a semantic signature (semantic_key) for a task.
 *
 * Reduces the task text to a stable, compact, kebab-case semantic label that
 * captures *what* the task is about (e.g. "add-npm-test-script"), independent of
 * which tools were used. This replaces tool-sequence as the primary retrieval key
 * (D4: same tools, different tasks no longer collide).
 *
 * Returns null when the LLM is unavailable (caller falls back to rule-based).
 */
export async function generateSemanticKey(
  ctx: any,
  taskText: string,
  model?: { provider: string; model: string },
): Promise<string | null> {
  if (!taskText || taskText.trim().length === 0) return null
  const prompt = `Reduce this agent task to a single stable kebab-case semantic label (lowercase, hyphen-separated, max 4 words) that captures WHAT the task is about, not the tools used. Examples: "add-npm-test-script", "fix-login-timeout", "migrate-webpack-to-vite".

## Task
${taskText.slice(0, 2000)}

## Output
Respond with ONLY the label, no markdown, no punctuation, no spaces.`
  const response = await tryLLMComplete(ctx, prompt, model)
  if (!response) return null
  const cleaned = response.trim().toLowerCase().replace(/^```(?:text)?\s*/i, '').replace(/\s*```$/i, '').trim()
  if (!cleaned) return null
  return cleaned.slice(0, 80)
}
