import type {
  ActionCardPart,
  BrowserFramePart,
  ChartPart,
  FilePartV2,
  HtmlArtifactPart,
  MathPart,
  MermaidPart,
  SystemEventPart,
} from '@/lib/chat/parts'
import type { RichMessagePart } from '@/lib/hermes/types'

const CHART_KINDS = new Set<ChartPart['kind']>(['line', 'bar', 'area', 'pie', 'scatter'])

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function toChartPart(part: RichMessagePart): ChartPart | null {
  const kind = part.kind
  if (typeof kind !== 'string' || !CHART_KINDS.has(kind as ChartPart['kind'])) return null
  if (typeof part.x !== 'string' || !part.x.trim()) return null
  const seriesRaw = Array.isArray(part.series) ? part.series : []
  const series = seriesRaw.flatMap((item) => {
    const record = asRecord(item)
    if (!record || typeof record.key !== 'string') return []
    return [{
      key: record.key,
      ...(typeof record.label === 'string' ? { label: record.label } : {}),
      ...(typeof record.color === 'string' ? { color: record.color } : {}),
    }]
  })
  const dataRaw = Array.isArray(part.data) ? part.data : []
  const data = dataRaw.flatMap((row) => {
    const record = asRecord(row)
    if (!record) return []
    const next: Record<string, string | number | null> = {}
    for (const [key, value] of Object.entries(record)) {
      if (typeof value === 'string' || typeof value === 'number' || value === null) next[key] = value
    }
    return [next]
  })
  return {
    type: 'chart',
    kind: kind as ChartPart['kind'],
    ...(typeof part.title === 'string' ? { title: part.title } : {}),
    ...(typeof part.unit === 'string' ? { unit: part.unit } : {}),
    ...(part.stacked ? { stacked: true } : {}),
    x: part.x,
    series,
    data,
  }
}

export function toMermaidPart(part: RichMessagePart): MermaidPart {
  const source = typeof part.source === 'string'
    ? part.source
    : typeof part.content === 'string' ? part.content : ''
  return {
    type: 'mermaid',
    source,
    ...(typeof part.title === 'string' ? { title: part.title } : {}),
  }
}

export function toMathPart(part: RichMessagePart): MathPart {
  const latex = typeof part.latex === 'string'
    ? part.latex
    : typeof part.content === 'string' ? part.content : ''
  return {
    type: 'math',
    latex,
    ...(part.display === true ? { display: true } : {}),
  }
}

export function toHtmlArtifactPart(part: RichMessagePart): HtmlArtifactPart | null {
  const html = typeof part.html === 'string'
    ? part.html
    : typeof part.content === 'string' ? part.content : ''
  if (typeof part.title !== 'string' || !part.title.trim()) return null
  return {
    type: 'html_artifact',
    title: part.title,
    html,
    ...(typeof part.height === 'number' ? { height: part.height } : {}),
  }
}

export function toFilePartV2(part: RichMessagePart): FilePartV2 {
  const contentType = typeof part.contentType === 'string'
    ? part.contentType
    : typeof part.mimeType === 'string' ? part.mimeType : ''
  const size = typeof part.size === 'number'
    ? part.size
    : typeof part.sizeBytes === 'number' ? part.sizeBytes : undefined
  return {
    type: 'file',
    url: typeof part.url === 'string' ? part.url : '',
    name: typeof part.name === 'string' ? part.name : typeof part.title === 'string' ? part.title : 'File',
    contentType,
    ...(typeof size === 'number' ? { size } : {}),
    ...(typeof part.previewUrl === 'string' ? { previewUrl: part.previewUrl } : {}),
  }
}

export function toBrowserFramePart(part: RichMessagePart): BrowserFramePart {
  return {
    type: 'browser_frame',
    screenshotUrl: typeof part.screenshotUrl === 'string' ? part.screenshotUrl : '',
    url: typeof part.url === 'string' ? part.url : '',
    ...(typeof part.sessionId === 'string' ? { sessionId: part.sessionId } : {}),
  }
}

export function toSystemEventPart(part: RichMessagePart): SystemEventPart | null {
  const summary = typeof part.summary === 'string' ? part.summary : typeof part.content === 'string' ? part.content : ''
  if (!summary.trim()) return null
  const actorKind = part.actorKind === 'user' || part.actorKind === 'agent' ? part.actorKind : 'system'
  return {
    type: 'system_event',
    eventKind: typeof part.eventKind === 'string' && part.eventKind ? part.eventKind : 'event',
    actorKind,
    actorLabel: typeof part.actorLabel === 'string' && part.actorLabel ? part.actorLabel : 'System',
    summary,
    at: typeof part.at === 'string' && part.at ? part.at : new Date(0).toISOString(),
    ...(typeof part.href === 'string' && part.href ? { href: part.href } : {}),
  }
}

const ACTION_KINDS = new Set<ActionCardPart['kind']>([
  'email_sent', 'file_written', 'pr_opened', 'post_scheduled', 'routine_run', 'custom',
])

export function toActionCardPart(part: RichMessagePart): ActionCardPart | null {
  const title = typeof part.title === 'string' ? part.title : ''
  if (!title.trim()) return null
  const kind = typeof part.kind === 'string' && ACTION_KINDS.has(part.kind as ActionCardPart['kind'])
    ? part.kind as ActionCardPart['kind']
    : 'custom'
  const status = part.status === 'pending' || part.status === 'succeeded' || part.status === 'failed' || part.status === 'cancelled'
    ? part.status
    : undefined
  return {
    type: 'action_card',
    kind,
    title,
    ...(typeof part.detail === 'string' ? { detail: part.detail } : {}),
    ...(status ? { status } : {}),
    ...(typeof part.url === 'string' ? { url: part.url } : {}),
    ...(part.meta && typeof part.meta === 'object' && !Array.isArray(part.meta)
      ? { meta: part.meta as ActionCardPart['meta'] }
      : {}),
  }
}
