'use client'

import { useMemo } from 'react'

export interface DateRangeValue {
  from: string // ISO date (YYYY-MM-DD)
  to: string
}

const PRESETS: Array<{ label: string; days: number }> = [
  { label: '7d', days: 7 },
  { label: '14d', days: 14 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
]

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export function defaultRange(days = 30): DateRangeValue {
  return { from: daysAgoIso(days), to: todayIso() }
}

export function DateRangePicker({
  value,
  onChange,
  className = '',
}: {
  value: DateRangeValue
  onChange: (v: DateRangeValue) => void
  className?: string
}) {
  const activePreset = useMemo(() => {
    for (const p of PRESETS) {
      if (value.from === daysAgoIso(p.days) && value.to === todayIso()) return p.days
    }
    return null
  }, [value])

  return (
    <div className={`flex flex-wrap items-end gap-2 ${className}`}>
      <div className="flex gap-1">
        {PRESETS.map(p => (
          <button
            key={p.days}
            type="button"
            onClick={() => onChange({ from: daysAgoIso(p.days), to: todayIso() })}
            className={`px-2.5 py-1.5 rounded text-xs font-medium transition-colors ${
              activePreset === p.days
                ? 'bg-amber-400/20 text-amber-400'
                : 'text-on-surface-variant hover:text-on-surface bg-[var(--color-surface-container)]'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div>
        <label className="text-[10px] uppercase tracking-wide text-on-surface-variant font-label block">From</label>
        <input
          type="date"
          value={value.from}
          max={value.to}
          onChange={e => onChange({ ...value, from: e.target.value })}
          className="pib-input text-xs"
        />
      </div>
      <div>
        <label className="text-[10px] uppercase tracking-wide text-on-surface-variant font-label block">To</label>
        <input
          type="date"
          value={value.to}
          min={value.from}
          max={todayIso()}
          onChange={e => onChange({ ...value, to: e.target.value })}
          className="pib-input text-xs"
        />
      </div>
    </div>
  )
}
