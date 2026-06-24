'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export interface MergeCandidateCompany {
  id: string
  name?: string
  domain?: string
  website?: string
  industry?: string
  lifecycleStage?: string
}

interface CompanyMergePanelProps {
  company: MergeCandidateCompany
  apiPath: (path: string) => string
  onMerged?: (winnerId: string, loserId: string) => void
}

function companyLabel(company: MergeCandidateCompany): string {
  return company.name?.trim() || company.domain?.trim() || company.website?.trim() || 'Unnamed company'
}

function companySubtitle(company: MergeCandidateCompany): string {
  return [company.domain || company.website, company.industry, company.lifecycleStage]
    .filter((value) => typeof value === 'string' && value.trim())
    .join(' · ')
}

export function CompanyMergePanel({ company, apiPath, onMerged }: CompanyMergePanelProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState(company.name ?? '')
  const [results, setResults] = useState<MergeCandidateCompany[]>([])
  const [duplicate, setDuplicate] = useState<MergeCandidateCompany | null>(null)
  const [searching, setSearching] = useState(false)
  const [merging, setMerging] = useState(false)
  const [error, setError] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const runSearch = useCallback(async (term: string) => {
    const q = term.trim()
    if (q.length < 2) {
      setResults([])
      return
    }
    setSearching(true)
    setError('')
    try {
      const res = await fetch(apiPath(`/api/v1/crm/companies?search=${encodeURIComponent(q)}&limit=10`))
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`)
      const list = (Array.isArray(body.data?.companies) ? body.data.companies : []) as MergeCandidateCompany[]
      setResults(list.filter((candidate) => candidate.id !== company.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Company search failed')
      setResults([])
    } finally {
      setSearching(false)
    }
  }, [apiPath, company.id])

  useEffect(() => {
    if (!open || duplicate) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => void runSearch(search), 250)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [duplicate, open, runSearch, search])

  async function confirmMerge() {
    if (!duplicate) return
    setMerging(true)
    setError('')
    try {
      const res = await fetch(apiPath('/api/v1/crm/companies/merge'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ winnerId: company.id, loserId: duplicate.id }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'Merge failed')
      const loserId = duplicate.id
      setDuplicate(null)
      setResults([])
      setOpen(false)
      onMerged?.(company.id, loserId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Merge failed')
    } finally {
      setMerging(false)
    }
  }

  return (
    <section className="bento-card !p-5" aria-label={`Merge duplicate company for ${companyLabel(company)}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="eyebrow !text-[10px]">Data hygiene</p>
          <h2 className="mt-1 font-display text-lg text-[var(--color-pib-text)]">Merge duplicate company</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--color-pib-text-muted)]">
            Keep this company as the winner and merge another same-workspace company into it. Contacts, deals, quotes, invoices, projects, activities, and form links are re-pointed to the winner.
          </p>
        </div>
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="btn-pib-secondary inline-flex items-center gap-1.5 text-xs"
            aria-label={`Find and merge a duplicate of ${companyLabel(company)}`}
          >
            <span className="material-symbols-outlined text-[14px]" aria-hidden="true">merge</span>
            Merge duplicate
          </button>
        )}
      </div>

      {open && (
        <div className="mt-4 space-y-4">
          {!duplicate ? (
            <>
              <label htmlFor="company-merge-search" className="sr-only">Search companies to merge</label>
              <input
                id="company-merge-search"
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by company name, domain, or website…"
                className="input-pib w-full text-sm"
                autoComplete="off"
              />
              {searching && <p className="text-xs text-[var(--color-pib-text-muted)]">Searching…</p>}
              {results.length > 0 && (
                <div className="space-y-2">
                  {results.map((candidate) => (
                    <button
                      key={candidate.id}
                      type="button"
                      onClick={() => setDuplicate(candidate)}
                      className="w-full rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] p-3 text-left transition-colors hover:bg-white/[0.06]"
                    >
                      <span className="block text-sm font-semibold text-[var(--color-pib-text)]">{companyLabel(candidate)}</span>
                      <span className="mt-1 block text-xs text-[var(--color-pib-text-muted)]">{companySubtitle(candidate) || candidate.id}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4">
              <p className="text-sm font-semibold text-amber-50">Merge {companyLabel(duplicate)} into {companyLabel(company)}?</p>
              <p className="mt-1 text-sm text-amber-100/85">
                The duplicate company will be archived with a mergedIntoId link. Related same-workspace CRM records will point to {companyLabel(company)}.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" className="btn-pib-secondary text-xs" disabled={merging} onClick={() => setDuplicate(null)}>Choose another</button>
                <button type="button" className="btn-pib-primary text-xs" disabled={merging} onClick={confirmMerge}>{merging ? 'Merging…' : 'Confirm merge'}</button>
              </div>
            </div>
          )}

          {error && <p className="rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-100">{error}</p>}
          <button type="button" className="text-xs text-[var(--color-pib-text-muted)] underline" disabled={merging} onClick={() => { setOpen(false); setDuplicate(null); setError('') }}>Cancel merge</button>
        </div>
      )}
    </section>
  )
}
