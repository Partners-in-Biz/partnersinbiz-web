'use client'

import type { Pipeline } from '@/lib/pipelines/types'

// ── Props ─────────────────────────────────────────────────────────────────────

export interface PipelineSelectorProps {
  pipelines: Pipeline[]
  selectedId?: string
  onChange: (id: string) => void
  /** When true, prepends an "All pipelines" option that emits '__all__' */
  includeAll?: boolean
  disabled?: boolean
  className?: string
}

// ── Sentinel ──────────────────────────────────────────────────────────────────

/** Sentinel value emitted when "All pipelines" is selected */
export const PIPELINE_ALL_SENTINEL = '__all__'

// ── Public component ──────────────────────────────────────────────────────────

export function PipelineSelector({
  pipelines,
  selectedId,
  onChange,
  includeAll = false,
  disabled = false,
  className = '',
}: PipelineSelectorProps) {
  // Non-archived pipelines only; default pipeline first
  const visible = [...pipelines]
    .filter((p) => !p.archived)
    .sort((a, b) => {
      if (a.isDefault && !b.isDefault) return -1
      if (!a.isDefault && b.isDefault) return 1
      return a.name.localeCompare(b.name)
    })

  const effectiveValue = selectedId ?? (includeAll ? PIPELINE_ALL_SENTINEL : (visible[0]?.id ?? ''))

  return (
    <div className={`relative ${className}`}>
      <select
        aria-label="Select pipeline"
        value={effectiveValue}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="pib-input w-full cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {includeAll && (
          <option value={PIPELINE_ALL_SENTINEL}>All pipelines</option>
        )}
        {visible.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}{p.isDefault ? ' (default)' : ''}
          </option>
        ))}
      </select>
    </div>
  )
}
