import { useState, useEffect } from 'react'
import type { LogEvent, TopTemplate } from '../types'

interface Props {
  events: LogEvent[]
}

export default function TopTemplates({ events }: Props) {
  const [n, setN] = useState(20)
  const [templates, setTemplates] = useState<TopTemplate[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (events.length === 0) return
    setLoading(true)
    setError(null)
    fetch('/top-templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events, n }),
    })
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setTemplates(data)
        else setError(data.detail ?? 'Unknown error')
      })
      .catch(() => setError('Failed to fetch templates'))
      .finally(() => setLoading(false))
  }, [events, n])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <label className="text-sm text-slate-400">Show top</label>
        <input
          type="number"
          min={1}
          max={200}
          value={n}
          onChange={e => setN(Number(e.target.value))}
          className="w-20 bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-violet-500"
        />
        <span className="text-sm text-slate-400">templates</span>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {loading ? (
        <p className="text-slate-400 text-sm animate-pulse">Loading...</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800 text-slate-400 text-left">
                <th className="px-4 py-3 font-medium w-12">#</th>
                <th className="px-4 py-3 font-medium w-20">ID</th>
                <th className="px-4 py-3 font-medium w-20">Count</th>
                <th className="px-4 py-3 font-medium">Template</th>
                <th className="px-4 py-3 font-medium">Example</th>
              </tr>
            </thead>
            <tbody>
              {templates.map(t => (
                <tr key={t.rank} className="border-t border-slate-700 hover:bg-slate-800/50 transition-colors">
                  <td className="px-4 py-3 text-slate-500">{t.rank}</td>
                  <td className="px-4 py-3 text-slate-500">{t.template_id ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className="bg-violet-900/50 text-violet-300 px-2 py-0.5 rounded-full text-xs font-mono">
                      {t.count}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-300 max-w-xs truncate" title={t.template ?? ''}>
                    {t.template ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs max-w-xs truncate" title={t.example}>
                    {t.example}
                  </td>
                </tr>
              ))}
              {templates.length === 0 && !loading && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    No templates found. Make sure drain3 is installed and the log was analyzed.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
