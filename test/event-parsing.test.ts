/**
 * Event parsing tests — dsh session event structure compatibility.
 *
 * These tests verify the helpers that extract user-message text from dsh's
 * `session.events` stream. The real dsh `user/message` event carries
 * `data: UserMessage` (with `content: ContentBlock[]`, NO `turn`/`text` field),
 * while `turn/start`/`turn/end` carry `{ turn }`. A prior bug assumed
 * `user/message.data.turn` existed, so task-pattern inference and implicit
 * negative-feedback detection silently never fired.
 */

import { extractMessageText, findUserMessageText, countUserMessagesInTurn } from '../src/index.js'

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERT FAILED: ${message}`)
}

let passed = 0
let failed = 0

function test(name: string, fn: () => void): void {
  try {
    fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failed++
    console.error(`  ✗ ${name}`)
    console.error(`    ${(err as Error).message}`)
  }
}

// Build a minimal dsh-like session event list for a single turn.
function makeTurn(turn: number, userTexts: string[]): any[] {
  const events: any[] = []
  events.push({ type: 'turn/start', seq: turn * 100, time: 0, data: { turn } })
  userTexts.forEach((text, i) => {
    events.push({
      type: 'user/message',
      seq: turn * 100 + 1 + i,
      time: 0,
      data: {
        id: `msg-${turn}-${i}`,
        role: 'user',
        source: { kind: 'user' },
        // Real dsh shape: content is ContentBlock[], no `text`/`turn` field.
        content: [{ type: 'text', text }],
      },
    })
  })
  events.push({ type: 'turn/end', seq: turn * 100 + 99, time: 0, data: { turn, reason: { kind: 'completed' } } })
  return events
}

// ---------------------------------------------------------------------------

console.log('\n--- Event Parsing: extractMessageText ---')

test('extractMessageText handles a plain string', () => {
  assert(extractMessageText('hello world') === 'hello world', 'string passthrough')
})

test('extractMessageText handles ContentBlock[] (dsh real shape)', () => {
  const content = [{ type: 'text', text: 'fix the' }, { type: 'text', text: 'bug' }]
  assert(extractMessageText(content) === 'fix the bug', 'joins text blocks')
})

test('extractMessageText skips non-text blocks', () => {
  const content = [{ type: 'text', text: 'hello' }, { type: 'image', url: 'x' }, { type: 'text', text: 'world' }]
  assert(extractMessageText(content) === 'hello world', 'only text parts joined')
})

test('extractMessageText handles undefined/null/empty', () => {
  assert(extractMessageText(undefined) === '', 'undefined → empty')
  assert(extractMessageText(null) === '', 'null → empty')
  assert(extractMessageText(42 as any) === '', 'non-string/array → empty')
})

// ---------------------------------------------------------------------------

console.log('\n--- Event Parsing: findUserMessageText ---')

test('findUserMessageText extracts the user message for a turn', () => {
  const events = [
    ...makeTurn(1, ['fix the login bug']),
    ...makeTurn(2, ['add a new feature']),
  ]
  assert(findUserMessageText(events, 1) === 'fix the login bug', 'turn 1 text')
  assert(findUserMessageText(events, 2) === 'add a new feature', 'turn 2 text')
})

test('findUserMessageText returns empty for a missing turn', () => {
  const events = makeTurn(1, ['hello'])
  assert(findUserMessageText(events, 99) === '', 'missing turn → empty')
})

test('findUserMessageText skips synthetic plugin-injected context', () => {
  const events = [
    { type: 'turn/start', seq: 1, time: 0, data: { turn: 1 } },
    {
      type: 'user/message', seq: 2, time: 0,
      data: { id: 'ctx', role: 'user', source: { kind: 'plugin', plugin: 'file-watcher' }, content: [{ type: 'text', text: 'file changed' }] },
    },
    {
      type: 'user/message', seq: 3, time: 0,
      data: { id: 'real', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'real prompt' }] },
    },
    { type: 'turn/end', seq: 4, time: 0, data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  assert(findUserMessageText(events, 1) === 'real prompt', 'skips plugin context, returns real user prompt')
})

// ---------------------------------------------------------------------------

console.log('\n--- Event Parsing: countUserMessagesInTurn ---')

test('countUserMessagesInTurn counts only genuine user messages', () => {
  const events = [
    { type: 'turn/start', seq: 1, time: 0, data: { turn: 1 } },
    { type: 'user/message', seq: 2, time: 0, data: { id: 'a', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'task' }] } },
    { type: 'user/message', seq: 3, time: 0, data: { id: 'b', role: 'user', source: { kind: 'plugin', plugin: 'x' }, content: [{ type: 'text', text: 'ctx' }] } },
    { type: 'user/message', seq: 4, time: 0, data: { id: 'c', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'correction' }] } },
    { type: 'turn/end', seq: 5, time: 0, data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  assert(countUserMessagesInTurn(events, 1) === 2, '2 genuine user messages (plugin context excluded)')
})

test('countUserMessagesInTurn returns 0 for a missing turn', () => {
  assert(countUserMessagesInTurn(makeTurn(1, ['x']), 99) === 0, 'missing turn → 0')
})

console.log(`\n${passed} passed, ${failed} failed\n`)

if (failed > 0) process.exit(1)
