'use client'

import { useMemo, useState } from 'react'
import { MERGE_TAGS } from '@/lib/email/merge-tags'

export function MergeFieldBrowser({
  fallbacks,
  onFallbackChange,
  onInsert,
}: {
  fallbacks: Record<string, string>
  onFallbackChange: (key: string, value: string) => void
  onInsert: (token: string) => void
}) {
  const [query, setQuery] = useState('')
  const visible = useMemo(() => {
    const clean = query.trim().toLowerCase()
    if (!clean) return MERGE_TAGS
    return MERGE_TAGS.filter((field) =>
      `${field.label} ${field.key} ${field.description}`.toLowerCase().includes(clean),
    )
  }, [query])

  return (
    <div className="space-y-3">
      <div>
        <p className="sc-tiny !text-[10px]">Personalisation</p>
        <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">Every optional field needs safe fallback copy.</p>
      </div>
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Find a merge field…"
        className="w-full rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] px-3 py-2 text-sm text-[var(--color-pib-text)] outline-none focus:border-[var(--color-pib-accent)]"
       aria-label="Find a merge field…"/>
      <div className="max-h-64 divide-y divide-[var(--color-pib-line)] overflow-y-auto border-y border-[var(--color-pib-line)]">
        {visible.map((field) => (
          <div key={field.key} className="py-2.5">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => onInsert(`{{${field.key}}}`)}
                className="min-w-0 text-left"
                title={`Insert {{${field.key}}} into the subject`}
              >
                <span className="block text-sm font-medium text-[var(--color-pib-text)]">{field.label}</span>
                <code className="block truncate text-[11px] text-[var(--color-pib-accent)]">{`{{${field.key}}}`}</code>
              </button>
              {field.key !== 'email' && (
                <input
                  value={fallbacks[field.key] ?? ''}
                  onChange={(event) => onFallbackChange(field.key, event.target.value)}
                  placeholder={field.defaultFallback || 'Fallback'}
                  aria-label={`${field.label} fallback`}
                  className="w-28 rounded border border-[var(--color-pib-line)] bg-transparent px-2 py-1.5 text-xs text-[var(--color-pib-text)] outline-none focus:border-[var(--color-pib-accent)]"
                />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
