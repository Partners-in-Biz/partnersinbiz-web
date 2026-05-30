'use client'

import type { CustomFieldDefinition } from '@/lib/customFields/types'
import { CustomFieldInput } from '@/components/crm/CustomFieldInput'
import { CustomFieldValue } from '@/components/crm/CustomFieldValue'

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

export function CustomFieldsSection({ definitions, values, onChange, mode, emptyAction }: CustomFieldsSectionProps) {
  if (definitions.length === 0) return null

  if (mode === 'read' && allValuesEmpty(definitions, values)) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-[var(--color-pib-text-muted)] italic">No custom fields set.</p>
        {emptyAction && (
          <button
            type="button"
            onClick={emptyAction.onClick}
            aria-label={emptyAction.ariaLabel}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--color-pib-line)] px-2 py-1 text-xs font-medium text-[var(--color-pib-text)] transition-colors hover:bg-white/10"
          >
            <span className="material-symbols-outlined text-[14px]">edit_note</span>
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
    <div className="space-y-6">
      {Array.from(groups.entries()).map(([group, defs]) => (
        <section key={group}>
          <h4 className="text-xs font-label text-[var(--color-pib-text-muted)] uppercase tracking-wider mb-3">
            {group}
          </h4>
          <div className="grid grid-cols-2 gap-4">
            {defs.map((def) => (
              <div key={def.key} className="space-y-1">
                <label className="block text-xs font-label text-[var(--color-pib-text-muted)]">
                  {def.label}
                  {def.required && mode === 'edit' && (
                    <span className="text-red-400 ml-0.5">*</span>
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
