import { useState } from 'react'
import type { LogEvent } from '../types'

const LEVEL_STYLES: Record<string, string> = {
  SEVERE: 'bg-red-900/60 text-red-300 border border-red-700',
  ERROR: 'bg-red-900/60 text-red-300 border border-red-700',
  FATAL: 'bg-orange-900/60 text-orange-300 border border-orange-700',
  WARNING: 'bg-yellow-900/60 text-yellow-300 border border-yellow-700',
  INFO: 'bg-sky-900/60 text-sky-300 border border-sky-700',
}

interface Props {
  events: LogEvent[]
  fatalOnly?: boolean
}

export default function EventFeed({ events, fatalOnly = false }: Props) {
  const FATAL_LEVELS = new Set(['SEVERE', 'ERROR', 'FATAL'])
  const displayed = fatalOnly
    ? events.filter(e => e.level && FATAL_LEVELS.has(e.level))
    : events

  if (displayed.length === 0) {
    return <p className="text-slate-500 text-sm py-4">No events to display.</p>
  }

  return (
    <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
      {displayed.map((ev, i) => (
        <EventRow key={i} event={ev} />
      ))}
    </div>
  )
}

function EventRow({ event }: { event: LogEvent }) {
  const [expanded, setExpanded] = useState(false)
  const levelStyle = LEVEL_STYLES[event.level ?? ''] ?? 'bg-slate-700 text-slate-300 border border-slate-600'

  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
      <div
        className="flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-slate-700/50 transition-colors"
        onClick={() => event.stack_trace && setExpanded(x => !x)}
      >
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 mt-0.5 ${levelStyle}`}>
          {event.level ?? '?'}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-slate-200 truncate">{event.message}</p>
          <p className="text-xs text-slate-500 mt-0.5">
            line {event.line_start} · {event.timestamp_raw ?? event.timestamp ?? '—'} · {event.logger ?? ''}
          </p>
        </div>
        {event.stack_trace && (
          <span className="text-slate-500 text-xs shrink-0 mt-1">
            {expanded ? '▲' : '▼'} stack
          </span>
        )}
      </div>
      {expanded && event.stack_trace && (
        <pre className="text-xs text-slate-400 bg-slate-900 px-4 py-3 overflow-x-auto border-t border-slate-700 whitespace-pre-wrap">
          {event.stack_trace}
        </pre>
      )}
    </div>
  )
}
