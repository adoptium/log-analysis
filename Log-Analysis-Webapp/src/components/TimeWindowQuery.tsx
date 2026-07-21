import { useState } from 'react'
import type { LogEvent, WindowResult } from '../types'
import EventFeed from './EventFeed'

interface Props {
  events: LogEvent[]
}

export default function TimeWindowQuery({ events }: Props) {
  const [center, setCenter] = useState('')
  const [beforeSecs, setBeforeSecs] = useState(3600)
  const [afterSecs, setAfterSecs] = useState(3600)
  const [result, setResult] = useState<WindowResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!center.trim()) return
    setLoading(true)
    setError(null)
    fetch('/in-window', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        events,
        center: center.trim(),
        before_seconds: beforeSecs,
        after_seconds: afterSecs,
      }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.events) setResult(data)
        else setError(data.detail ?? 'Unknown error')
      })
      .catch(() => setError('Request failed'))
      .finally(() => setLoading(false))
  }

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="bg-slate-800 rounded-xl p-5 space-y-4">
        <div>
          <label className="block text-xs text-slate-400 mb-1">Center Timestamp</label>
          <input
            type="text"
            placeholder="e.g. 2026-06-02 22:17:45.108+0000"
            value={center}
            onChange={e => setCenter(e.target.value)}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 font-mono placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <DurationField
            label="Before (seconds)"
            value={beforeSecs}
            onChange={setBeforeSecs}
          />
          <DurationField
            label="After (seconds)"
            value={afterSecs}
            onChange={setAfterSecs}
          />
        </div>

        <button
          type="submit"
          disabled={loading || !center.trim()}
          className="bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
        >
          {loading ? 'Querying...' : 'Query Window'}
        </button>
      </form>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {result && (
        <div className="space-y-3">
          <p className="text-sm text-slate-400">
            Found <span className="text-slate-200 font-semibold">{result.count}</span> events in window
          </p>
          <EventFeed events={result.events} />
        </div>
      )}
    </div>
  )
}

function DurationField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div>
      <label className="block text-xs text-slate-400 mb-1">{label}</label>
      <input
        type="number"
        min={0}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-violet-500"
      />
    </div>
  )
}
