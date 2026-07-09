'use client'

import { useEffect, useState } from 'react'
import type { DocumentBlock } from '@/lib/client-documents/types'
import { BlockFrame } from './BlockFrame'
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { chartPalette } from '@/lib/client-documents/chartPalette'

type Item = { label: string; amount: number; currency?: string }
type Content = { items: Item[]; total: number; currency?: string; notes?: string }

function formatMoney(amount: number, currency = 'ZAR') {
  try {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    return `${currency} ${amount.toLocaleString()}`
  }
}

export function InvestmentBlock({ block, index }: { block: DocumentBlock; index: number }) {
  const content = (block.content as Content) ?? { items: [], total: 0 }
  const items = content.items ?? []
  const total = content.total ?? 0
  const currency = content.currency ?? 'ZAR'

  const [accent, setAccent] = useState('#F5A623')
  useEffect(() => {
    if (typeof window === 'undefined') return
    const computed = getComputedStyle(globalThis.document.documentElement)
      .getPropertyValue('--doc-accent')
      .trim()
    if (computed) setAccent(computed)
  }, [])

  const palette = chartPalette(accent, Math.max(items.length, 1))

  return (
    <BlockFrame block={block} index={index}>
      {block.title && (
        <h2 className="mb-8 text-2xl font-semibold text-[var(--doc-accent)] md:text-4xl">
          {block.title}
        </h2>
      )}
      <div
        className="max-w-full rounded-2xl border p-6 md:p-8"
        style={{ borderColor: 'var(--doc-border)', background: 'var(--doc-surface)' }}
      >
        <p className="text-xs uppercase tracking-[0.2em] text-[var(--doc-muted)]">
          Total investment
        </p>
        <p
          className="mt-2 text-4xl font-semibold md:text-6xl"
          style={{ color: 'var(--doc-accent)' }}
          data-counter={total}
        >
          {formatMoney(total, currency)}
        </p>

        <table className="mt-8 w-full table-fixed text-sm">
          <tbody>
            {items.map((item, i) => (
              <tr key={i} className="border-t" style={{ borderColor: 'var(--doc-border)' }}>
                <td className="py-3 pr-4 break-words text-[var(--doc-text)]">{item.label}</td>
                <td className="w-28 py-3 text-right tabular-nums text-[var(--doc-text)] opacity-80 sm:w-36">
                  {formatMoney(item.amount, currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {items.length >= 2 && (
          <div className="mt-6 h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={items.map((i) => ({ name: i.label, value: i.amount }))}
                layout="vertical"
              >
                <XAxis type="number" stroke="var(--doc-muted)" fontSize={11} />
                <YAxis
                  dataKey="name"
                  type="category"
                  width={140}
                  stroke="var(--doc-muted)"
                  fontSize={11}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--doc-bg)',
                    border: '1px solid var(--doc-border)',
                  }}
                  formatter={(v) => formatMoney(Number(v) || 0, currency)}
                />
                <Bar dataKey="value">
                  {items.map((_, i) => (
                    <Cell key={i} fill={palette[i % palette.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {content.notes && (
          <p className="mt-6 text-xs leading-5 text-[var(--doc-muted)]">{content.notes}</p>
        )}
      </div>
    </BlockFrame>
  )
}
