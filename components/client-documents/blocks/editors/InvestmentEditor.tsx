'use client'
import type { DocumentBlock } from '@/lib/client-documents/types'

type Item = { label: string; amount: number; currency?: string }
type Content = { items: Item[]; total: number; currency?: string; notes?: string }

const CURRENCIES = ['ZAR', 'USD', 'EUR', 'GBP'] as const

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

export function InvestmentEditor({
  block,
  onChange,
}: {
  block: DocumentBlock
  onChange: (b: DocumentBlock) => void
}) {
  const content = (block.content as Content) ?? { items: [], total: 0 }
  const items = content.items ?? []
  const currency = content.currency ?? 'ZAR'
  const notes = content.notes ?? ''
  const total = items.reduce((sum, it) => sum + (Number.isFinite(it.amount) ? it.amount : 0), 0)

  const commit = (patch: Partial<Content>) => {
    const next: Content = {
      items: patch.items ?? items,
      total: patch.total ?? items.reduce((s, it) => s + (Number.isFinite(it.amount) ? it.amount : 0), 0),
      currency: patch.currency ?? currency,
      notes: patch.notes ?? notes,
    }
    // Recompute total if items changed
    if (patch.items) {
      next.total = patch.items.reduce(
        (s, it) => s + (Number.isFinite(it.amount) ? it.amount : 0),
        0,
      )
    }
    onChange({ ...block, content: next })
  }

  const updateItem = (i: number, patch: Partial<Item>) => {
    const next = items.map((it, idx) => (idx === i ? { ...it, ...patch } : it))
    commit({ items: next })
  }

  const addItem = () => {
    commit({ items: [...items, { label: '', amount: 0 }] })
  }

  const removeItem = (i: number) => {
    commit({ items: items.filter((_, idx) => idx !== i) })
  }

  return (
    <div className="space-y-2">
      <input
        type="text"
        value={block.title ?? ''}
        onChange={(e) => onChange({ ...block, title: e.target.value })}
        placeholder="Section title (e.g. Investment)"
        aria-label="Section title"
        className="w-full rounded border border-[var(--color-pib-line)] bg-transparent px-3 py-2 text-sm"
      />

      <div className="flex items-center gap-2">
        <label className="text-xs uppercase tracking-wider opacity-70">Currency</label>
        <select
          value={currency}
          onChange={(e) => commit({ currency: e.target.value })}
          aria-label="Currency"
          className="rounded border border-[var(--color-pib-line)] bg-transparent px-2 py-1 text-sm"
        >
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex gap-2">
            <input
              type="text"
              value={item.label}
              onChange={(e) => updateItem(i, { label: e.target.value })}
              placeholder={`Line item ${i + 1}`}
              aria-label={`Line item ${i + 1} label`}
              className="flex-1 rounded border border-[var(--color-pib-line)] bg-transparent px-3 py-2 text-sm"
            />
            <input
              type="number"
              value={item.amount}
              onChange={(e) => updateItem(i, { amount: Number(e.target.value) || 0 })}
              placeholder="Amount"
              aria-label={`Line item ${i + 1} amount`}
              className="w-32 rounded border border-[var(--color-pib-line)] bg-transparent px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={() => removeItem(i)}
              className="rounded border border-[var(--color-pib-line)] px-3 py-2 text-xs"
              aria-label={`Remove item ${i + 1}`}
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addItem}
          className="rounded border border-[var(--color-pib-line)] px-3 py-2 text-xs"
        >
          Add line item
        </button>
      </div>

      <div className="rounded border border-[var(--color-pib-line)] bg-transparent px-3 py-2 text-sm">
        <span className="text-xs uppercase tracking-wider opacity-70">Total: </span>
        <span className="font-medium">{formatMoney(total, currency)}</span>
      </div>

      <textarea
        value={notes}
        onChange={(e) => commit({ notes: e.target.value })}
        placeholder="Notes (optional)"
        aria-label="Investment notes"
        rows={3}
        className="w-full rounded border border-[var(--color-pib-line)] bg-transparent px-3 py-2 text-sm"
      />
    </div>
  )
}
