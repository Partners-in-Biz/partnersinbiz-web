'use client'

import type { ReactNode } from 'react'

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block mb-3">
      <span className="block text-xs font-medium text-[var(--color-pib-text-muted)] mb-1">{label}</span>
      {children}
    </label>
  )
}

export function TextInput({
  value,
  onChange,
  placeholder,
  'aria-label': ariaLabel,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  'aria-label'?: string
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={ariaLabel ?? placeholder ?? 'Text'}
      className="w-full px-3 py-2 rounded-md bg-zinc-900 border border-zinc-700 text-sm text-zinc-100 placeholder-zinc-500"
    />
  )
}

export function TextArea({
  value,
  onChange,
  rows = 4,
  placeholder,
  'aria-label': ariaLabel,
}: {
  value: string
  onChange: (v: string) => void
  rows?: number
  placeholder?: string
  'aria-label'?: string
}) {
  return (
    <textarea
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      placeholder={placeholder}
      className="w-full px-3 py-2 rounded-md bg-zinc-900 border border-zinc-700 text-sm text-zinc-100 placeholder-zinc-500 font-mono"
    />
  )
}

export function ColorInput({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Colour picker"
        className="w-10 h-9 rounded border border-zinc-700 bg-zinc-900 cursor-pointer"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Colour hex"
        className="flex-1 px-3 py-2 rounded-md bg-zinc-900 border border-zinc-700 text-sm text-zinc-100 font-mono"
      />
    </div>
  )
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  'aria-label': ariaLabel,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  'aria-label'?: string
}) {
  return (
    <select
      aria-label={ariaLabel ?? 'Select'}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="w-full px-3 py-2 rounded-md bg-zinc-900 border border-zinc-700 text-sm text-zinc-100"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={(e) => onChange(Number(e.target.value) || 0)}
      aria-label="Number"
      className="w-full px-3 py-2 rounded-md bg-zinc-900 border border-zinc-700 text-sm text-zinc-100"
    />
  )
}

export function CheckboxField({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <label className="flex items-center gap-2 mb-3 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="text-sm text-zinc-300">{label}</span>
    </label>
  )
}

const ALIGN_OPTIONS = [
  { value: 'left' as const, label: 'Left' },
  { value: 'center' as const, label: 'Center' },
  { value: 'right' as const, label: 'Right' },
]
export const ALIGN_SELECT = ALIGN_OPTIONS
