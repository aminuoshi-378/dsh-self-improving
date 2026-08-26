/**
 * Experiences panel — shows experience library stats and provides
 * import/export buttons for backup, migration, and team sharing.
 */
import { useEffect, useState, useRef } from 'react'
import type { ExperienceStats, ExportedExperience, ImportResult } from './types.js'

/** CRUD surface injected by the client plugin, spread into top-level props. */
export interface ExperiencesPanelInjected {
  readStats(): Promise<ExperienceStats | null>
  exportAll(): Promise<ExportedExperience[]>
  importExperiences(data: ExportedExperience[]): Promise<ImportResult>
}

export type ExperiencesPanelProps = ExperiencesPanelInjected

export function ExperiencesPanel({ readStats, exportAll, importExperiences }: ExperiencesPanelProps): JSX.Element {
  const [stats, setStats] = useState<ExperienceStats | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [status, setStatus] = useState<string>('')
  const [importPreview, setImportPreview] = useState<string>('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const load = async (): Promise<void> => {
      try {
        const s = await readStats()
        setStats(s)
      } catch (e) {
        setStatus(`load failed: ${(e as Error).message}`)
      } finally {
        setLoaded(true)
      }
    }
    void load()
  }, [readStats])

  const onRefresh = async (): Promise<void> => {
    setLoaded(false)
    try {
      const s = await readStats()
      setStats(s)
      setStatus('')
    } catch (e) {
      setStatus(`refresh failed: ${(e as Error).message}`)
    } finally {
      setLoaded(true)
    }
  }

  const onExport = async (): Promise<void> => {
    try {
      setStatus('exporting...')
      const data = await exportAll()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const date = new Date().toISOString().slice(0, 10)
      a.href = url
      a.download = `experiences-export-${date}.json`
      a.click()
      URL.revokeObjectURL(url)
      setStatus(`exported ${data.length} experiences`)
    } catch (e) {
      setStatus(`export failed: ${(e as Error).message}`)
    }
  }

  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const data = JSON.parse(text) as ExportedExperience[]
      if (!Array.isArray(data)) {
        setStatus('import failed: file is not a JSON array')
        return
      }
      const valid = data.filter((d) => d && typeof d.id === 'string' && typeof d.outcomeScore === 'number')
      setImportPreview(`Will import ${valid.length} of ${data.length} records (${data.length - valid.length} invalid)`)
    } catch (err) {
      setStatus(`import failed: ${(err as Error).message}`)
    }
  }

  const onImportConfirm = async (): Promise<void> => {
    const file = fileInputRef.current?.files?.[0]
    if (!file) return
    try {
      setStatus('importing...')
      const text = await file.text()
      const data = JSON.parse(text) as ExportedExperience[]
      const result = await importExperiences(data)
      setStatus(`imported ${result.imported}, skipped ${result.skipped} (duplicate), invalid ${result.invalid}`)
      setImportPreview('')
      // Refresh stats
      await onRefresh()
    } catch (e) {
      setStatus(`import failed: ${(e as Error).message}`)
    }
  }

  return (
    <div className="experiences-panel">
      <p>
        View the agent's cross-session experience library. Export for backup or machine migration,
        import to restore or share experiences across teams.
      </p>

      {/* Stats section */}
      <h3>Library Statistics</h3>
      {loaded && stats ? (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            <StatRow label="Total Experiences" value={stats.total} />
            <StatRow label="Average Score" value={stats.avgScore.toFixed(2)} />
            <StatRow label="With Lessons" value={stats.withLessons} />
            <StatRow label="Positive Feedback" value={stats.positiveCount} />
            <StatRow label="Negative Feedback" value={stats.negativeCount} />
            <StatRow label="High Difficulty" value={stats.highDifficultyCount} />
            <StatRow label="Young Gen (new)" value={stats.youngGenCount} />
            <StatRow label="Old Gen (promoted)" value={stats.oldGenCount} />
            <StatRow label="Merged" value={stats.mergedCount} />
          </tbody>
        </table>
      ) : loaded ? (
        <p>No experience data available yet. Run some tasks to accumulate experiences.</p>
      ) : (
        <p>Loading...</p>
      )}

      {/* Actions */}
      <div style={{ marginTop: '1rem' }}>
        <button type="button" onClick={() => void onRefresh()} disabled={!loaded} style={{ marginRight: '0.5rem' }}>
          Refresh
        </button>
        <button type="button" onClick={() => void onExport()} disabled={!loaded} style={{ marginRight: '0.5rem' }}>
          Export
        </button>
      </div>

      {/* Import section */}
      <h3 style={{ marginTop: '1.5rem' }}>Import Experiences</h3>
      <p>Select a previously exported JSON file to import experiences. Duplicate IDs will be skipped.</p>
      <div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={(e) => void onImportFile(e)}
          style={{ marginBottom: '0.5rem' }}
        />
      </div>
      {importPreview && (
        <p style={{ color: '#64748b' }}>{importPreview}</p>
      )}
      <button
        type="button"
        onClick={() => void onImportConfirm()}
        disabled={!importPreview}
      >
        Confirm Import
      </button>

      {status && (
        <p style={{ marginTop: '1rem', color: '#64748b' }}>{status}</p>
      )}
    </div>
  )
}

function StatRow({ label, value }: { label: string; value: string | number }): JSX.Element {
  return (
    <tr>
      <td style={{ padding: '4px 8px', borderBottom: '1px solid #e2e8f0', fontWeight: 500 }}>{label}</td>
      <td style={{ padding: '4px 8px', borderBottom: '1px solid #e2e8f0', textAlign: 'right' }}>{value}</td>
    </tr>
  )
}
