import type { RichMessagePart } from '@/lib/hermes/types'

export interface ChartPart {
  type: 'chart'
  kind: 'line' | 'bar' | 'area' | 'pie' | 'scatter'
  title?: string
  unit?: string
  stacked?: boolean
  x: string
  series: Array<{ key: string; label?: string; color?: string }>
  data: Array<Record<string, string | number | null>>
}

export interface MermaidPart {
  type: 'mermaid'
  source: string
  title?: string
}

export interface MathPart {
  type: 'math'
  latex: string
  display?: boolean
}

export interface HtmlArtifactPart {
  type: 'html_artifact'
  title: string
  html: string
  height?: number
}

export interface FilePartV2 {
  type: 'file'
  url: string
  name: string
  contentType: string
  size?: number
  previewUrl?: string
}

export interface BrowserFramePart {
  type: 'browser_frame'
  screenshotUrl: string
  url: string
  sessionId?: string
}

export interface SystemEventPart {
  type: 'system_event'
  eventKind: string
  actorKind: 'user' | 'agent' | 'system'
  actorLabel: string
  summary: string
  at: string
  href?: string
}

export type ActionCardKind =
  | 'email_sent'
  | 'file_written'
  | 'pr_opened'
  | 'post_scheduled'
  | 'routine_run'
  | 'custom'

export interface ActionCardPart {
  type: 'action_card'
  kind: ActionCardKind
  title: string
  detail?: string
  status?: 'pending' | 'succeeded' | 'failed' | 'cancelled'
  url?: string
  meta?: Record<string, string | number | boolean | null>
}

export interface RoutineProposalPart {
  type: 'routine_proposal'
  name: string
  prompt: string
  schedule?: string
  triggerKind?: 'schedule' | 'event'
  agentId?: string
}

export const PART_LIMITS = {
  chartRows: 2_000,
  chartSeries: 12,
  mermaidChars: 20_000,
  mathChars: 5_000,
  htmlChars: 200_000,
  fileNameChars: 200,
  systemEventSummaryChars: 500,
  actionCardTitleChars: 200,
  actionCardDetailChars: 2_000,
} as const

export function validatePart(part: RichMessagePart): { ok: true; part: RichMessagePart } | { ok: false; reason: string } {
  const type = String(part.type || '').toLowerCase()
  if (type === 'chart') {
    const data = Array.isArray(part.data) ? part.data : []
    const series = Array.isArray(part.series) ? part.series : []
    if (data.length > PART_LIMITS.chartRows) return { ok: false, reason: `chart has more than ${PART_LIMITS.chartRows} rows` }
    if (series.length > PART_LIMITS.chartSeries) return { ok: false, reason: `chart has more than ${PART_LIMITS.chartSeries} series` }
    if (typeof part.x !== 'string' || !part.x.trim()) return { ok: false, reason: 'chart is missing an x key' }
    return { ok: true, part }
  }
  if (type === 'mermaid') {
    const source = typeof part.source === 'string' ? part.source : typeof part.content === 'string' ? part.content : ''
    if (source.length > PART_LIMITS.mermaidChars) return { ok: false, reason: 'mermaid source is too large' }
    if (!source.trim()) return { ok: false, reason: 'mermaid source is empty' }
    return { ok: true, part: { ...part, source } }
  }
  if (type === 'math') {
    const latex = typeof part.latex === 'string' ? part.latex : typeof part.content === 'string' ? part.content : ''
    if (latex.length > PART_LIMITS.mathChars) return { ok: false, reason: 'math source is too large' }
    if (!latex.trim()) return { ok: false, reason: 'math source is empty' }
    return { ok: true, part: { ...part, latex } }
  }
  if (type === 'html_artifact') {
    const html = typeof part.html === 'string' ? part.html : typeof part.content === 'string' ? part.content : ''
    if (html.length > PART_LIMITS.htmlChars) return { ok: false, reason: 'html artifact is too large' }
    if (typeof part.title !== 'string' || !part.title.trim()) return { ok: false, reason: 'html artifact is missing a title' }
    return { ok: true, part: { ...part, html } }
  }
  if (type === 'file') {
    const name = typeof part.name === 'string' ? part.name : ''
    if (name.length > PART_LIMITS.fileNameChars) return { ok: false, reason: 'file name is too long' }
    if (typeof part.url !== 'string' || !part.url.trim()) return { ok: false, reason: 'file is missing a url' }
    return { ok: true, part }
  }
  if (type === 'system_event') {
    const summary = typeof part.summary === 'string' ? part.summary : ''
    if (!summary.trim()) return { ok: false, reason: 'system event is missing a summary' }
    if (summary.length > PART_LIMITS.systemEventSummaryChars) return { ok: false, reason: 'system event summary is too long' }
    return { ok: true, part }
  }
  if (type === 'action_card') {
    const title = typeof part.title === 'string' ? part.title : ''
    if (!title.trim()) return { ok: false, reason: 'action card is missing a title' }
    if (title.length > PART_LIMITS.actionCardTitleChars) return { ok: false, reason: 'action card title is too long' }
    const detail = typeof part.detail === 'string' ? part.detail : ''
    if (detail.length > PART_LIMITS.actionCardDetailChars) return { ok: false, reason: 'action card detail is too long' }
    return { ok: true, part }
  }
  return { ok: true, part }
}
