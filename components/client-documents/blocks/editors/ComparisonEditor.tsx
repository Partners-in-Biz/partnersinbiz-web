'use client'
import { useMemo, useState } from 'react'
import type { DocumentBlock } from '@/lib/client-documents/types'

type Row = { label: string; values: (string | boolean)[] }
type Content = { headers: string[]; rows: Row[]; highlightCol?: number }

function parseValue(raw: string): string | boolean {
  const trimmed = raw.trim()
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  // Strip surrounding quotes if present
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function serializeRow(row: Row): string {
  const valueStrings = row.values.map((v) => {
    if (typeof v === 'boolean') return v ? 'true' : 'false'
    return v.includes('|') ? `"${v}"` : v
  })
  return [row.label, ...valueStrings].join(' | ')
}

function parseRowsText(text: string): Row[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const parts = line.split('|').map((p) => p.trim())
      const [label, ...rest] = parts
      return { label: label ?? '', values: rest.map(parseValue) }
    })
}

export function ComparisonEditor({
  block,
  onChange,
}: {
  block: DocumentBlock
  onChange: (b: DocumentBlock) => void
}) {
  const content = (block.content as Content) ?? { headers: [], rows: [] }
  const headers = content.headers ?? []
  const rows = content.rows ?? []
  const highlightCol = content.highlightCol ?? -1

  const [headersText, setHeadersText] = useState(() => headers.join(', '))
  const initialRowsText = useMemo(() => rows.map(serializeRow).join('\n'), [block.id])
  const [rowsText, setRowsText] = useState(initialRowsText)

  const commit = (patch: Partial<Content>) => {
    onChange({
      ...block,
      content: {
        headers: patch.headers ?? headers,
        rows: patch.rows ?? rows,
        highlightCol: patch.highlightCol ?? highlightCol,
      },
    })
  }

  const updateHeaders = (text: string) => {
    setHeadersText(text)
    const parsed = text
      .split(',')
      .map((h) => h.trim())
      .filter((h) => h.length > 0)
    commit({ headers: parsed })
  }

  const updateRows = (text: string) => {
    setRowsText(text)
    commit({ rows: parseRowsText(text) })
  }

  return (
    <div className="space-y-2">
      <input
        type="text"
        value={block.title ?? ''}
        onChange={(e) => onChange({ ...block, title: e.target.value })}
        placeholder="Section title (e.g. Us vs them)"
        aria-label="Section title"
        className="w-full rounded border border-[var(--color-pib-line)] bg-transparent px-3 py-2 text-sm"
      />
      <input
        type="text"
        value={headersText}
        onChange={(e) => updateHeaders(e.target.value)}
        placeholder="Comma-separated headers (e.g. PiB, Agency A, Agency B)"
        aria-label="Comparison headers"
        className="w-full rounded border border-[var(--color-pib-line)] bg-transparent px-3 py-2 text-sm"
      />
      <textarea
        value={rowsText}
        onChange={(e) => updateRows(e.target.value)}
        placeholder={`One row per line - format: Label | true | false | "string"\nExample:\nSocial automation | true | false | "Limited"`}
        aria-label="Comparison rows"
        rows={6}
        className="w-full rounded border border-[var(--color-pib-line)] bg-transparent px-3 py-2 font-mono text-xs"
      />
      <div className="flex items-center gap-2">
        <label className="text-xs uppercase tracking-wider opacity-70">Highlight column</label>
        <input
          type="number"
          value={highlightCol}
          onChange={(e) => commit({ highlightCol: Number(e.target.value) })}
          min={-1}
          aria-label="Highlight column"
          className="w-20 rounded border border-[var(--color-pib-line)] bg-transparent px-2 py-1 text-sm"
        />
        <span className="text-xs opacity-60">(-1 to disable)</span>
      </div>
    </div>
  )
}
