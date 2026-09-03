'use client'

import { useMemo, useState } from 'react'
import type { DocumentBlock } from '@/lib/client-documents/types'
import { BlockFrame } from './BlockFrame'

type Item = { label: string; amount: number; required?: boolean; default?: boolean }
type Content = { items: Item[]; currency: string; note?: string }

function formatMoney(amount: number, currency: string) {
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

export function PricingToggleBlock({
  block,
  index,
}: {
  block: DocumentBlock
  index: number
}) {
  const content = (block.content as Content) ?? { items: [], currency: 'ZAR' }
  const items = content.items ?? []
  const initial = useMemo(
    () => items.map((i) => Boolean(i.required || i.default)),
    [items],
  )
  const [selected, setSelected] = useState<boolean[]>(initial)
  const total = items.reduce(
    (sum, item, i) => sum + (selected[i] ? item.amount : 0),
    0,
  )

  return (
    <BlockFrame block={block} index={index}>
      {block.title && (
        <h2 className="mb-6 text-2xl font-medium text-[var(--doc-accent)] md:text-4xl">
          {block.title}
        </h2>
      )}
      <div
        className="rounded-md border p-6"
        style={{ borderColor: 'var(--doc-border)', background: 'var(--doc-surface)' }}
      >
        <ul className="divide-y" style={{ borderColor: 'var(--doc-border)' }}>
          {items.map((item, i) => (
            <li key={i} className="flex items-center justify-between py-3">
              <label className="flex flex-1 cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={Boolean(selected[i])}
                  disabled={Boolean(item.required)}
                  onChange={(e) =>
                    setSelected((prev) =>
                      prev.map((v, j) => (j === i ? e.target.checked : v)),
                    )
                  }
                  className="h-4 w-4 accent-[var(--doc-accent)]"
                />
                <span className="text-[var(--doc-text)]">
                  {item.label}
                  {item.required && (
                    <span className="ml-2 text-xs text-[var(--doc-muted)]">(included)</span>
                  )}
                </span>
              </label>
              <span className="tabular-nums text-[var(--doc-text)] opacity-80">
                {formatMoney(item.amount, content.currency)}
              </span>
            </li>
          ))}
        </ul>
        <div
          className="mt-4 flex items-baseline justify-between border-t pt-4"
          style={{ borderColor: 'var(--doc-border)' }}
        >
          <span className="text-xs uppercase tracking-wider text-[var(--doc-muted)]">
            Your total
          </span>
          <span
            className="text-3xl font-medium tabular-nums"
            style={{ color: 'var(--doc-accent)' }}
          >
            {formatMoney(total, content.currency)}
          </span>
        </div>
        {content.note && (
          <p className="mt-3 text-xs text-[var(--doc-muted)]">{content.note}</p>
        )}
      </div>
    </BlockFrame>
  )
}
