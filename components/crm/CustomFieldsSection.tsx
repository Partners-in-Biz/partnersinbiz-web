'use client'

import type { CustomFieldDefinition } from '@/lib/customFields/types'
import { CustomFieldInput } from '@/components/crm/CustomFieldInput'
import { CustomFieldValue } from '@/components/crm/CustomFieldValue'
import { Icon } from '@/components/studio'

// ── Props ─────────────────────────────────────────────────────────────────────

export interface CustomFieldsSectionProps {
  definitions: CustomFieldDefinition[]
  values: Record<string, unknown> | undefined
  onChange?: (next: Record<string, unknown>) => void
  mode: 'read' | 'edit'
  emptyAction?: {
    label: string
    ariaLabel: string
    onClick: () => void
  }
  action?: {
    label: string
    ariaLabel: string
    onClick: () => void
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function groupDefinitions(defs: CustomFieldDefinition[]): Map<string, CustomFieldDefinition[]> {
  const map = new Map<string, CustomFieldDefinition[]>()
  for (const def of defs) {
    const group = def.group ?? 'Other'
    if (!map.has(group)) map.set(group, [])
    map.get(group)!.push(def)
  }
  return map
}

function allValuesEmpty(defs: CustomFieldDefinition[], values: Record<string, unknown> | undefined): boolean {
  if (!values) return true
  return defs.every((d) => {
    const v = values[d.key]
    if (v === undefined || v === null) return true
    if (typeof v === 'string' && v.trim() === '') return true
    if (Array.isArray(v) && v.length === 0) return true
    return false
  })
}

// ── Public component ──────────────────────────────────────────────────────────

export function CustomFieldsSection({ definitions, values, onChange, mode, emptyAction, action }: CustomFieldsSectionProps) {
  if (definitions.length === 0) return null

  if (mode === 'read' && allValuesEmpty(definitions, values)) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs italic text-[var(--color-pib-text-muted)]">No custom fields set.</p>
        {emptyAction && (
          <button
            type="button"
            onClick={emptyAction.onClick}
            aria-label={emptyAction.ariaLabel}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--color-card-border)] px-2 text-xs text-[var(--color-pib-text-muted)] transition hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
          >
            <Icon name="edit_note" className="text-[14px]" />
            {emptyAction.label}
          </button>
        )}
      </div>
    )
  }

  const groups = groupDefinitions(definitions)

  function handleChange(key: string, next: unknown) {
    if (!onChange) return
    onChange({ ...(values ?? {}), [key]: next })
  }

  return (
    <div className="space-y-3">
      {mode === 'read' && action && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={action.onClick}
            aria-label={action.ariaLabel}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--color-card-border)] px-2 text-xs text-[var(--color-pib-text-muted)] transition hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
          >
            <Icon name="edit_note" className="text-[14px]" />
            {action.label}
          </button>
        </div>
      )}
      {Array.from(groups.entries()).map(([group, defs]) => (
        <section key={group}>
          <h4 className="mb-2 text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">
            {group}
          </h4>
          <div className="grid grid-cols-2 gap-3">
            {defs.map((def) => (
              <div key={def.key} className="space-y-1">
                <label className="block text-[11px] font-label text-[var(--color-pib-text-muted)]">
                  {def.label}
                  {def.required && mode === 'edit' && (
                    <span className="text-[var(--st-danger)] ml-0.5">*</span>
                  )}
                </label>
                {mode === 'edit' ? (
                  <CustomFieldInput
                    definition={def}
                    value={values?.[def.key]}
                    onChange={(next) => handleChange(def.key, next)}
                  />
                ) : (
                  <CustomFieldValue
                    definition={def}
                    value={values?.[def.key]}
                  />
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
