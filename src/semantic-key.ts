/**
 * Semantic signature — v2 (stage C)
 *
 * Rule-based fallback for generating a task's `semantic_key` when the LLM is
 * unavailable. The LLM version (llm-bridge.generateSemanticKey) produces a
 * higher-quality, paraphrase-robust label; this deterministic fallback extracts
 * a stable kebab-case label from task keywords so semantic retrieval still
 * works without an LLM call.
 *
 * It is intentionally coarse — a keyword-based heuristic, not true semantics —
 * but it is deterministic, zero-cost, and sufficient to avoid the v1 D4 defect
 * of "same tools, different tasks" colliding on tool-sequence.
 */

/** Known verb → label mapping (curated; deterministic, no LLM). */
const VERB_LABEL: Record<string, string> = {
  add: 'add',
  create: 'add',
  implement: 'add',
  build: 'build',
  fix: 'fix',
  bug: 'fix',
  error: 'fix',
  crash: 'fix',
  broken: 'fix',
  refactor: 'refactor',
  rename: 'refactor',
  restructure: 'refactor',
  optimize: 'optimize',
  migrate: 'migrate',
  test: 'test',
  deploy: 'deploy',
  search: 'search',
  find: 'find',
  remove: 'remove',
  delete: 'remove',
  update: 'update',
}

/**
 * Extract the primary verb label from a task text (first matching verb keyword).
 */
function extractVerb(text: string): string | null {
  const lower = text.toLowerCase()
  for (const [keyword, label] of Object.entries(VERB_LABEL)) {
    // Match whole words to avoid "test" matching "testing" prematurely is fine,
    // but avoid matching inside unrelated words like "latest".
    if (new RegExp(`\\b${keyword}\\b`).test(lower)) {
      return label
    }
  }
  return null
}

/**
 * Extract a stable subject noun from the task text (a salient non-verb token).
 * Returns a kebab-case subject, or null when nothing salient is found.
 */
function extractSubject(text: string): string | null {
  // Remove common noise words and punctuation.
  const noise = new Set(['a', 'an', 'the', 'to', 'in', 'on', 'for', 'of', 'and', 'or', 'is', 'are', 'be', 'this', 'that', 'it', 'me', 'my', 'please', 'i', 'you', 'we', 'with', 'from', 'by', 'at'])
  const tokens = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !noise.has(t) && !(t in VERB_LABEL))
  if (tokens.length === 0) return null
  // Take up to 3 salient tokens as the subject.
  return tokens.slice(0, 3).join('-')
}

/**
 * Rule-based semantic key generation (fallback).
 *
 * Format: `<verb>-<subject>` when both are available, else just `<verb>` or
 * `<subject>`. Returns null when no meaningful label can be derived (caller
 * should leave semantic_key null and fall back to taskPattern retrieval).
 */
export function generateSemanticKeyRuleBased(taskText: string): string | null {
  if (!taskText || taskText.trim().length === 0) return null
  const verb = extractVerb(taskText)
  const subject = extractSubject(taskText)
  if (verb && subject) return `${verb}-${subject}`.slice(0, 80)
  if (verb) return verb
  if (subject) return subject.slice(0, 80)
  return null
}