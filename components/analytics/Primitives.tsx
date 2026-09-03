'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

export function KpiCard({
  label, value, sub, accent = false,
}: {
  label: string
  value: string | number
  sub?: string
  accent?: boolean
}) {
  return (
    <div className="pib-stat-card p-3" data-module-accent="violet">
      <p className="pib-label text-[10px] tracking-[0.14em] text-[var(--color-pib-text-muted)]">{label}</p>
      <p className={cn('mt-1 text-xl st-num tracking-tight', accent ? 'text-[var(--sc-accent)]' : 'text-[var(--sc-ink)]')}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-[var(--color-pib-text-muted)]">{sub}</p>}
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
      className={cn('st-btn st-btn--secondary st-btn--sm text-xs', className)}
    >
      {copied ? 'Copied' : label}
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
    return <div className="st-panel p-4 text-center text-sm text-[var(--color-pib-text-muted)]">{empty}</div>
  }
  return (
    <div className="st-panel overflow-x-auto" data-module-accent="violet">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--color-pib-line)]">
            {columns.map(c => (
              <th key={c.key} className={`px-3 py-1.5 text-left text-[10px] font-label tracking-[0.12em] uppercase text-[var(--color-pib-text-muted)] ${c.align === 'right' ? 'text-right' : 'text-left'}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-[var(--color-pib-line)] last:border-0 hover:bg-white/[0.02]">
              {columns.map(c => (
                <td key={c.key} className={`px-3 py-1.5 text-[var(--color-pib-text)] ${c.align === 'right' ? 'text-right tabular-nums' : 'text-left'}`}>
                  {String(r[c.key] ?? ' - ')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
