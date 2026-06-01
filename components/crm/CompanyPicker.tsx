'use client'

import { useEffect, useRef, useState } from 'react'

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
  ariaLabel?: string
  onChange: (val: { companyId: string | null; companyName: string | null }) => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CompanyPicker({ currentCompanyId, currentCompanyName, ariaLabel = 'Search companies', onChange }: CompanyPickerProps) {
  const [query, setQuery] = useState(currentCompanyName ?? '')
  const [results, setResults] = useState<CompanyResult[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [createForm, setCreateForm] = useState<CreateFormState>({ name: '', domain: '' })
  const [creating, setCreating] = useState(false)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

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
        const res = await fetch(`/api/v1/crm/companies?search=${encodeURIComponent(q)}&limit=10`)
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
      const res = await fetch('/api/v1/crm/companies', {
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
          className="pib-input w-full pr-8"
        />
        {loading && (
          <span className="absolute right-8 material-symbols-outlined text-[16px] text-[var(--color-pib-text-muted)] animate-spin">
            progress_activity
          </span>
        )}
        {(hasSelection || query) && (
          <button
            type="button"
            aria-label="Clear company"
            onClick={clearSelection}
            className="cursor-pointer absolute right-2 text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        )}
      </div>

      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 pib-card rounded-lg shadow-lg overflow-hidden">
          {results.length > 0 ? (
            <ul id="company-picker-results" role="listbox">
              {results.map((company) => (
                <li key={company.id} role="option" aria-selected={currentCompanyId === company.id}>
                  <button
                    type="button"
                    onClick={() => selectCompany(company)}
                    className="cursor-pointer w-full text-left px-3 py-2 hover:bg-white/[0.05] transition-colors"
                  >
                    <p className="text-sm font-medium text-[var(--color-pib-text)]">{company.name}</p>
                    {company.domain && (
                      <p className="text-[11px] text-[var(--color-pib-text-muted)] font-mono">{company.domain}</p>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-[var(--color-pib-text-muted)] px-3 py-2">No results</p>
          )}

          {/* Create new */}
          {!showCreateForm ? (
            <button
              type="button"
              onClick={() => { setShowCreateForm(true); setOpen(true) }}
              className="cursor-pointer w-full text-left text-xs px-3 py-2 text-[var(--color-accent-v2)] hover:bg-white/[0.05] transition-colors flex items-center gap-1.5 border-t border-[var(--color-pib-line)]"
            >
              <span className="material-symbols-outlined text-[14px]">add</span>
              Create new company
            </button>
          ) : (
            <div className="border-t border-[var(--color-pib-line)] p-3 space-y-2">
              <input
                autoFocus
                type="text"
                value={createForm.name}
                onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Company name *"
                className="pib-input w-full text-sm"
              />
              <input
                type="text"
                value={createForm.domain}
                onChange={(e) => setCreateForm((f) => ({ ...f, domain: e.target.value }))}
                placeholder="Domain (optional)"
                className="pib-input w-full text-sm"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={creating || !createForm.name.trim()}
                  className="cursor-pointer btn-pib-accent !text-xs !px-3 !py-1.5 flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {creating ? '…' : 'Create'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  className="cursor-pointer text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] px-2 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
