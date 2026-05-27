import { createHash } from 'node:crypto'
import type { AgentMemorySource } from './types'

const FILLER_PATTERNS = [
  /\bget me\b/g,
  /\bshow me\b/g,
  /\bfind me\b/g,
  /\bfind\b/g,
  /\bsearch\b/g,
  /\bthe\b/g,
  /\ba\b/g,
  /\ban\b/g,
  /\bclient called\b/g,
  /\bcalled\b/g,
  /\bclient\b/g,
  /\bcontact\b/g,
  /\bcompany\b/g,
  /\bplease\b/g,
]

export function normalizeLookupText(value: string): string {
  let text = value.toLowerCase().replace(/[^a-z0-9]+/g, ' ')
  for (const pattern of FILLER_PATTERNS) text = text.replace(pattern, ' ')
  return text.replace(/\s+/g, ' ').trim()
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (!value || typeof value !== 'object') return JSON.stringify(value)
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
    .join(',')}}`
}

export function hashMemorySource(source: AgentMemorySource): string {
  return createHash('sha256')
    .update(stableJson({
      orgId: source.orgId,
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      title: source.title,
      summary: source.summary ?? '',
      text: source.text,
      metadata: source.metadata ?? {},
      sourceUpdatedAt: source.sourceUpdatedAt ?? '',
    }))
    .digest('hex')
}

function safeIdPart(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160) || 'unknown'
}

export function memoryDocId(source: Pick<AgentMemorySource, 'orgId' | 'sourceType' | 'sourceId'>, chunkIndex: number): string {
  return `${safeIdPart(source.orgId)}__${safeIdPart(String(source.sourceType))}__${safeIdPart(source.sourceId)}__${chunkIndex}`
}

export function chunkMemoryText(
  text: string,
  options: { maxChars?: number; overlapChars?: number } = {},
): string[] {
  const maxChars = options.maxChars ?? 1800
  const overlapChars = options.overlapChars ?? 180
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return []
  if (clean.length <= maxChars) return [clean]

  const chunks: string[] = []
  let cursor = 0
  while (cursor < clean.length) {
    let end = Math.min(cursor + maxChars, clean.length)
    if (end < clean.length) {
      const boundary = Math.max(
        clean.lastIndexOf('. ', end),
        clean.lastIndexOf('; ', end),
        clean.lastIndexOf(', ', end),
        clean.lastIndexOf(' ', end),
      )
      if (boundary > cursor + Math.floor(maxChars * 0.55)) end = boundary + 1
    }
    const chunk = clean.slice(cursor, end).trim()
    if (chunk) chunks.push(chunk)
    if (end >= clean.length) break
    cursor = Math.max(0, end - overlapChars)
  }
  return chunks
}

export function sourceToChunkTexts(source: AgentMemorySource): Array<{ index: number; text: string }> {
  const parts = [
    source.title ? `Title: ${source.title}` : '',
    source.summary ? `Summary: ${source.summary}` : '',
    source.text,
  ].filter(Boolean)
  return chunkMemoryText(parts.join('\n\n')).map((text, index) => ({ index, text }))
}
