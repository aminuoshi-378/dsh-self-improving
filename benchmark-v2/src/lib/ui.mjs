import { chromium } from 'playwright'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export async function launchBrowser(cfg) {
  const browser = await chromium.launch({ headless: cfg.run.headless })
  const page = await browser.newPage({ viewport: cfg.run.viewport })
  return { browser, page }
}

/** ~/.dsh/sessions/--encoded-workspace-path--/ (observed encoding rule). */
function sessionsDirFor(cfg, workspacePath) {
  const encoded = `--${workspacePath.replace(/^\//, '').replace(/\//g, '-') }--`
  return join(cfg.dshHome, 'sessions', encoded)
}

/**
 * Turn-completion detection from the GROUND TRUTH: the task's session log.
 * UI heuristics (stop-button/send-button states) proved locale-fragile —
 * a completed turn whose UI signals were misread would poll until the full
 * task timeout. The session log's `turn/end` event cannot lie: it is what
 * the Host itself persisted.
 */
async function waitTurnEndViaSessionLog(cfg, arenaPath, startedAtMs, timeoutMs) {
  const sessionsDir = sessionsDirFor(cfg, arenaPath)
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if (existsSync(sessionsDir)) {
        const candidates = readdirSync(sessionsDir)
          .filter((name) => name.startsWith('session-'))
          .map((name) => {
            const dir = join(sessionsDir, name)
            const log = readdirSync(dir).find((file) => /^session\..*\.jsonl\.zstd$/.test(file))
            if (!log) return null
            const file = join(dir, log)
            return { file, mtimeMs: statSync(file).mtimeMs }
          })
          .filter((entry) => entry && entry.mtimeMs >= startedAtMs - 5_000)
          .sort((left, right) => right.mtimeMs - left.mtimeMs)
        if (candidates.length > 0 && candidates[0]) {
          const text = execSync(`zstd -dc ${JSON.stringify(candidates[0].file)}`, {
            maxBuffer: 64 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'ignore'],
          }).toString()
          if (text.includes('"type":"turn/end"')) {
            return { done: true, timeout: false }
          }
        }
      }
    } catch {
      /* log mid-write: retry on the next poll */
    }
    await sleep(cfg.run.uiPollMs)
  }
  return { done: false, timeout: true }
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export async function runTaskInUi(page, cfg, { tokenUrl, arenaPath, arenaLabel, prompt, screenshotPath }) {
  let lastError = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await runTaskSteps(page, cfg, { tokenUrl, arenaPath, arenaLabel, prompt, screenshotPath })
    } catch (error) {
      lastError = error
      // Preserve the failure scene for monitoring/diagnosis, then reload for
      // one retry: no agent turn has started inside a failed attempt, and the
      // model/arena guards re-validate everything before the retry proceeds.
      await page
        .screenshot({ path: screenshotPath.replace(/\.png$/, `-attempt${attempt}-failure.png`) })
        .catch(() => {})
      if (attempt === 0) {
        await page.goto(tokenUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {})
        await sleep(4000)
      }
    }
  }
  throw lastError
}

