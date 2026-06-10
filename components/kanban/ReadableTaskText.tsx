import React from 'react'

type ReadableTaskTextProps = {
  text?: string | null
  empty?: React.ReactNode
  className?: string
  compact?: boolean
}

type DetailBlock = {
  label?: string
  body: string
}

const URL_PATTERN = /(https?:\/\/[^\s)\]}>,]+)/g
const FIELD_LABELS = [
  'summary',
  'what this means',
  'site',
  'task id',
  'task type',
  'issue',
  'what is wrong',
  'verification',
  'what i verified',
  'how to fix',
  'how to fix/unblock',
  'unblock',
  'proof needed',
  'evidence required',
  'required evidence',
  'after resolved',
  'message for agent',
  'when resolved tell theo',
  'when resolved tell silas',
]

function labelPattern(): RegExp {
  const source = FIELD_LABELS
    .map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'))
    .sort((a, b) => b.length - a.length)
    .join('|')
  return new RegExp(`(^|[\\n.?!]\\s+)(${source})\\s*:\\s*`, 'gi')
}

function stripPrefix(text: string): string {
  return text.replace(/^\s*(blocked|blocker|reason|status)\s*:\s*/i, '').trim()
}

function sentenceEnd(text: string, start: number): number {
  const match = text.slice(start).match(/[.!?](\s|$)/)
  return match ? start + match.index + 1 : text.length
}

function extractBlocks(text: string): DetailBlock[] {
  const clean = stripPrefix(text)
  const pattern = labelPattern()
  const matches = Array.from(clean.matchAll(pattern))
  if (matches.length === 0) {
    return clean
      .split(/\n{2,}/)
      .map((body) => ({ body: body.trim() }))
      .filter((block) => block.body.length > 0)
  }

  const blocks: DetailBlock[] = []
  const firstIndex = matches[0].index ?? 0
  const prefix = clean.slice(0, firstIndex).trim().replace(/[.!?]$/, '')
  if (prefix) blocks.push({ body: prefix })

  matches.forEach((match, index) => {
    const label = titleCase((match[2] ?? '').trim())
    const start = (match.index ?? 0) + match[0].length
    const end = index + 1 < matches.length ? (matches[index + 1].index ?? clean.length) : clean.length
    const body = clean.slice(start, end).trim().replace(/^[.\s]+/, '').trim()
    if (body) blocks.push({ label, body })
  })
  return blocks
}

function titleCase(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim().toLowerCase()
  const custom: Record<string, string> = {
    'task id': 'Task ID',
    'what i verified': 'What I verified',
    'how to fix/unblock': 'How to fix / unblock',
  }
  if (custom[normalized]) return custom[normalized]
  return normalized.replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function isLongOrStructured(text: string): boolean {
  return text.length > 140 || /\n|\b(issue|what is wrong|proof needed|evidence required|how to fix|after resolved|message for agent|task id|site)\s*:/i.test(text)
}

function summaryFrom(blocks: DetailBlock[], clean: string): string {
  const preferred = blocks.find((block) => /^(summary|what this means|issue|what is wrong)$/i.test(block.label ?? ''))
  const source = preferred?.body || blocks.find((block) => !block.label)?.body || clean
  const trimmed = source.trim()
  const end = sentenceEnd(trimmed, 0)
  return trimmed.slice(0, end).replace(/\s+/g, ' ').trim()
}

function linkify(text: string): React.ReactNode[] {
  return text.split(URL_PATTERN).map((part, index) => {
    if (/^https?:\/\//i.test(part)) {
      return (
        <a
          key={`${part}-${index}`}
          href={part}
          className="break-all text-[var(--color-accent-v2)] underline underline-offset-2"
          target="_blank"
          rel="noreferrer"
        >
          {part}
        </a>
      )
    }
    return <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>
  })
}

function renderBody(text: string, compact: boolean): React.ReactNode {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean)
  if (lines.length > 1) {
    return (
      <div className={compact ? 'space-y-1' : 'space-y-2'}>
        {lines.map((line, index) => {
          const item = line.replace(/^[-*•]\s*/, '').trim()
          const isList = /^[-*•]\s*/.test(line)
          return isList ? (
            <div key={`${item}-${index}`} className="flex gap-2">
              <span aria-hidden="true">•</span>
              <span className="min-w-0 flex-1 break-words">{linkify(item)}</span>
            </div>
          ) : (
            <p key={`${item}-${index}`} className="break-words">{linkify(item)}</p>
          )
        })}
      </div>
    )
  }
  return <span className="break-words">{linkify(text)}</span>
}

export function ReadableTaskText({ text, empty, className = '', compact = false }: ReadableTaskTextProps) {
  const raw = text?.trim() ?? ''
  if (!raw) return empty ? <>{empty}</> : null

  if (!isLongOrStructured(raw)) {
    return <p className={`${className} whitespace-pre-wrap break-words`}>{linkify(raw)}</p>
  }

  const clean = stripPrefix(raw)
  const blocks = extractBlocks(clean)
  const summary = summaryFrom(blocks, clean)

  return (
    <div className={`${className} ${compact ? 'space-y-2' : 'space-y-3'} break-words`}>
      <section className="rounded-[var(--radius-card)] border border-[var(--color-accent-v2)]/25 bg-[var(--color-accent-v2)]/10 p-3">
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface">What this means</p>
        <p className="mt-1 leading-6 text-on-surface">{linkify(summary)}</p>
      </section>
      <section className={compact ? 'space-y-2' : 'space-y-3'}>
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Technical details</p>
        {blocks.map((block, index) => (
          <div key={`${block.label ?? 'detail'}-${index}`} className="rounded-[var(--radius-card)] border border-[var(--color-card-border)] bg-[var(--color-card)]/70 p-3">
            {block.label ? <p className="mb-1 text-[10px] font-label uppercase tracking-wider text-on-surface">{block.label}</p> : null}
            <div className="leading-6 text-on-surface-variant">{renderBody(block.body, compact)}</div>
          </div>
        ))}
      </section>
    </div>
  )
}
