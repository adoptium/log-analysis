import { useState } from 'react'
import type { Rule } from '../types'

interface Props {
  rules: Rule[]
  onChange: (rules: Rule[]) => void
}

const EMPTY_FORM: Omit<Rule, 'id'> = {
  name: '',
  action: 'ignore',
  level: '',
  logger_regex: '',
  message_regex: '',
  stack_regex: '',
  tag: '',
  set_level: '',
}

export default function RuleConfigurator({ rules, onChange }: Props) {
  const [form, setForm] = useState<Omit<Rule, 'id'>>({ ...EMPTY_FORM })

  function addRule() {
    if (!form.name.trim()) return
    const rule: Rule = {
      ...form,
      id: crypto.randomUUID(),
      // strip empty optional strings so they don't get sent as ""
      level: form.level || undefined,
      logger_regex: form.logger_regex || undefined,
      message_regex: form.message_regex || undefined,
      stack_regex: form.stack_regex || undefined,
      tag: form.tag || undefined,
      set_level: form.set_level || undefined,
    }
    onChange([...rules, rule])
    setForm({ ...EMPTY_FORM })
  }

  function removeRule(id: string) {
    onChange(rules.filter(r => r.id !== id))
  }

  return (
    <div className="space-y-6">
      {/* Existing rules */}
      {rules.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Active Rules</h3>
          {rules.map(rule => (
            <div key={rule.id} className="flex items-center justify-between bg-slate-800 rounded-lg px-4 py-3 border border-slate-700">
              <div className="text-sm">
                <span className="text-slate-200 font-medium">{rule.name}</span>
                <span className="text-slate-500 mx-2">·</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  rule.action === 'ignore' ? 'bg-slate-700 text-slate-300' :
                  rule.action === 'tag' ? 'bg-violet-900/60 text-violet-300' :
                  'bg-yellow-900/60 text-yellow-300'
                }`}>{rule.action}</span>
                {rule.message_regex && (
                  <span className="text-slate-500 text-xs ml-2">msg: <code className="text-slate-400">{rule.message_regex}</code></span>
                )}
                {rule.stack_regex && (
                  <span className="text-slate-500 text-xs ml-2">stack: <code className="text-slate-400">{rule.stack_regex}</code></span>
                )}
                {rule.tag && (
                  <span className="text-slate-500 text-xs ml-2">tag: <code className="text-violet-400">{rule.tag}</code></span>
                )}
              </div>
              <button
                onClick={() => removeRule(rule.id)}
                className="text-slate-500 hover:text-red-400 text-sm transition-colors ml-4 shrink-0"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add rule form */}
      <div className="bg-slate-800 rounded-xl p-5 border border-slate-700 space-y-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Add Rule</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Rule Name *" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} placeholder="e.g. ignore-anon-perms" />

          <div>
            <label className="block text-xs text-slate-400 mb-1">Action *</label>
            <select
              value={form.action}
              onChange={e => setForm(f => ({ ...f, action: e.target.value as Rule['action'] }))}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-violet-500"
            >
              <option value="ignore">ignore</option>
              <option value="tag">tag</option>
              <option value="set_level">set_level</option>
            </select>
          </div>

          <Field label="Level match" value={form.level ?? ''} onChange={v => setForm(f => ({ ...f, level: v }))} placeholder="e.g. WARNING" />
          <Field label="Logger regex" value={form.logger_regex ?? ''} onChange={v => setForm(f => ({ ...f, logger_regex: v }))} placeholder="e.g. WorkflowRun" />
          <Field label="Message regex" value={form.message_regex ?? ''} onChange={v => setForm(f => ({ ...f, message_regex: v }))} placeholder="e.g. anonymous is missing" />
          <Field label="Stack regex" value={form.stack_regex ?? ''} onChange={v => setForm(f => ({ ...f, stack_regex: v }))} placeholder="e.g. OutOfMemoryError" />

          {form.action === 'tag' && (
            <Field label="Tag value *" value={form.tag ?? ''} onChange={v => setForm(f => ({ ...f, tag: v }))} placeholder="e.g. critical" />
          )}
          {form.action === 'set_level' && (
            <Field label="New level *" value={form.set_level ?? ''} onChange={v => setForm(f => ({ ...f, set_level: v }))} placeholder="e.g. SEVERE" />
          )}
        </div>

        <button
          onClick={addRule}
          disabled={!form.name.trim()}
          className="bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
        >
          Add Rule
        </button>
      </div>

      {rules.length > 0 && (
        <p className="text-xs text-slate-500">
          Rules take effect when you re-upload the log file.
        </p>
      )}
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div>
      <label className="block text-xs text-slate-400 mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500"
      />
    </div>
  )
}
