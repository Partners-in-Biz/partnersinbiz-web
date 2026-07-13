'use client'

import type { CustomFieldDefinition } from '@/lib/customFields/types'

// ── Props ─────────────────────────────────────────────────────────────────────

export interface CustomFieldInputProps {
  definition: CustomFieldDefinition
  value: unknown
  onChange: (next: unknown) => void
  disabled?: boolean
}

// ── Currency value shape ───────────────────────────────────────────────────────

interface CurrencyValue {
  amount: number | undefined
  currency: string
}

function isCurrencyValue(v: unknown): v is CurrencyValue {
  return typeof v === 'object' && v !== null && ('amount' in v || 'currency' in v)
}

// ── Help text ─────────────────────────────────────────────────────────────────

function HelpText({ text }: { text?: string }) {
  if (!text) return null
  return (
    <p className="mt-1 text-[11px] leading-4 text-on-surface-variant">{text}</p>
  )
}

// ── Public component ──────────────────────────────────────────────────────────

export function CustomFieldInput({ definition, value, onChange, disabled }: CustomFieldInputProps) {
  const { type, options, helpText, currencyCode } = definition

  // ── text / url / email / phone ──────────────────────────────────────────────
  if (type === 'text' || type === 'url' || type === 'email' || type === 'phone') {
    const inputType = type === 'phone' ? 'tel' : type
    return (
      <div>
        <input
          type={inputType}
          aria-label={definition.label}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-sm text-on-surface outline-none transition focus:border-primary/40 disabled:opacity-50"
        />
        <HelpText text={helpText} />
      </div>
    )
  }

  // ── longtext ────────────────────────────────────────────────────────────────
  if (type === 'longtext') {
    return (
      <div>
        <textarea
          aria-label={definition.label}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          rows={4}
          className="w-full resize-none rounded-md border border-[var(--color-card-border)] bg-transparent p-2 text-sm text-on-surface outline-none transition focus:border-primary/40 disabled:opacity-50"
        />
        <HelpText text={helpText} />
      </div>
    )
  }

  // ── number ──────────────────────────────────────────────────────────────────
  if (type === 'number') {
    return (
      <div>
        <input
          type="number"
          aria-label={definition.label}
          value={value !== undefined && value !== null ? String(value) : ''}
          onChange={(e) => {
            const raw = e.target.value
            onChange(raw === '' ? undefined : parseFloat(raw))
          }}
          disabled={disabled}
          min={definition.min}
          max={definition.max}
          className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-sm text-on-surface outline-none transition focus:border-primary/40 disabled:opacity-50"
        />
        <HelpText text={helpText} />
      </div>
    )
  }

  // ── currency ────────────────────────────────────────────────────────────────
  if (type === 'currency') {
    const cv: CurrencyValue = isCurrencyValue(value)
      ? { amount: (value as CurrencyValue).amount, currency: (value as CurrencyValue).currency ?? currencyCode ?? 'USD' }
      : { amount: undefined, currency: currencyCode ?? 'USD' }

    return (
      <div>
        <div className="flex gap-2">
          <input
            type="number"
            aria-label="Amount"
            value={cv.amount !== undefined ? String(cv.amount) : ''}
            onChange={(e) => {
              const raw = e.target.value
              onChange({ ...cv, amount: raw === '' ? undefined : parseFloat(raw) })
            }}
            disabled={disabled}
            min={definition.min}
            max={definition.max}
            className="h-9 min-w-0 flex-1 rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-sm text-on-surface outline-none transition focus:border-primary/40 disabled:opacity-50"
          />
          <input
            type="text"
            aria-label="Currency code"
            value={cv.currency}
            maxLength={3}
            onChange={(e) => onChange({ ...cv, currency: e.target.value.toUpperCase() })}
            disabled={disabled}
            className="h-9 w-20 rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-sm uppercase text-on-surface outline-none transition focus:border-primary/40 disabled:opacity-50"
          />
        </div>
        <HelpText text={helpText} />
      </div>
    )
  }

  // ── date ────────────────────────────────────────────────────────────────────
  if (type === 'date') {
    return (
      <div>
        <input
          type="date"
          aria-label={definition.label}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-sm text-on-surface outline-none transition focus:border-primary/40 disabled:opacity-50"
        />
        <HelpText text={helpText} />
      </div>
    )
  }

  // ── datetime ────────────────────────────────────────────────────────────────
  if (type === 'datetime') {
    return (
      <div>
        <input
          type="datetime-local"
          aria-label={definition.label}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-sm text-on-surface outline-none transition focus:border-primary/40 disabled:opacity-50"
        />
        <HelpText text={helpText} />
      </div>
    )
  }

  // ── dropdown ────────────────────────────────────────────────────────────────
  if (type === 'dropdown') {
    return (
      <div>
        <select
          aria-label={definition.label}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value || undefined)}
          disabled={disabled}
          className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-sm text-on-surface outline-none transition focus:border-primary/40 disabled:opacity-50"
        >
          <option value="">{`Select ${definition.label}`}</option>
          {(options ?? []).map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <HelpText text={helpText} />
      </div>
    )
  }

  // ── multi_select ────────────────────────────────────────────────────────────
  if (type === 'multi_select') {
    const selected: string[] = Array.isArray(value) ? (value as string[]) : []

    function toggle(v: string) {
      if (selected.includes(v)) {
        onChange(selected.filter((s) => s !== v))
      } else {
        onChange([...selected, v])
      }
    }

    return (
      <div>
        <div className="flex flex-wrap gap-2">
          {(options ?? []).map((opt) => {
            const active = selected.includes(opt.value)
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggle(opt.value)}
                disabled={disabled}
                className={`flex h-7 cursor-pointer items-center rounded-full border px-2.5 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  active
                    ? 'border-primary/30 bg-primary/10 text-primary'
                    : 'border-[var(--color-card-border)] text-on-surface-variant hover:bg-white/[0.05] hover:text-on-surface'
                }`}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
        <HelpText text={helpText} />
      </div>
    )
  }

  // ── checkbox ────────────────────────────────────────────────────────────────
  if (type === 'checkbox') {
    return (
      <div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
            disabled={disabled}
            className="cursor-pointer"
          />
          <span className="text-sm text-on-surface">{definition.label}</span>
        </label>
        <HelpText text={helpText} />
      </div>
    )
  }

  return null
}
