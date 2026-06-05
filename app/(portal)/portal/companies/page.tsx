'use client'
export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import {
  CompaniesBulkCommandBar,
  type CompanyBulkActionKey,
} from '@/components/crm/CompaniesBulkCommandBar'
import { CompaniesTable } from '@/components/crm/CompaniesTable'
import { CompanyFiltersBar } from '@/components/crm/CompanyFiltersBar'
import { companyAccountOwnerUid, companyHasAccountOwner } from '@/lib/companies/ownership'
import type { Company, CompanyListParams } from '@/lib/companies/types'
import { scopedApiPath, scopedPortalPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

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
    companyAccountOwnerUid(company),
    company.notes,
    company.logoUrl,
  ]
  return Math.round((checks.filter(Boolean).length / checks.length) * 100)
}

function hasAccountManager(company: Company): boolean {
  return companyHasAccountOwner(company)
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
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const companyApiPath = useCallback((path: string) => scopedApiPath(path, orgScope), [orgScope])
  const companyPortalPath = useCallback((path: string) => scopedPortalPath(path, orgScope), [orgScope])

  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkAction, setBulkAction] = useState<CompanyBulkActionKey>('lifecycleStage')
  const [bulkPending, setBulkPending] = useState(false)
  const [bulkLifecycleStage, setBulkLifecycleStage] = useState('customer')
  const [bulkTier, setBulkTier] = useState('smb')
  const [bulkSize, setBulkSize] = useState('11-50')
  const [bulkIndustry, setBulkIndustry] = useState('')
  const [bulkTagsInput, setBulkTagsInput] = useState('')
  const [bulkAccountManagerUid, setBulkAccountManagerUid] = useState('')
  const [managerLens, setManagerLens] = useState<'all' | 'unmanaged'>('all')

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
    const managed = companies.filter(hasAccountManager).length
    const unmanaged = companies.length - managed
    const revenueRows = companies.filter((company) => typeof company.annualRevenue === 'number' && Number.isFinite(company.annualRevenue))
    const revenue = revenueRows.reduce((sum, company) => sum + (company.annualRevenue ?? 0), 0)
    const currency = revenueRows.find((company) => company.currency)?.currency ?? 'ZAR'
    const managerCoverage = companies.length > 0 ? managed / companies.length : 1
    return { customers, prospects, linkedOrgs, incomplete, managed, unmanaged, managerCoverage, revenue, currency }
  }, [companies])

  const displayedCompanies = useMemo(
    () => managerLens === 'unmanaged' ? companies.filter((company) => !hasAccountManager(company)) : companies,
    [companies, managerLens],
  )
  const emptyState = managerLens === 'unmanaged'
    ? {
        icon: 'verified_user',
        eyebrow: 'Account ownership clean',
        title: 'No unmanaged companies.',
        description: 'Every visible company already has an account manager.',
        primaryAction: {
          label: 'Show all companies',
          icon: 'filter_alt_off',
          onClick: () => setManagerLens('all'),
        },
      }
    : hasActiveFilters
      ? {
          icon: 'manage_search',
          eyebrow: 'Filtered account view',
          title: 'No companies match this view.',
          description: 'Clear the filters to return to the full account list.',
          primaryAction: {
            label: 'Clear filters',
            icon: 'filter_alt_off',
            onClick: () => updateFilters({}),
          },
        }
      : undefined

  useEffect(() => {
    setSelectedIds(prev => {
      if (prev.size === 0) return prev
      const visible = new Set(displayedCompanies.map(company => company.id))
      const next = new Set(Array.from(prev).filter(id => visible.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [displayedCompanies])

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

      const queryString = query.toString()
      const res = await fetch(companyApiPath(queryString ? `/api/v1/crm/companies?${queryString}` : '/api/v1/crm/companies'))
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
  }, [companyApiPath])

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
    router.replace(companyPortalPath(qs ? `/portal/companies?${qs}` : '/portal/companies'), { scroll: false })
  }

  function retryCompaniesLoad() {
    fetchCompanies(filters)
  }

  // ── Row click → navigate to company detail ────────────────────────────────

  function handleRowClick(id: string) {
    router.push(companyPortalPath(`/portal/companies/${id}`))
  }

  function handleSetupCompany(id: string) {
    router.push(companyPortalPath(`/portal/companies/${id}?edit=profile`))
  }

  function toggleCompany(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAllCompanies() {
    const visibleIds = displayedCompanies.map(company => company.id)
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.has(id))
    if (allVisibleSelected) {
      setSelectedIds(prev => {
        const next = new Set(prev)
        for (const id of visibleIds) next.delete(id)
        return next
      })
    } else {
      setSelectedIds(prev => new Set([...prev, ...visibleIds]))
    }
  }

  async function applyBulk() {
    if (selectedIds.size === 0) return

    let patch: Record<string, unknown> = {}
    if (bulkAction === 'lifecycleStage') {
      patch = { lifecycleStage: bulkLifecycleStage }
    } else if (bulkAction === 'tier') {
      patch = { tier: bulkTier }
    } else if (bulkAction === 'size') {
      patch = { size: bulkSize }
    } else if (bulkAction === 'industry') {
      const industry = bulkIndustry.trim()
      if (!industry) {
        setNotice('Enter an industry before applying this bulk update.')
        return
      }
      patch = { industry }
    } else if (bulkAction === 'tags') {
      const tags = bulkTagsInput.split(',').map(tag => tag.trim()).filter(Boolean)
      if (!tags.length) {
        setNotice('Enter at least one tag before applying this bulk update.')
        return
      }
      patch = { tags }
    } else if (bulkAction === 'accountManagerUid') {
      const accountManagerUid = bulkAccountManagerUid.trim()
      if (!accountManagerUid) {
        setNotice('Enter an account manager UID before applying this bulk update.')
        return
      }
      patch = { accountManagerUid }
    }

    setBulkPending(true)
    setNotice(null)
    try {
      const res = await fetch(companyApiPath('/api/v1/crm/companies/bulk'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds), patch }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Bulk company update failed')
      const { updated = 0, skipped = 0 } = body.data ?? {}
      setNotice(`Updated ${updated} account${updated === 1 ? '' : 's'}, skipped ${skipped}.`)
      setSelectedIds(new Set())
      await fetchCompanies(filters)
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Bulk company update failed')
    } finally {
      setBulkPending(false)
    }
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
            href={companyPortalPath('/portal/companies/migrate')}
            className="cursor-pointer text-xs px-3 py-1.5 rounded-lg border border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] hover:border-[var(--color-pib-text-muted)] transition-colors"
          >
            Migrate from contacts
          </Link>

          <Link
            href={companyPortalPath('/portal/companies/new')}
            className="cursor-pointer flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            style={{ background: 'var(--color-accent-v2)', color: '#fff' }}
            aria-label="New company"
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
          <AccountMetric icon="supervisor_account" label="Manager coverage" value={`${Math.round(metrics.managerCoverage * 100)}%`} sub={`${metrics.unmanaged} unmanaged`} />
          <AccountMetric
            icon="fact_check"
            label="Setup gaps"
            value={String(metrics.incomplete)}
            sub={metrics.incomplete === 1 ? '1 account needs profile cleanup' : `${metrics.incomplete} accounts need profile cleanup`}
          />
          <AccountMetric icon="payments" label="Tracked value" value={formatCurrency(metrics.revenue, metrics.currency)} sub="Annual revenue fields" />
        </section>
      )}

      {!loading && !error && (
        <section className="grid gap-3 md:grid-cols-[1fr_1fr]">
          <button
            type="button"
            onClick={() => setManagerLens(managerLens === 'unmanaged' ? 'all' : 'unmanaged')}
            className={[
              'rounded-[var(--radius-card)] border p-4 text-left transition-colors',
              managerLens === 'unmanaged'
                ? 'border-amber-400/40 bg-amber-400/10'
                : 'border-[var(--color-pib-line)] bg-white/[0.03] hover:bg-white/[0.05]',
            ].join(' ')}
            aria-label={managerLens === 'unmanaged' ? 'Exit unmanaged company lens' : 'Show unmanaged companies needing an account manager'}
          >
            <span className="material-symbols-outlined text-[20px] text-[var(--color-pib-accent)]">manage_accounts</span>
            <p className="mt-3 text-sm font-semibold text-[var(--color-pib-text)]">
              {managerLens === 'unmanaged' ? 'Showing unmanaged accounts' : 'Review unmanaged accounts'}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--color-pib-text-muted)]">
              {metrics.unmanaged > 0
                ? `${metrics.unmanaged} companies need an account manager before revenue, service, or billing ownership slips.`
                : 'Every visible company has an account manager.'}
            </p>
          </button>
          <div className="rounded-[var(--radius-card)] border border-[var(--color-pib-line)] bg-white/[0.03] p-4">
            <span className="material-symbols-outlined text-[20px] text-[var(--color-pib-accent)]">assignment_ind</span>
            <p className="mt-3 text-sm font-semibold text-[var(--color-pib-text)]">Account responsibility</p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--color-pib-text-muted)]">
              Use the visible lens with bulk updates to assign account managers and keep each company owned by a person.
            </p>
          </div>
        </section>
      )}

      {/* ── Filters bar ── */}
      <div className="pib-card p-4">
        <CompanyFiltersBar value={filters} onChange={updateFilters} />
      </div>

      {/* ── Error state ── */}
      {error && (
        <section className="rounded-[var(--radius-card)] border border-amber-500/25 bg-amber-500/[0.07] p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="flex gap-3">
              <span className="material-symbols-outlined mt-0.5 text-amber-200" aria-hidden="true">warning</span>
              <div>
                <p className="eyebrow !text-[10px] text-amber-200">Source health</p>
                <h2 className="mt-1 font-display text-xl text-[var(--color-pib-text)]">Companies could not load</h2>
                <p className="mt-2 text-sm leading-6 text-[var(--color-pib-text-muted)]">{error}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={retryCompaniesLoad}
              className="btn-pib-secondary inline-flex shrink-0 items-center gap-1.5 text-sm"
              aria-label="Retry loading companies"
            >
              <span className="material-symbols-outlined text-base" aria-hidden="true">refresh</span>
              Retry
            </button>
          </div>
        </section>
      )}

      {notice && (
        <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] px-4 py-3 text-sm text-[var(--color-pib-text-muted)]">
          {notice}
        </div>
      )}

      {selectedIds.size > 0 && (
        <CompaniesBulkCommandBar
          selectedCount={selectedIds.size}
          totalCount={displayedCompanies.length}
          bulkAction={bulkAction}
          bulkPending={bulkPending}
          lifecycleStage={bulkLifecycleStage}
          tier={bulkTier}
          size={bulkSize}
          industry={bulkIndustry}
          tagsInput={bulkTagsInput}
          accountManagerUid={bulkAccountManagerUid}
          onActionChange={setBulkAction}
          onLifecycleStageChange={setBulkLifecycleStage}
          onTierChange={setBulkTier}
          onSizeChange={setBulkSize}
          onIndustryChange={setBulkIndustry}
          onTagsInputChange={setBulkTagsInput}
          onAccountManagerUidChange={setBulkAccountManagerUid}
          onClear={() => setSelectedIds(new Set())}
          onApply={applyBulk}
        />
      )}

      {/* ── Table ── */}
      {!error && (
        <CompaniesTable
          companies={displayedCompanies}
          loading={loading}
          onRowClick={handleRowClick}
          onSetupCompany={handleSetupCompany}
          selectedIds={selectedIds}
          onToggleCompany={toggleCompany}
          onToggleAll={toggleAllCompanies}
          emptyState={emptyState}
          newCompanyHref={companyPortalPath('/portal/companies/new')}
          migrateHref={companyPortalPath('/portal/companies/migrate')}
        />
      )}
    </div>
  )
}
