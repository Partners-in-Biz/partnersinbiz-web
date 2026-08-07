'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export interface ShareableRecord {
  id: string
  title: string
  subtitle?: string
  alreadyShared?: boolean
}

export interface PartnerRecordPickerProps {
  resourceType: string
  relationshipId: string
  value: ShareableRecord | null
  onChange: (record: ShareableRecord | null) => void
  ariaLabel?: string
}

function unwrap(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  return (b.data as Record<string, unknown>) ?? b
}

/**
 * Searchable picker for records that can be shared with a partner. Replaces
 * pasting a raw Firestore id. Debounced, and flags records already shared with
 * that partner so you don't double-share.
 */
export function PartnerRecordPicker({
  resourceType, relationshipId, value, onChange, ariaLabel = 'Search records to share',
}: PartnerRecordPickerProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ShareableRecord[]>([])
  const [truncated, setTruncated] = useState(false)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const search = useCallback(async (q: string) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ type: resourceType, relationshipId })
      if (q) params.set('q', q)
      const res = await fetch(`/api/v1/crm/partner-shares/searchable?${params.toString()}`)
      const data = unwrap(await res.json().catch(() => null))
      setResults(res.ok ? ((data?.records as ShareableRecord[]) ?? []) : [])
      setTruncated(res.ok ? Boolean(data?.truncated) : false)
    } catch {
      setResults([])
      setTruncated(false)
    } finally {
      setLoading(false)
    }
  }, [resourceType, relationshipId])

  // Reset when the caller switches record type.
  useEffect(() => {
    setQuery('')
    setResults([])
    onChange(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceType])

  function onQueryChange(next: string) {
    setQuery(next)
    setOpen(true)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { void search(next) }, 250)
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        aria-label={ariaLabel}
        value={value ? value.title : query}
        onChange={(e) => {
          if (value) onChange(null)
          onQueryChange(e.target.value)
        }}
        onFocus={() => { setOpen(true); if (results.length === 0) void search(query) }}
        placeholder={`Search ${resourceType.replace('_', ' ')}s…`}
        className="w-full rounded-md border border-[var(--color-pib-line)] bg-black/30 px-2 py-1.5 text-xs text-[var(--color-pib-text)] outline-none focus:border-[var(--color-accent-v2)]"
      />

      {value ? (
        <button
          type="button"
          onClick={() => { onChange(null); setQuery(''); setOpen(true); void search('') }}
          aria-label="Clear selected record"
          className="absolute right-1.5 top-1.5 text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]"
        >
          <span className="material-symbols-outlined text-[14px]">close</span>
        </button>
      ) : null}

      {open && !value ? (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] shadow-lg">
          {loading ? (
            <p className="px-3 py-2 text-xs text-[var(--color-pib-text-muted)]">Searching…</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-2 text-xs text-[var(--color-pib-text-muted)]">
              No {resourceType.replace('_', ' ')}s found.
            </p>
          ) : (
            results.map((record) => (
              <button
                key={record.id}
                type="button"
                disabled={record.alreadyShared}
                onClick={() => { onChange(record); setOpen(false) }}
                className="block w-full px-3 py-2 text-left transition hover:bg-white/[0.05] disabled:opacity-40"
              >
                <span className="block truncate text-xs text-[var(--color-pib-text)]">
                  {record.title}
                  {record.alreadyShared ? ' — already shared' : ''}
                </span>
                {record.subtitle ? (
                  <span className="block truncate text-[10px] text-[var(--color-pib-text-muted)]">{record.subtitle}</span>
                ) : null}
              </button>
            ))
          )}
          {truncated ? (
            <p className="border-t border-[var(--color-pib-line)] px-3 py-2 text-[10px] text-[var(--color-pib-text-muted)]">
              Showing partial results — type more of the name to narrow the search.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
