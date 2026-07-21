export interface LogEvent {
  line_start: number
  line_end: number
  timestamp: string | null
  timestamp_raw: string | null
  thread_id: string | null
  level: string | null
  logger: string | null
  method: string | null
  message: string
  stack_trace: string | null
  raw: string
  template_id: number | null
  template: string | null
  tags: string[]
  ignored: boolean
}

export interface Rule {
  id: string // client-only, not sent to API
  name: string
  action: 'ignore' | 'tag' | 'set_level'
  level?: string
  logger_regex?: string
  message_regex?: string
  stack_regex?: string
  tag?: string
  set_level?: string
}

export interface AnalysisResult {
  events: LogEvent[]
  level_counts: Record<string, number>
  total: number
  active: number
  ignored: number
}

export interface TopTemplate {
  rank: number
  template_id: number | null
  count: number
  template: string | null
  example: string
}

export interface WindowResult {
  events: LogEvent[]
  count: number
}
