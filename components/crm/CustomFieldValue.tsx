'use client'

import type { CustomFieldDefinition } from '@/lib/customFields/types'

// ── Props ─────────────────────────────────────────────────────────────────────

export interface CustomFieldValueProps {
  definition: CustomFieldDefinition
  value: unknown
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isEmpty(v: unknown): boolean {
  if (v === undefined || v === null) return true
  if (typeof v === 'string' && v.trim() === '') return true
  if (Array.isArray(v) && v.length === 0) return true
  return false
}

function MissingValue({ label = 'Not captured' }: { label?: string }) {
  return <span className="text-sm text-[var(--color-pib-text-muted)]">{label}</span>
}

function Chip({ label, color }: { label: string; color?: string }) {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border border-[var(--color-pib-line)]"
      style={color ? { backgroundColor: color + '22', borderColor: color, color } : undefined}
    >
      {label}
    </span>
  )
}

// ── Public component ──────────────────────────────────────────────────────────

export function CustomFieldValue({ definition, value }: CustomFieldValueProps) {
  const { type, options } = definition

  if (isEmpty(value)) {
    // checkbox: false is a valid value
    if (type !== 'checkbox') return <MissingValue />
  }

  // ── text / longtext / phone ─────────────────────────────────────────────────
  if (type === 'text' || type === 'longtext' || type === 'phone') {
    return <span className="text-sm text-[var(--color-pib-text)]">{String(value)}</span>
  }

  // ── url ─────────────────────────────────────────────────────────────────────
  if (type === 'url') {
    return (
      <a
        href={String(value)}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm text-[var(--color-accent-v2)] hover:underline"
      >
        {String(value)}
      </a>
    )
  }

  // ── email ───────────────────────────────────────────────────────────────────
  if (type === 'email') {
    return (
      <a
        href={`mailto:${String(value)}`}
        className="text-sm text-[var(--color-accent-v2)] hover:underline"
      >
        {String(value)}
      </a>
    )
  }

  // ── number ──────────────────────────────────────────────────────────────────
  if (type === 'number') {
    if (value === undefined || value === null) return <MissingValue />
    return (
      <span className="text-sm text-[var(--color-pib-text)]">
        {(value as number).toLocaleString()}
      </span>
    )
  }

  // ── currency ────────────────────────────────────────────────────────────────
  if (type === 'currency') {
    if (typeof value !== 'object' || value === null) return <MissingValue />
    const cv = value as { amount?: number; currency?: string }
    if (cv.amount === undefined) return <MissingValue />
    let formatted: string
    try {
      formatted = new Intl.NumberFormat(
        typeof navigator !== 'undefined' ? navigator.language : 'en',
        { style: 'currency', currency: cv.currency ?? 'USD' }
      ).format(cv.amount)
    } catch {
      formatted = `${cv.currency ?? ''} ${cv.amount}`
    }
    return <span className="text-sm text-[var(--color-pib-text)]">{formatted}</span>
  }

  // ── date ────────────────────────────────────────────────────────────────────
  if (type === 'date') {
    if (isEmpty(value)) return <MissingValue />
    let formatted: string
    try {
      formatted = new Date(value as string).toLocaleDateString()
    } catch {
      return <MissingValue />
    }
    return <span className="text-sm text-[var(--color-pib-text)]">{formatted}</span>
  }

  // ── datetime ────────────────────────────────────────────────────────────────
  if (type === 'datetime') {
    if (isEmpty(value)) return <MissingValue />
    let formatted: string
    try {
      formatted = new Date(value as string).toLocaleString()
    } catch {
      return <MissingValue />
    }
    return <span className="text-sm text-[var(--color-pib-text)]">{formatted}</span>
  }

  // ── dropdown ────────────────────────────────────────────────────────────────
  if (type === 'dropdown') {
    const opt = (options ?? []).find((o) => o.value === value)
    if (!opt) return <MissingValue label={`Unknown ${definition.label} option`} />
    return <Chip label={opt.label} color={opt.color} />
  }

  // ── multi_select ────────────────────────────────────────────────────────────
  if (type === 'multi_select') {
    const selected = Array.isArray(value) ? (value as string[]) : []
    if (selected.length === 0) return <MissingValue />
    const matched = (options ?? []).filter((o) => selected.includes(o.value))
    if (matched.length === 0) return <MissingValue label={`Unknown ${definition.label} options`} />
    return (
      <div className="flex flex-wrap gap-1">
        {matched.map((opt) => (
          <Chip key={opt.value} label={opt.label} color={opt.color} />
        ))}
      </div>
    )
  }

  // ── checkbox ────────────────────────────────────────────────────────────────
  if (type === 'checkbox') {
    return (
      <span className="text-sm text-[var(--color-pib-text)]">
        {value ? 'Yes' : 'No'}
      </span>
    )
  }

  return <MissingValue />
}
