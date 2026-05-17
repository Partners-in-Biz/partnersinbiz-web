'use client'
export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { CompaniesTable } from '@/components/crm/CompaniesTable'
import { CompanyFiltersBar } from '@/components/crm/CompanyFiltersBar'
import type { Company, CompanyListParams } from '@/lib/companies/types'

// ── Companies list page ───────────────────────────────────────────────────────

export default function CompaniesPage() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Read filters from URL search params
  const [filters, setFilters] = useState<CompanyListParams>(() => ({
    search:         searchParams.get('search') ?? undefined,
    industry:       searchParams.get('industry') ?? undefined,
    size:           (searchParams.get('size') as CompanyListParams['size']) ?? undefined,
    tier:           (searchParams.get('tier') as CompanyListParams['tier']) ?? undefined,
    lifecycleStage: (searchParams.get('lifecycleStage') as CompanyListParams['lifecycleStage']) ?? undefined,
    accountManagerUid: searchParams.get('accountManagerUid') ?? undefined,
  }))

  // ── Fetch companies ────────────────────────────────────────────────────────

  const fetchCompanies = useCallback(async (params: CompanyListParams) => {
    setLoading(true)
    setError(null)
    try {
      const query = new URLSearchParams()
      if (params.search) query.set('search', params.search)
      if (params.industry) query.set('industry', params.industry)
      if (params.size) query.set('size', params.size)
      if (params.tier) query.set('tier', params.tier)
      if (params.lifecycleStage) query.set('lifecycleStage', params.lifecycleStage)
      if (params.accountManagerUid) query.set('accountManagerUid', params.accountManagerUid)
      if (params.tags && params.tags.length > 0) query.set('tags', params.tags.join(','))

      const res = await fetch(`/api/v1/crm/companies?${query.toString()}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      const body = await res.json()
      setCompanies(body.data?.companies ?? [])
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load companies'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  // Fetch on mount and when filters change
  useEffect(() => {
    fetchCompanies(filters)
  }, [fetchCompanies, filters])

  // ── Filter change → update URL + re-fetch ─────────────────────────────────

  function updateFilters(newFilters: CompanyListParams) {
    setFilters(newFilters)
    // Sync to URL (so page is bookmarkable / shareable)
    const params = new URLSearchParams()
    if (newFilters.search) params.set('search', newFilters.search)
    if (newFilters.industry) params.set('industry', newFilters.industry)
    if (newFilters.size) params.set('size', newFilters.size)
    if (newFilters.tier) params.set('tier', newFilters.tier)
    if (newFilters.lifecycleStage) params.set('lifecycleStage', newFilters.lifecycleStage)
    if (newFilters.accountManagerUid) params.set('accountManagerUid', newFilters.accountManagerUid)
    const qs = params.toString()
    router.replace(qs ? `/portal/companies?${qs}` : '/portal/companies', { scroll: false })
  }

  // ── Row click → navigate to company detail ────────────────────────────────

  function handleRowClick(id: string) {
    router.push(`/portal/companies/${id}`)
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* ── Page header ── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-[var(--color-pib-text)]">Companies</h1>
          {!loading && !error && (
            <p className="text-sm text-[var(--color-pib-text-muted)] mt-0.5">
              {companies.length} {companies.length === 1 ? 'company' : 'companies'}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Migrate from contacts — only visible to admins; route handled by W2-E */}
          <Link
            href="/portal/companies/migrate"
            className="cursor-pointer text-xs px-3 py-1.5 rounded-lg border border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] hover:border-[var(--color-pib-text-muted)] transition-colors"
          >
            Migrate from contacts
          </Link>

          <Link
            href="/portal/companies/new"
            className="cursor-pointer flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            style={{ background: 'var(--color-accent-v2)', color: '#fff' }}
          >
            <span className="material-symbols-outlined text-[16px]">add</span>
            New company
          </Link>
        </div>
      </div>

      {/* ── Filters bar ── */}
      <CompanyFiltersBar value={filters} onChange={updateFilters} />

      {/* ── Error state ── */}
      {error && (
        <div className="rounded-lg border border-[var(--color-pib-danger,#FCA5A5)] bg-[rgba(252,165,165,0.08)] px-4 py-3 text-sm text-[var(--color-pib-danger,#FCA5A5)]">
          {error}
        </div>
      )}

      {/* ── Table ── */}
      <CompaniesTable
        companies={companies}
        loading={loading}
        onRowClick={handleRowClick}
      />
    </div>
  )
}