async function runTaskSteps(page, cfg, { tokenUrl, arenaPath, arenaLabel, prompt, screenshotPath }) {
  await page.goto(tokenUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await sleep(4000)

  // 0.1.7 boots two ordered versioned onboarding modals on a profile's first
  // run (internal-testing notice, then optionally the DeepSeek credential
  // step). Their mask intercepts every pointer event until acknowledged and a
  // bench run must be unattended, so acknowledge/skip whichever is up. The
  // acknowledgement persists into the profile patch, so later tasks pass
  // through this loop with two no-op visibility probes.
  for (const label of [/^(继续|Continue)$/, /^(稍后配置|Configure later)$/]) {
    const button = page.getByRole('button', { name: label }).first()
    if (await button.isVisible().catch(() => false)) {
      await button.click({ timeout: 5000 }).catch(() => {})
      await sleep(1500)
    }
  }

  // Settings-panel guard: the 0.1.7 settings modal has no programmatic open
  // path, but once open (a stray human click on the visible bench window is
  // the only observed trigger) its mask intercepts every sidebar click and
  // stalls the run. Escape is the panel's official close path and the mask
  // itself closes on click; log every trigger so a systemic regression can
  // be told apart from an incidental manual interaction after the run.
  const modalMask = page.locator('div[aria-hidden="true"][class*="mask"]').first()
  if (await modalMask.isVisible().catch(() => false)) {
    console.warn('[ui] modal mask detected; pressing Escape to close it')
    await page.keyboard.press('Escape')
    await sleep(1000)
    if (await modalMask.isVisible().catch(() => false)) {
      console.warn('[ui] mask survived Escape; clicking the mask (settings mask closes on click)')
      await modalMask.click({ timeout: 3000 }).catch(() => {})
      await sleep(1000)
    }
  }

  // Determinism guard: the pinned model must be the selected one.
  const modelButton = page.getByRole('button', { name: /(Select model|选择模型)/i }).first()
  const modelText = (await modelButton.innerText({ timeout: 10_000 }).catch(() => '')).trim()
  if (!modelText.includes(cfg.model.uiLabelHint)) {
    throw new Error(`model selector shows '${modelText}' — expected '${cfg.model.uiLabelHint}'; refusing to run (determinism guard)`)
  }

  // Fresh blank session FIRST: after a reload the UI restores the previous
  // CONVERSATION view, where the workspace chip does not exist. The New
  // Session button exists in both views; clicking it lands on the blank
  // hero, where the chip (and menu selection) is reachable.
  const newSession = page
    .getByRole('button', { name: /(New session|新会话|新建会话)/i })
    .filter({ hasText: /(New Session|新会话|新建)/ })
    .first()
  await newSession.click({ timeout: 10_000 })
  await sleep(1500)

  // Workspace binding: the arena is a REGISTERED workspace; select it through
  // the chip menu (menuitem selection is verified to work). The directory
  // browse dialog is deliberately NOT used — it does not open reliably under
  // automation in this composition.
  const chip = page.getByRole('button', { name: /(Choose workspace|选择工作区)/i }).first()
  const chipText = async () => (await chip.innerText({ timeout: 5000 }).catch(() => '')).trim()
  if (!(await chipText()).toLowerCase().includes(arenaLabel.toLowerCase())) {
    await chip.click({ timeout: 15_000 })
    const item = page
      .getByRole('menuitem', { name: new RegExp(`^${escapeRegExp(arenaLabel)}$`, 'i') })
      .first()
    await item.waitFor({ state: 'visible', timeout: 10_000 })
    await item.click()
    await sleep(1500)
    if (!(await chipText()).toLowerCase().includes(arenaLabel.toLowerCase())) {
      throw new Error(`arena selection failed: chip shows '${await chipText()}' (expected '${arenaLabel}'); run prepare to register the arena workspace`)
    }
  }

  const startedAtMs = Date.now()
  const chatInput = page.locator('div[role="textbox"]').first()
  await chatInput.click()
  await chatInput.fill(prompt)
  await page.getByRole('button', { name: /^(Send message|发送消息|发送)/i }).first().click()

  // Wait for the persisted turn to end — the session log is the authority.
  const outcome = await waitTurnEndViaSessionLog(cfg, arenaPath, startedAtMs, cfg.run.taskTimeoutMs)
  if (outcome.timeout) {
    // A timeout only abandons the WAITER, not the server-side turn: the Host
    // keeps executing it against the SHARED arena, where it races the next
    // task's seed and this task's grading (observed: two interleaved step
    // sets in one arena; the following task short-circuited in 8s). Abort
    // the turn through the official Stop control (composer primary button
    // while running, aria-label input.stop) and confirm the abort the same
    // way completion is confirmed — a stopped turn persists turn/end with
    // reason kind 'aborted' (core session TurnEndReasonMap).
    console.warn(`[ui] turn did not persist turn/end within ${cfg.run.taskTimeoutMs / 1000}s; forcing an abort via Stop`)
    // Forensics first: timeout scenes get cleaned away (session logs rotate);
    // capture the wedged UI before the Stop click mutates it.
    await page.screenshot({ path: screenshotPath.replace(/\.png$/, '-timeout.png'), timeout: 20_000 })
      .catch(() => { console.warn('[ui] timeout screenshot failed; aborting anyway') })
    const stopButton = page.getByRole('button', { name: /^(停止生成|Stop generating)$/i }).first()
    outcome.stopClicked = false
    if (await stopButton.isVisible().catch(() => false)) {
      await stopButton.click({ timeout: 5000 }).catch(() => {})
      outcome.stopClicked = true
    } else {
      // The turn may have ended between the timeout check and here — the
      // turn/end poll below decides; a genuinely missing Stop is an anomaly
      // the record's stopClicked=false flag will surface.
      console.warn('[ui] Stop button not visible; turn may have just ended on its own')
    }
    const abortWindowMs = cfg.run.abortWaitMs ?? 60_000
    const abortOutcome = await waitTurnEndViaSessionLog(cfg, arenaPath, startedAtMs, abortWindowMs)
    outcome.abortConfirmed = abortOutcome.done
    if (!outcome.abortConfirmed) {
      console.error(`[ui] abort NOT confirmed within ${abortWindowMs / 1000}s (stopClicked=${outcome.stopClicked}); the residual turn may pollute the arena — flagging the record`)
    }
  }
  // The screenshot is monitoring residue only; a page wedged mid-render
  // (observed after a wedged agent turn) must never kill the run — grading
  // reads the arena, not the pixels.
  await page.screenshot({ path: screenshotPath, timeout: 20_000 })
    .catch(() => { console.warn('[ui] screenshot failed (page busy); grading the workspace state anyway') })
  return outcome
}
