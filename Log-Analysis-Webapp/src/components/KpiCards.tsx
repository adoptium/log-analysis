import type { AnalysisResult } from '../types'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'

const LEVEL_COLORS: Record<string, string> = {
  INFO: '#38bdf8',
  WARNING: '#fbbf24',
  SEVERE: '#f87171',
  ERROR: '#f87171',
  FATAL: '#fb923c',
}

interface Props {
  result: AnalysisResult
}

export default function KpiCards({ result }: Props) {
  const chartData = Object.entries(result.level_counts).map(([level, count]) => ({
    level,
    count,
  }))

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card label="Total Events" value={result.total} color="text-slate-200" />
        <Card label="Active Events" value={result.active} color="text-green-400" />
        <Card label="Ignored" value={result.ignored} color="text-slate-400" />
        <Card
          label="Fatal / Error"
          value={
            (result.level_counts['SEVERE'] ?? 0) +
            (result.level_counts['ERROR'] ?? 0) +
            (result.level_counts['FATAL'] ?? 0)
          }
          color="text-red-400"
        />
      </div>

      <div className="bg-slate-800 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-slate-400 mb-3">Events by Level</h3>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
            <XAxis dataKey="level" tick={{ fill: '#94a3b8', fontSize: 12 }} />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 12 }} />
            <Tooltip
              contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
              labelStyle={{ color: '#e2e8f0' }}
              itemStyle={{ color: '#94a3b8' }}
            />
            <Bar dataKey="count" radius={[4, 4, 0, 0]}>
              {chartData.map(entry => (
                <Cell key={entry.level} fill={LEVEL_COLORS[entry.level] ?? '#6366f1'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function Card({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-slate-800 rounded-xl p-4">
      <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-3xl font-bold ${color}`}>{value.toLocaleString()}</p>
    </div>
  )
}
