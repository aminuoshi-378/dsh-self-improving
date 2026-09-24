import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const BASE_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']

/** Profile patch rows the bench owns; every other row survives a prepare rewrite. */
const BENCH_PATCH_IDS = new Set(['webserver', 'agent-default-model', 'system-prompt', 'self-improving'])

/**
 * Keep the rows prepare does not own: the 0.1.7 runtime persists provider
 * catalogs (llm-pi-ai) and UI state (ui-theme, onboarding acknowledgement)
 * into the profile patch, so a blind rewrite would drop the pinned model's
 * provider definition between runs and leave the composer disabled.
 * @param patchPath Existing cordis.patch.yml, when present.
 * @returns Top-level patch segments (verbatim) whose id the bench does not own.
 */
function preservedPatchRows(patchPath) {
  if (!existsSync(patchPath)) return []
  try {
    const segments = readFileSync(patchPath, 'utf8')
      .split('\n')
      .reduce((acc, line) => {
        if (/^- id: /.test(line)) acc.push([line])
        else if (acc.length > 0 && line.trim().length > 0) acc[acc.length - 1].push(line)
        return acc
      }, [])
    const kept = []
    for (const lines of segments) {
      const id = /^- id: (\S+)/.exec(lines[0])?.[1]
      if (id !== undefined && !BENCH_PATCH_IDS.has(id)) kept.push(lines.join('\n'))
    }
    return kept
  } catch {
    return []
  }
}

export function profileDir(cfg, arm) {
  return join(cfg.dshHome, 'profiles', cfg.profiles[arm])
}

function writeProfileFiles(cfg, arm) {
  const dir = profileDir(cfg, arm)
  mkdirSync(dir, { recursive: true })
  const enabled = arm === 'enabled' || arm === 'enabledRo'
  const bundles = enabled ? [...BASE_BUNDLES, 'dsh-self-improving'] : [...BASE_BUNDLES]
  const packageJson = {
    name: `dsh-profile-${cfg.profiles[arm]}`,
    private: true,
    dependencies: enabled ? { 'dsh-self-improving': `link:${cfg.pluginProject}` } : {},
    dsh: { profile: { bundles } },
  }
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`)
  writeFileSync(join(dir, 'cordis.yml'), '[]\n')

  const patch = [
    { id: 'webserver', config: { host: '127.0.0.1', port: cfg.ports[arm] } },
    { id: 'agent-default-model', config: { provider: cfg.model.provider, model: cfg.model.id } },
    { id: 'system-prompt', config: { persona: cfg.persona } },
  ]
  if (enabled) {
    patch.push({
      id: 'self-improving',
      config: {
        dbPath: cfg.dbPath,
        metaCognitionEnabled: true,
        behaviorAdapterEnabled: true,
        minInjectionScore: 0.3,
        // enabledRo: the new plugin's offline evaluation mode — read-only
        // store (injection intact, persistence no-op'd).
        ...(arm === 'enabledRo' ? { recordExperiences: false } : {}),
      },
    })
  }
  const yamlLines = patch.map((row) => {
    const lines = [`- id: ${row.id}`, '  config:']
    for (const [key, value] of Object.entries(row.config)) {
      const encoded = typeof value === 'string' ? `'${value}'` : String(value)
      lines.push(`    ${key}: ${encoded}`)
    }
    return lines.join('\n')
  })
  const preserved = preservedPatchRows(join(dir, 'cordis.patch.yml'))
  writeFileSync(join(dir, 'cordis.patch.yml'), `${[...yamlLines, ...preserved].join('\n')}\n`)

  if (enabled) {
    const modules = join(dir, 'node_modules')
    mkdirSync(modules, { recursive: true })
    const link = join(modules, 'dsh-self-improving')
    if (existsSync(link)) rmSync(link, { recursive: true, force: true })
    symlinkSync(cfg.pluginProject, link, 'dir')
  }
  return dir
}

/**
 * Create (or recreate) the bench profiles deterministically.
 * - baseline: no plugin
 * - enabled: plugin, WRITABLE store (training phase)
 * - enabledRo: plugin, recordExperiences:false -> read-only store (test phase
 *   uses the new plugin's offline evaluation mode: inject without leaking
 *   test-turn experience back into the trained library).
 */
export function ensureProfiles(cfg) {
  for (const arm of ['baseline', 'enabled', 'enabledRo']) writeProfileFiles(cfg, arm)
}

/** Compose-check both profiles via `dsh --dump-config` (never boots the app). */
export function verifyProfiles(cfg) {
  const problems = []
  for (const arm of ['baseline', 'enabled', 'enabledRo']) {
    const run = spawnSync('pnpm', ['exec', 'dsh', '--profile', cfg.profiles[arm], '--dump-config'], {
      cwd: cfg.dshRepo,
      encoding: 'utf8',
      env: process.env,
    })
    if (run.status !== 0) {
      problems.push(`${arm}: dsh --dump-config exited ${run.status}: ${(run.stderr ?? '').slice(0, 400)}`)
      continue
    }
    const dump = run.stdout
    const hasPlugin = dump.includes('self-improving')
    if (arm === 'enabled' && !hasPlugin) problems.push('enabled: self-improving row missing from composed config')
    if (arm === 'baseline' && hasPlugin) problems.push('baseline: self-improving leaked into composed config')
    if (!dump.includes(cfg.model.id)) problems.push(`${arm}: pinned model ${cfg.model.id} missing from dump`)
    if (!dump.includes(`port: ${cfg.ports[arm]}`)) problems.push(`${arm}: webserver port ${cfg.ports[arm]} missing from dump`)
    if (arm === 'enabled' && !dump.includes(cfg.dbPath)) problems.push('enabled: bench dbPath missing from dump')
    if (arm === 'enabledRo' && !dump.includes('recordExperiences: false')) problems.push('enabledRo: recordExperiences:false missing from dump')
  }
  return problems
}
