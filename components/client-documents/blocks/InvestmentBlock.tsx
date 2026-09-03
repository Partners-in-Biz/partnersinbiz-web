'use client'

import type { DocumentBlock } from '@/lib/client-documents/types'
import { BlockFrame } from './BlockFrame'
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

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

/** Studio chart series (brand 11.11): terracotta primary, ink-soft rest. */
function seriesFill(index: number) {
  return index === 0 ? 'var(--sc-accent)' : 'var(--sc-ink-soft)'
}

const AXIS_TICK = {
  className: 'sc-tiny',
  fill: 'var(--sc-ink-soft)',
  fontSize: 11,
} as const

export function InvestmentBlock({ block, index }: { block: DocumentBlock; index: number }) {
  const content = (block.content as Content) ?? { items: [], total: 0 }
  const items = content.items ?? []
  const total = content.total ?? 0
  const currency = content.currency ?? 'ZAR'

  return (
    <BlockFrame block={block} index={index}>
      {block.title && (
        <h2 className="mb-8 text-2xl font-medium text-[var(--doc-accent)] md:text-4xl">
          {block.title}
        </h2>
      )}
      <div
        className="max-w-full rounded-md border p-6 md:p-8"
        style={{ borderColor: 'var(--doc-border)', background: 'var(--doc-surface)' }}
      >
        <p className="text-xs uppercase tracking-[0.2em] text-[var(--doc-muted)]">
          Total investment
        </p>
        <p
          className="mt-2 text-4xl font-medium md:text-6xl"
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
                <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={false} />
                <YAxis
                  dataKey="name"
                  type="category"
                  width={140}
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--sc-surface)',
                    border: '1px solid var(--sc-line)',
                    borderRadius: 6,
                    color: 'var(--sc-ink)',
                  }}
                  formatter={(v) => formatMoney(Number(v) || 0, currency)}
                />
                <Bar dataKey="value">
                  {items.map((_, i) => (
                    <Cell key={i} fill={seriesFill(i)} />
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
