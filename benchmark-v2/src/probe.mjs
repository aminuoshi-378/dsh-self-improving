// UI structure probe: boot the bench-baseline server, open the WebUI,
// dump every visible button's accessible name, click the workspace chip,
// and dump again. Screenshots under runs/probe/.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, loadConfig } from './lib/config.mjs'
import { startServer, killTree } from './lib/server.mjs'

const cfg = loadConfig()
const outDir = join(ROOT, 'runs', 'probe')
mkdirSync(outDir, { recursive: true })

const server = await startServer(cfg, 'baseline', join(outDir, 'server.log'))
console.log('server:', server.tokenUrl)
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('console', (message) => {
  if (message.type() === 'error' || message.type() === 'warning') {
    console.log(`[console.${message.type()}]`, message.text().slice(0, 300))
  }
})
page.on('pageerror', (error) => console.log('[pageerror]', String(error).slice(0, 300)))
page.on('requestfailed', (request) => console.log('[requestfailed]', request.method(), request.url().slice(0, 120), request.failure()?.errorText))
page.on('response', (response) => {
  if (response.status() >= 400) console.log('[http', response.status() + ']', response.request().method(), response.url().slice(0, 120))
})
await page.goto(server.tokenUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
await page.waitForTimeout(6000)

const dump = async (label) => {
  const buttons = await page.getByRole('button').all()
  const rows = []
  for (const button of buttons) {
    const aria = ((await button.getAttribute('aria-label').catch(() => '')) || '').slice(0, 40)
    const text = ((await button.innerText().catch(() => '')).trim() || '').replace(/\s+/g, ' ').slice(0, 40)
    if (await button.isVisible().catch(() => false)) rows.push(`aria='${aria}' text='${text}'`)
  }
  console.log(`--- ${label}: ${rows.length} visible buttons, url=${page.url()}`)
  for (const row of rows) console.log('  ' + row)
  const dialog = page.getByRole('dialog')
  if (await dialog.isVisible().catch(() => false)) {
    console.log('  DIALOG text head:', (await dialog.innerText()).replace(/\s+/g, ' ').slice(0, 300))
  }
}

await page.screenshot({ path: join(outDir, 'a-initial.png') })
await dump('initial')

const dumpRoles = async (label) => {
  const rows = []
  for (const role of ['menu', 'menuitem', 'listbox', 'option', 'dialog']) {
    const found = await page.getByRole(role).all().catch(() => [])
    for (const item of found) {
      if (await item.isVisible().catch(() => false)) {
        rows.push(`role=${role} text='${((await item.innerText().catch(() => '')).trim() || '').replace(/\s+/g, ' ').slice(0, 60)}'`)
      }
    }
  }
  console.log(`--- ${label}: ${rows.length} visible menu-ish elements`)
  for (const row of rows) console.log('  ' + row)
}

const chip = page.getByRole('button', { name: /(Choose workspace|选择工作区)/i }).first()
console.log('chip visible:', await chip.isVisible({ timeout: 5000 }).catch(() => false))
await chip.click()
await page.waitForTimeout(2500)
await page.screenshot({ path: join(outDir, 'b-after-chip.png') })
await dump('after-chip-click')
await dumpRoles('chip-menu')

await page.screenshot({ path: join(outDir, 'c-menu-open.png') })
// Select the ARENA workspace via its menuitem.
const tmpItem = page.getByRole('menuitem', { name: /^(arena)$/i }).first()
console.log('menu tmp item visible:', await tmpItem.isVisible({ timeout: 3000 }).catch(() => false))
await tmpItem.click()
await page.waitForTimeout(2000)
const chipText1 = (await chip.innerText()).trim()
console.log('chip label after selecting tmp:', JSON.stringify(chipText1))
await page.screenshot({ path: join(outDir, 'd-after-select-tmp.png') })

// Decisive test 2: New Session button resets to a blank session.
const newSession = page.getByRole('button', { name: 'New session' }).nth(1)
console.log('New Session button visible:', await newSession.isVisible({ timeout: 3000 }).catch(() => false))
await newSession.click()
await page.waitForTimeout(2000)
const chipText2 = (await chip.innerText()).trim()
console.log('chip label after New Session click:', JSON.stringify(chipText2))
const chatInput = page.locator('div[role="textbox"]').first()
console.log('chat input visible:', await chatInput.isVisible({ timeout: 3000 }).catch(() => false))
console.log('chat input enabled:', await chatInput.isEnabled({ timeout: 3000 }).catch(() => false))
await page.screenshot({ path: join(outDir, 'e-after-new-session.png') })

// Decisive test 3: does the SMOKE-style locator resolve at all?
const smokeStyle = page.getByRole('button', { name: /(New session|新建会话)/i }).filter({ hasText: /(New Session|新建)/ })
console.log('smoke-style locator count:', await smokeStyle.count().catch((e) => 'ERR ' + e.message))
console.log('smoke-style locator visible:', await smokeStyle.first().isVisible({ timeout: 3000 }).catch((e) => 'ERR ' + e.message))
const allNewSession = page.getByRole('button', { name: /(New session|新建会话)/i })
console.log('role-locator count:', await allNewSession.count())
for (let i = 0; i < await allNewSession.count(); i++) {
  const b = allNewSession.nth(i)
  console.log(`  [${i}] visible=${await b.isVisible().catch(() => false)} text='${((await b.innerText().catch(() => '')).trim() || '').slice(0, 40)}'`)
}

await browser.close()
await killTree(server)
console.log('probe done, screenshots in', outDir)
