/**
 * LLM bridge — dynamically access ctx.llm without hard dependency.
 * Used by lesson generation (I2), lesson merging (C5), and preference distillation (A1-b).
 */

import type { ExperienceRecord } from './types/index.js'
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
