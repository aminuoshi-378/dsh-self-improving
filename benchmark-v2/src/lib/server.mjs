import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const TOKEN_URL_RE = /https?:\/\/(127\.0\.0\.1|localhost):\d+\/\?token=[\w-]+/g

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Pre-boot guard: a leftover bench server on the arm port must die. */
export function clearStaleBenchPort(cfg, arm) {
  const port = cfg.ports[arm]
  const probe = spawnSync('lsof', ['-ti', `:${port}`], { encoding: 'utf8' })
  for (const pid of (probe.stdout ?? '').split('\n').filter(Boolean)) {
    const inspect = spawnSync('ps', ['-p', pid, '-o', 'command='], { encoding: 'utf8' })
    const command = inspect.stdout ?? ''
    if (command.includes(cfg.profiles[arm])) {
      try {
        process.kill(Number(pid), 'SIGTERM')
        process.kill(Number(pid), 'SIGKILL')
      } catch {
        /* raced away */
      }
    } else {
      throw new Error(`port ${port} is held by a NON-bench process (pid ${pid}: ${command.trim().slice(0, 80)}); refusing to kill it`)
    }
  }
}

/** Boot `dsh --profile <arm> web --no-open` and extract the token URL. */
export async function startServer(cfg, arm, logFile) {
  clearStaleBenchPort(cfg, arm)
  mkdirSync(join(logFile, '..'), { recursive: true })
  // Only a URL never seen before this boot can satisfy readiness: appended
  // logs from earlier boots must never satisfy a new server's readiness
  // check (stale-log race). A known-URL set sidesteps byte/char offset math
  // on an appended multi-byte log entirely.
  const knownUrls = new Set(
    [...(existsSync(logFile) ? readFileSync(logFile, 'utf8') : '').matchAll(TOKEN_URL_RE)].map(m => m[0]),
  )
  appendFileSync(logFile, `\n===== start ${new Date().toISOString()} =====\n`)
  // The server writes straight into the log file descriptor: a pipe+capture
  // relay proved fragile in this runner (observed: zero bytes relayed for a
  // server that booted fine when spawned outside the runner process), and a
  // descriptor also shows boot progress even when the server wedges early.
  const logFd = openSync(logFile, 'a')
  const child = spawn(process.execPath, [join(cfg.dshRepo, 'apps/cli/lib/bin.js'), '--profile', cfg.profiles[arm], '--no-open'], {
    cwd: cfg.dshRepo,
    detached: true,
    stdio: ['ignore', logFd, logFd],
  })

  // 0.1.7 boots the web app far slower than the 0.1.6-era 90s budget under
  // memory pressure (observed >90s cold with the URL still arriving); the
  // loop returns the moment the URL matches, so a generous cap costs nothing.
  const deadline = Date.now() + 300_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      const tail = existsSync(logFile) ? readFileSync(logFile, 'utf8').slice(-1500) : ''
      throw new Error(`dsh web (${arm}) exited early with code ${child.exitCode}\n${tail}`)
    }
    if (existsSync(logFile)) {
      const tokenUrl = [...readFileSync(logFile, 'utf8').matchAll(TOKEN_URL_RE)]
        .map(m => m[0])
        .find(url => !knownUrls.has(url))
      if (tokenUrl !== undefined) {
        // The URL is printed before the listener is guaranteed; wait until it
        // actually accepts connections before handing it to the browser.
        const readyDeadline = Date.now() + 60_000
        while (Date.now() < readyDeadline) {
          try {
            await fetch(tokenUrl)
            return { child, arm, logFile, tokenUrl }
          } catch {
            await sleep(1000)
          }
        }
        killTree({ child })
        throw new Error(`dsh web (${arm}) printed ${tokenUrl} but it never became reachable`)
      }
    }
    await sleep(1000)
  }
  killTree({ child })
  throw new Error(`dsh web (${arm}) did not print a token URL within 300s; see ${logFile}`)
}

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Kill the detached process group with escalation: pnpm's node child does not
 * always die with a single group SIGTERM (observed: orphaned dsh kept the port).
 */
export async function killTree(server) {
  if (!server || !server.child || server.child.exitCode !== null) return
  const group = server.child.pid
  try {
    process.kill(-group, 'SIGTERM')
  } catch {
    /* already gone */
  }
  for (let i = 0; i < 6; i++) {
    await sleepMs(500)
    if (server.child.exitCode !== null) return
    try {
      process.kill(-group, 0)
    } catch {
      return
    }
  }
  try {
    process.kill(-group, 'SIGKILL')
  } catch {
    /* already gone */
  }
}

/** Assert plugin stderr markers appear only in the enabled arm (contamination guard). */
export function checkPluginMarkers(logFile, arm) {
  if (!existsSync(logFile)) return arm === 'enabled' ? ['log file missing — cannot verify plugin markers'] : []
  const log = readFileSync(logFile, 'utf8')
  const loaded = log.includes('[self-improving] plugin loaded')
  const problems = []
  if (arm === 'baseline' && loaded) problems.push('baseline server log contains [self-improving] — arm contamination')
  if (arm === 'enabled' && !loaded) problems.push('enabled server log missing [self-improving] plugin loaded marker')
  return problems
}
