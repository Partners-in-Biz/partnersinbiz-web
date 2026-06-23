'use client'

import { useState } from 'react'

export function KpiCard({
  label, value, sub, accent = false,
}: {
  label: string
  value: string | number
  sub?: string
  accent?: boolean
}) {
  return (
    <div className="pib-card p-4">
      <p className="text-xs text-on-surface-variant font-label">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${accent ? 'text-amber-400' : 'text-on-surface'}`}>{value}</p>
      {sub && <p className="text-xs text-on-surface-variant mt-0.5">{sub}</p>}
    </div>
  )
}

export function CopyButton({
  text, label = 'Copy', className = '',
}: {
  text: string
  label?: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch { /* clipboard unavailable */ }
      }}
      className={`pib-btn-secondary text-xs px-3 py-1.5 ${className}`}
    >
      {copied ? 'Copied!' : label}
    </button>
  )
}

export function SimpleTable({
  columns, rows, empty = 'No data',
}: {
  columns: Array<{ key: string; label: string; align?: 'left' | 'right' }>
  rows: Array<Record<string, unknown>>
  empty?: string
}) {
  if (rows.length === 0) {
    return <div className="pib-card p-6 text-center text-on-surface-variant text-sm">{empty}</div>
  }
  return (
    <div className="pib-card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--color-card-border)]">
            {columns.map(c => (
              <th key={c.key} className={`px-3 py-2 text-xs font-label text-on-surface-variant ${c.align === 'right' ? 'text-right' : 'text-left'}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-[var(--color-card-border)] last:border-0">
              {columns.map(c => (
                <td key={c.key} className={`px-3 py-2 text-on-surface ${c.align === 'right' ? 'text-right tabular-nums' : 'text-left'}`}>
                  {String(r[c.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
