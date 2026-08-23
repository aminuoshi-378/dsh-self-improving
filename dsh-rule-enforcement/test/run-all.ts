/**
 * Pure-function tests — runnable WITHOUT a dsh runtime.
 * Verifies the core setting resolution used by the plugin entry.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_RULES, SETTINGS_NAMESPACE, resolveSettings } from '../src/settings.js'

test('SETTINGS_NAMESPACE is a stable kebab-case id', () => {
  assert.equal(SETTINGS_NAMESPACE, 'dsh-rule-enforcement')
})

test('resolveSettings fills the default when nothing is stored', () => {
  assert.equal(resolveSettings().rules, DEFAULT_RULES)
})

test('resolveSettings keeps a non-empty user-provided rules string', () => {
  const s = resolveSettings({ rules: 'Always respond in Chinese.' })
  assert.equal(s.rules, 'Always respond in Chinese.')
})

test('resolveSettings falls back to default on empty/whitespace rules', () => {
  assert.equal(resolveSettings({ rules: '' }).rules, DEFAULT_RULES)
  assert.equal(resolveSettings({ rules: '   ' }).rules, DEFAULT_RULES)
})

test('resolveSettings treats a non-string stored value as absent', () => {
  assert.equal(resolveSettings({ rules: 42 }).rules, DEFAULT_RULES)
  assert.equal(resolveSettings({ rules: null }).rules, DEFAULT_RULES)
})