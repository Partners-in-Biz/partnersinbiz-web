'use client'

import { useEffect, useRef, useState } from 'react'
import { scopedApiPath, type PortalOrgRouteScope } from '@/lib/portal/scoped-routing'
import { Icon } from '@/components/studio'

// ── Types ─────────────────────────────────────────────────────────────────────

interface CompanyResult {
  id: string
  name: string
  domain?: string
}

interface CreateFormState {
  name: string
  domain: string
}

export interface CompanyPickerProps {
  currentCompanyId?: string
  currentCompanyName?: string
  orgScope?: PortalOrgRouteScope
  ariaLabel?: string
  allowCreate?: boolean
  onChange: (val: { companyId: string | null; companyName: string | null }) => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CompanyPicker({ currentCompanyId, currentCompanyName, orgScope, ariaLabel = 'Search companies', allowCreate = true, onChange }: CompanyPickerProps) {
  const [query, setQuery] = useState(currentCompanyName ?? '')
  const [results, setResults] = useState<CompanyResult[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [createForm, setCreateForm] = useState<CreateFormState>({ name: '', domain: '' })
  const [creating, setCreating] = useState(false)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const companyScope = orgScope ?? {}

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setShowCreateForm(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Debounced search
  function handleInput(q: string) {
    setQuery(q)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!q.trim()) {
      setResults([])
      setOpen(false)
      return
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(scopedApiPath(`/api/v1/crm/companies?search=${encodeURIComponent(q)}&limit=10`, companyScope))
        if (res.ok) {
          const body = await res.json()
          const raw: CompanyResult[] = body.data?.companies ?? body.data ?? []
          setResults(raw)
          setOpen(true)
        }
      } finally {
        setLoading(false)
      }
    }, 300)
  }

  function selectCompany(company: CompanyResult) {
    setQuery(company.name)
    setResults([])
    setOpen(false)
    setShowCreateForm(false)
    onChange({ companyId: company.id, companyName: company.name })
  }

  function clearSelection() {
    setQuery('')
    setResults([])
    setOpen(false)
    setShowCreateForm(false)
    onChange({ companyId: null, companyName: null })
  }

  async function handleCreate() {
    if (!createForm.name.trim()) return
    setCreating(true)
    try {
      const res = await fetch(scopedApiPath('/api/v1/crm/companies', companyScope), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: createForm.name.trim(), domain: createForm.domain || undefined }),
      })
      if (res.ok) {
        const body = await res.json()
        const newCompany: CompanyResult = body.data?.company ?? body.data ?? { id: '', name: createForm.name.trim() }
        setQuery(newCompany.name)
        setOpen(false)
        setShowCreateForm(false)
        setCreateForm({ name: '', domain: '' })
        onChange({ companyId: newCompany.id, companyName: newCompany.name })
      }
    } finally {
      setCreating(false)
    }
  }

  const hasSelection = !!currentCompanyId
  const clearLabel = ariaLabel === 'Search companies' ? 'Clear company' : `Clear ${ariaLabel}`

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative flex items-center">
        <input
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-controls="company-picker-results"
          aria-autocomplete="list"
          type="text"
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          onFocus={() => { if (results.length > 0) setOpen(true) }}
          placeholder="Search companies…"
          className="pib-input h-9 w-full text-sm pr-8"
        />
        {loading && (
          <Icon name="progress_activity" className="absolute right-8 text-[16px] text-[var(--color-pib-text-muted)] animate-spin" />
        )}
        {(hasSelection || query) && (
          <button
            type="button"
            aria-label={clearLabel}
            onClick={clearSelection}
            className="cursor-pointer absolute right-2 text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors"
          >
            <Icon name="close" className="text-[18px]" />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 overflow-hidden rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-card)]">
          {results.length > 0 ? (
            <ul id="company-picker-results" role="listbox">
              {results.map((company) => (
                <li key={company.id} role="option" aria-selected={currentCompanyId === company.id}>
                  <button
                    type="button"
                    onClick={() => selectCompany(company)}
                    className="cursor-pointer w-full text-left px-2.5 py-1.5 hover:bg-[var(--color-row-hover)] transition-colors"
                  >
                    <p className="text-xs font-medium text-[var(--color-pib-text)]">{company.name}</p>
                    {company.domain && (
                      <p className="text-[11px] text-[var(--color-pib-text-muted)] font-mono">{company.domain}</p>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-[var(--color-pib-text-muted)] px-2.5 py-1.5">No results</p>
          )}

          {/* Create new */}
          {allowCreate && (!showCreateForm ? (
            <button
              type="button"
              onClick={() => { setShowCreateForm(true); setOpen(true) }}
              className="cursor-pointer w-full text-left text-xs px-2.5 py-1.5 text-[var(--color-pib-accent)] hover:bg-[var(--color-row-hover)] transition-colors flex items-center gap-1.5 border-t border-[var(--color-pib-line)]"
            >
              <Icon name="add" className="text-[14px]" />
              Create new company
            </button>
          ) : (
            <div className="border-t border-[var(--color-pib-line)] p-2 space-y-1.5">
              <input
                autoFocus
                type="text"
                value={createForm.name}
                onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Company name *"
                aria-label="Company name"
                className="pib-input h-8 w-full text-xs"
              />
              <input
                type="text"
                value={createForm.domain}
                onChange={(e) => setCreateForm((f) => ({ ...f, domain: e.target.value }))}
                placeholder="Domain (optional)"
                aria-label="Company domain"
                className="pib-input h-8 w-full text-xs"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={creating || !createForm.name.trim()}
                  className="btn-pib-primary h-8 flex-1 justify-center px-3 text-xs"
                >
                  {creating ? '…' : 'Create'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  className="btn-pib-ghost h-8 px-2 text-xs"
                >
                  Cancel
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
