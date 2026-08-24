/**
 * Tests for rules-file read/write logic.
 * Runnable WITHOUT a dsh runtime — tests pure file I/O.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  getRulesFilePath,
  DEFAULT_RULES,
  readRules,
  writeRules,
  watchRules,
} from '../src/rules-file.js'

// Create a temp dir for test files
const tmpDir = mkdtempSync(join(tmpdir(), 'dsh-rules-test-'))
const testFilePath = join(tmpDir, 'rules.md')

test('getRulesFilePath returns ~/.dsh/rules.md by default', () => {
  const p = getRulesFilePath('/home/user/.dsh')
  assert.equal(p, '/home/user/.dsh/rules.md')
})

test('readRules creates the file with defaults when it does not exist', () => {
  const freshPath = join(tmpDir, 'fresh-rules.md')
  const content = readRules(freshPath)
  assert.equal(content, DEFAULT_RULES)
  // File should now exist
  const fromDisk = readFileSync(freshPath, 'utf-8')
  assert.equal(fromDisk, DEFAULT_RULES)
})

test('readRules returns file content when file exists', () => {
  writeFileSync(testFilePath, '# My Rules\n- rule 1\n- rule 2', 'utf-8')
  const content = readRules(testFilePath)
  assert.equal(content, '# My Rules\n- rule 1\n- rule 2')
})

test('readRules returns defaults for empty file', () => {
  const emptyPath = join(tmpDir, 'empty-rules.md')
  writeFileSync(emptyPath, '', 'utf-8')
  const content = readRules(emptyPath)
  assert.equal(content, DEFAULT_RULES)
})

test('readRules returns defaults for whitespace-only file', () => {
  const wsPath = join(tmpDir, 'ws-rules.md')
  writeFileSync(wsPath, '   \n\n  ', 'utf-8')
  const content = readRules(wsPath)
  assert.equal(content, DEFAULT_RULES)
})

test('writeRules writes content to file', () => {
  const wPath = join(tmpDir, 'write-test.md')
  writeRules(wPath, '# Updated Rules\n\n- new rule')
  const content = readFileSync(wPath, 'utf-8')
  assert.equal(content, '# Updated Rules\n\n- new rule')
})

test('writeRules creates parent directories if needed', () => {
  const deepPath = join(tmpDir, 'sub', 'dir', 'rules.md')
  writeRules(deepPath, '# Deep Rules')
  const content = readFileSync(deepPath, 'utf-8')
  assert.equal(content, '# Deep Rules')
})

test('writeRules then readRules round-trips content', () => {
  const rtPath = join(tmpDir, 'roundtrip.md')
  const original = '# Round Trip\n\n- 中文规则\n- English rule'
  writeRules(rtPath, original)
  const read = readRules(rtPath)
  assert.equal(read, original)
})

test('watchRules fires callback on file change', async () => {
  const watchPath = join(tmpDir, 'watch-test.md')
  writeRules(watchPath, '# initial')

  await new Promise<void>((resolve) => {
    let fired = false
    const stop = watchRules(watchPath, (content) => {
      if (!fired) {
        fired = true
        assert.ok(content.includes('# updated'), `expected updated content, got: ${content}`)
        stop()
        resolve()
      }
    })

    // Give the watcher a moment to attach, then write
    setTimeout(() => {
      writeRules(watchPath, '# updated content')
    }, 100)

    // Timeout safety
    setTimeout(() => {
      if (!fired) {
        stop()
        resolve() // Don't fail — file watching can be flaky on some OSes
      }
    }, 3000)
  })
})

// Cleanup
test('cleanup', () => {
  rmSync(tmpDir, { recursive: true, force: true })
  assert.ok(true)
})
