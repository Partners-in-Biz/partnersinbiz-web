'use client'
export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { CompaniesTable } from '@/components/crm/CompaniesTable'
import { CompanyFiltersBar } from '@/components/crm/CompanyFiltersBar'
import type { Company, CompanyListParams } from '@/lib/companies/types'

// ── Companies list page ───────────────────────────────────────────────────────

function profileStrength(company: Company): number {
  const checks = [
    company.name,
    company.domain || company.website,
    company.industry,
    company.size || company.employeeCount,
    company.tier,
    company.lifecycleStage,
    company.phone || company.billingEmail || company.accountsContact?.email,
    company.accountManagerUid || company.accountManagerRef?.uid,
    company.notes,
    company.logoUrl,
  ]
  return Math.round((checks.filter(Boolean).length / checks.length) * 100)
}

function formatCurrency(value: number, currency = 'ZAR'): string {
  try {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(value)
  } catch {
    return `${currency} ${value.toFixed(0)}`
  }
}

function AccountMetric({
  label,
  value,
  sub,
  icon,
}: {
  label: string
  value: string
  sub: string
  icon: string
}) {
  return (
    <div className="pib-card min-w-[150px] flex-1 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">{label}</p>
        <span className="material-symbols-outlined text-[17px] text-[var(--color-pib-text-muted)]">{icon}</span>
      </div>
      <p className="mt-2 text-2xl font-display leading-none text-[var(--color-pib-text)]">{value}</p>
      <p className="mt-1 text-[11px] text-[var(--color-pib-text-muted)]">{sub}</p>
    </div>
  )
}

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
  const hasActiveFilters = Boolean(
    filters.search ||
    filters.industry ||
    filters.size ||
    filters.tier ||
    filters.lifecycleStage ||
    filters.accountManagerUid ||
    (filters.tags && filters.tags.length > 0),
  )

  const metrics = useMemo(() => {
    const customers = companies.filter((company) => company.lifecycleStage === 'customer').length
    const prospects = companies.filter((company) => company.lifecycleStage === 'prospect' || company.lifecycleStage === 'lead').length
    const linkedOrgs = companies.filter((company) => company.linkedOrgId).length
    const incomplete = companies.filter((company) => profileStrength(company) < 60).length
    const managed = companies.filter((company) => company.accountManagerRef || company.accountManagerUid).length
    const revenueRows = companies.filter((company) => typeof company.annualRevenue === 'number' && Number.isFinite(company.annualRevenue))
    const revenue = revenueRows.reduce((sum, company) => sum + (company.annualRevenue ?? 0), 0)
    const currency = revenueRows.find((company) => company.currency)?.currency ?? 'ZAR'
    return { customers, prospects, linkedOrgs, incomplete, managed, revenue, currency }
  }, [companies])

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
    <div className="mx-auto flex max-w-7xl flex-col gap-6 p-6">
      {/* ── Page header ── */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div className="max-w-3xl">
          <p className="eyebrow">CRM accounts</p>
          <h1 className="pib-page-title mt-2">Companies</h1>
          <p className="pib-page-sub mt-2">
            Account context, health, ownership, billing readiness, client-org links, and setup gaps for this workspace.
          </p>
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

      {!loading && !error && (
        <section className="flex flex-wrap gap-3">
          <AccountMetric icon="domain" label="Accounts" value={String(companies.length)} sub={hasActiveFilters ? 'Matching current view' : 'Visible in workspace'} />
          <AccountMetric icon="handshake" label="Customers" value={String(metrics.customers)} sub={`${metrics.prospects} leads/prospects`} />
          <AccountMetric icon="hub" label="Client links" value={String(metrics.linkedOrgs)} sub="Linked portal organisations" />
          <AccountMetric icon="fact_check" label="Setup gaps" value={String(metrics.incomplete)} sub={`${metrics.managed} assigned owners`} />
          <AccountMetric icon="payments" label="Tracked value" value={formatCurrency(metrics.revenue, metrics.currency)} sub="Annual revenue fields" />
        </section>
      )}

      {/* ── Filters bar ── */}
      <div className="pib-card p-4">
        <CompanyFiltersBar value={filters} onChange={updateFilters} />
      </div>

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
