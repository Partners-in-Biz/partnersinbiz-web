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

export const PART_LIMITS = {
  chartRows: 2_000,
  chartSeries: 12,
  mermaidChars: 20_000,
  mathChars: 5_000,
  htmlChars: 200_000,
  fileNameChars: 200,
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
  return { ok: true, part }
}
