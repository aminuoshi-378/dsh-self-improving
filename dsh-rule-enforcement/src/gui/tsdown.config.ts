/**
 * Standalone tsdown config for the dsh-rule-enforcement-gui bundle.
 *
 * Produces the two artifacts dsh expects from a client plugin package:
 *   - lib/index.js    — host loader entry (the `dsh-rule-enforcement-gui` row's apply)
 *   - lib/client.js   — self-registering browser bundle consumed by dsh's module table
 *
 * `@deepseek-ai/*` stay external: the running web app provides them from its
 * module table at runtime; the browser bundle only registers their ids in the
 * `window.__ModuleLoader__.load({ id, factory })` closure. This lets the GUI
 * build OUTSIDE the dsh monorepo (no peer install of the whole runtime needed).
 */
import { defineConfig } from 'tsdown'

const ID = 'dsh-rule-enforcement-gui'

/** Specifiers the browser module table provides — must remain external. */
const CLIENT_EXTERNALS = [
  '@deepseek-ai/dsh-client-runtime',
]

const isExternal = (specifier: string): boolean =>
  CLIENT_EXTERNALS.includes(specifier) ||
  specifier === 'react' ||
  specifier === 'react/jsx-runtime' ||
  specifier === 'react/jsx-dev-runtime' ||
  specifier === 'react-dom' ||
  specifier.startsWith('react-dom/')

export default defineConfig([
  {
    name: ID,
    entry: { index: 'lib/types/index.js' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    dts: false,
    clean: false,
  },
  {
    name: `${ID}/client`,
    entry: { client: 'lib/types/client/index.js' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    sourcemap: true,
    clean: false,
    deps: {
      neverBundle: isExternal,
      alwaysBundle: (s: string) => !isExternal(s),
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])