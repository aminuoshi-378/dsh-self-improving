/**
 * Rules panel — edits the single `rules` setting.
 * A text area for the advisory guidance injected into the system prompt.
 */
import { useEffect, useState } from 'react'
import type { RuleSettings } from './types.js'

/** CRUD surface injected by the client plugin, spread into top-level props */
/** (the slot system flattens the inject face onto the component, see index.ts). */
export interface RulesPanelInjected {
  read(): Promise<RuleSettings>
  save(rules: string): Promise<void>
}

export type RulesPanelProps = RulesPanelInjected

export function RulesPanel({ read, save }: RulesPanelProps): JSX.Element {
  const [rules, setRules] = useState<string>('')
  const [loaded, setLoaded] = useState(false)
  const [status, setStatus] = useState<string>('')

  useEffect(() => {
    const load = async (): Promise<void> => {
      try {
        const doc = await read()
        setRules(doc.rules ?? '')
      } catch (e) {
        setStatus(`load failed: ${(e as Error).message}`)
      } finally {
        setLoaded(true)
      }
    }
    void load()
  }, [read, save])

  const onSave = async (): Promise<void> => {
    try {
      await save(rules)
      setStatus('saved')
    } catch (e) {
      setStatus(`save failed: ${(e as Error).message}`)
    }
  }

  return (
    <div className="rules-panel">
      <p>
        This text is injected into the agent's system prompt as advisory guidance
        (the model may heed or ignore it).
      </p>
      <textarea
        value={rules}
        onChange={(e) => setRules(e.target.value)}
        disabled={!loaded}
        rows={20}
        style={{ width: '100%', fontFamily: 'monospace' }}
        aria-label="rules"
      />
      <div>
        <button type="button" onClick={() => void onSave()} disabled={!loaded}>
          Save
        </button>
        {status && <span style={{ marginLeft: '0.5rem', color: '#64748b' }}>{status}</span>}
      </div>
    </div>
  )
}