'use client'

import { useCallback, useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import type { Company } from '@/lib/companies/types'
import { CompanyAnalyticsPanel } from '@/components/crm/CompanyAnalyticsPanel'
import { CompanyOverviewPanel } from '@/components/crm/CompanyOverviewPanel'
import { CompanyRowsPanel } from '@/components/crm/CompanyRowsPanel'
import { CompanyTabsBar, type CompanyTab } from '@/components/crm/CompanyTabsBar'
import { CompanyWorkspacePanel, type LinkedWorkspace } from '@/components/crm/CompanyWorkspacePanel'
import { EntityScopedChat } from '@/components/crm/EntityScopedChat'

type Row = { id: string; [key: string]: unknown }
type CommandCenter = {
  company?: Company
  linkedWorkspace?: LinkedWorkspace | null
  summary?: Record<string, number>
  analytics?: {
    accountValue?: number
    weightedPipelineValue?: number
    trackedOrderValue?: number
    openProjectCount?: number
    activeServiceCount?: number
    collaborationCount?: number
    riskSignals?: string[]
  }
  contacts?: Row[]
  deals?: Row[]
  projects?: Row[]
  documents?: Row[]
  serviceWorkspaces?: Row[]
  relationships?: Row[]
  quotes?: Row[]
  invoices?: Row[]
  orders?: Row[]
  shipments?: Row[]
  inventoryItems?: Row[]
  activities?: Row[]
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

function formatCurrency(value: unknown, currency = 'ZAR') {
  const amount = typeof value === 'number' && Number.isFinite(value) ? value : 0
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount)
}

function formatDate(value: unknown) {
  if (!value) return '-'
  let date: Date | null = null
  if (value instanceof Date) date = value
  else if (typeof value === 'string') {
    const parsed = new Date(value)
    date = Number.isNaN(parsed.getTime()) ? null : parsed
  } else if (typeof value === 'object') {
    const source = value as { toDate?: () => Date; seconds?: number; _seconds?: number }
    if (typeof source.toDate === 'function') date = source.toDate()
    else {
      const seconds = source.seconds ?? source._seconds
      if (typeof seconds === 'number') date = new Date(seconds * 1000)
    }
  }
  return date ? date.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'
}

function initials(name?: string) {
  return (name || 'Company')
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

function rowsFor(center: CommandCenter, tab: CompanyTab): Row[] {
  if (tab === 'services') return center.serviceWorkspaces ?? []
  if (tab === 'inventory') return center.inventoryItems ?? []
  const key = tab as keyof CommandCenter
  const rows = center[key]
  return Array.isArray(rows) ? rows : []
}

function tabCountsFor(center: CommandCenter): Partial<Record<CompanyTab, number>> {
  const summary = center.summary ?? {}
  return {
    contacts: summary.contacts ?? center.contacts?.length ?? 0,
    deals: summary.deals ?? center.deals?.length ?? 0,
    projects: summary.projects ?? center.projects?.length ?? 0,
    documents: summary.documents ?? center.documents?.length ?? 0,
    services: summary.serviceWorkspaces ?? center.serviceWorkspaces?.length ?? 0,
    relationships: summary.relationships ?? center.relationships?.length ?? 0,
    quotes: summary.quotes ?? center.quotes?.length ?? 0,
    invoices: summary.invoices ?? center.invoices?.length ?? 0,
    orders: summary.orders ?? center.orders?.length ?? 0,
    shipments: summary.shipments ?? center.shipments?.length ?? 0,
    inventory: summary.inventoryItems ?? center.inventoryItems?.length ?? 0,
    activity: summary.activities ?? center.activities?.length ?? 0,
  }
}

function rowTitle(row: Row, tab: CompanyTab) {
  if (tab === 'contacts') return String(row.name ?? row.email ?? row.id)
  if (tab === 'deals') return String(row.title ?? row.name ?? row.id)
  if (tab === 'projects') return String(row.name ?? row.title ?? row.id)
  if (tab === 'documents') return String(row.title ?? row.name ?? row.id)
  if (tab === 'services') return String(row.name ?? row.serviceType ?? row.id)
  if (tab === 'relationships') return String(row.targetName ?? row.relationshipType ?? row.id)
  if (tab === 'quotes') return String(row.quoteNumber ?? row.id)
  if (tab === 'invoices') return String(row.invoiceNumber ?? row.id)
  if (tab === 'orders') return String(row.title ?? row.id)
  if (tab === 'shipments') return String(row.trackingNumber ?? row.carrier ?? row.id)
  if (tab === 'inventory') return String(row.name ?? row.sku ?? row.id)
  if (tab === 'activity') return String(row.summary ?? row.type ?? row.id)
  return row.id
}

function linkedValue(row: Row, key: string) {
  const linked = row.linked
  return linked && typeof linked === 'object' && !Array.isArray(linked)
    ? (linked as Record<string, unknown>)[key]
    : undefined
}

function documentDirectionLabel(row: Row, company?: Company) {
  if (!company) return 'Linked'
  if (row.orgId && row.orgId === company.orgId) return 'Sent'
  if (row.orgId && company.linkedOrgId && row.orgId === company.linkedOrgId) return 'Received'
  if (linkedValue(row, 'clientOrgId') === company.orgId) return 'Received'
  return 'Linked'
}

function rowMeta(row: Row, tab: CompanyTab, company?: Company) {
  if (tab === 'contacts') return [String(row.email ?? ''), String(row.phone ?? '')]
  if (tab === 'deals') return [formatCurrency(row.value, String(row.currency ?? 'ZAR')), String(row.stageId ?? '')]
  if (tab === 'projects') return [String(row.description ?? ''), formatDate(row.updatedAt)]
  if (tab === 'documents') return [documentDirectionLabel(row, company), String(row.type ?? ''), formatDate(row.updatedAt)]
  if (tab === 'services') return [String(row.serviceType ?? ''), String(row.visibility ?? '')]
  if (tab === 'relationships') return [String(row.relationshipType ?? ''), Array.isArray(row.sharedCapabilities) ? row.sharedCapabilities.join(', ') : '']
  if (tab === 'quotes' || tab === 'invoices') return [formatCurrency(row.total, String(row.currency ?? 'ZAR')), formatDate(row.validUntil ?? row.dueDate)]
  if (tab === 'orders') return [String(row.fulfillmentStatus ?? ''), formatCurrency(row.total, String(row.currency ?? 'ZAR'))]
  if (tab === 'shipments') return [String(row.carrier ?? ''), formatDate(row.expectedDeliveryDate)]
  if (tab === 'inventory') return [String(row.sku ?? ''), typeof row.quantityAvailable === 'number' ? `${row.quantityAvailable} available` : '']
  if (tab === 'activity') return [String(row.type ?? ''), formatDate(row.createdAt)]
  return []
}

function adminCompanyRecordHref(row: Row, tab: CompanyTab, adminOrgSlug: string, companyId: string) {
  if (!row.id) return null
  const encodedSlug = encodeURIComponent(adminOrgSlug)
  const encodedCompanyId = encodeURIComponent(companyId)
  const encodedRecordId = encodeURIComponent(row.id)
  if (tab === 'contacts' || tab === 'deals') {
    return `/admin/org/${encodedSlug}/crm/companies/${encodedCompanyId}?tab=${encodeURIComponent(tab)}&record=${encodedRecordId}`
  }
  if (tab === 'projects') return `/admin/org/${encodedSlug}/projects/${encodedRecordId}`
  if (tab === 'documents') return `/admin/org/${encodedSlug}/documents/${encodedRecordId}`
  return null
}

const EMPTY_TAB_LABELS: Partial<Record<CompanyTab, string>> = {
  contacts: 'Contacts',
  deals: 'Deals',
  projects: 'Projects',
  documents: 'Documents',
  services: 'Service workspaces',
  relationships: 'Business relationships',
  quotes: 'Quotes',
  invoices: 'Invoices',
  orders: 'Orders',
  shipments: 'Shipments',
  inventory: 'Inventory items',
  activity: 'Activity',
}

function AdminRowsEmptyState({
  label,
  lowerLabel,
  companyName,
  adminOrgDashboardHref,
  onReviewOverview,
}: {
  label: string
  lowerLabel: string
  companyName: string
  adminOrgDashboardHref: string
  onReviewOverview: () => void
}) {
  return (
    <div className="bento-card p-8 text-center">
      <span className="material-symbols-outlined text-4xl text-amber-200">hub</span>
      <p className="eyebrow mt-4 !text-[10px] text-amber-200">{label} not linked yet</p>
      <h2 className="mt-2 font-display text-xl text-[var(--color-pib-text)]">Review selected-org context from the admin workspace</h2>
      <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-[var(--color-pib-text-muted)]">
        No {lowerLabel} are linked to {companyName} yet. Review the company overview or open the selected client org dashboard so relationship ownership, email history, and pipeline handoffs stay visible to PiB operators.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={onReviewOverview}
          aria-label={`Review overview for ${companyName}`}
          className="btn-pib-secondary inline-flex items-center gap-1.5"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[16px]">monitoring</span>
          Review overview
        </button>
        <Link
          href={adminOrgDashboardHref}
          aria-label={`Open selected org dashboard for ${companyName}`}
          className="btn-pib-primary inline-flex items-center gap-1.5"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[16px]">open_in_new</span>
          Open org dashboard
        </Link>
      </div>
    </div>
  )
}

function AdminRowsPanel({
  tab,
  rows,
  company,
  companyName,
  adminOrgSlug,
  adminOrgDashboardHref,
  onReviewOverview,
}: {
  tab: CompanyTab
  rows: Row[]
  company: Company
  companyName: string
  adminOrgSlug: string
  adminOrgDashboardHref: string
  onReviewOverview: () => void
}) {
  const filterable = tab === 'projects' || tab === 'documents'
  const label = EMPTY_TAB_LABELS[tab] ?? 'Records'
  const lowerLabel = label.toLowerCase()
  const documentDirectionCounts = tab === 'documents'
    ? rows.reduce(
      (counts, row) => {
        const direction = documentDirectionLabel(row, company).toLowerCase() as 'sent' | 'received' | 'linked'
        counts[direction] += 1
        return counts
      },
      { sent: 0, received: 0, linked: 0 },
    )
    : null

  return (
    <div className="space-y-3">
      {documentDirectionCounts && rows.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { label: 'Sent', value: documentDirectionCounts.sent },
            { label: 'Received', value: documentDirectionCounts.received },
            { label: 'Linked', value: documentDirectionCounts.linked },
          ].map((item) => (
            <div key={item.label} className="rounded-2xl border border-[var(--color-pib-line)] bg-white/[0.03] px-4 py-3">
              <p className="eyebrow !text-[9px]">{item.label}</p>
              <p className="mt-1 font-display text-2xl text-[var(--color-pib-text)]">{item.value}</p>
            </div>
          ))}
        </div>
      ) : null}
      <CompanyRowsPanel
      rows={rows}
      emptyIcon="hub"
      emptyLabel={`${label} not linked yet`}
      emptyContent={(
        <AdminRowsEmptyState
          label={label}
          lowerLabel={lowerLabel}
          companyName={companyName}
          adminOrgDashboardHref={adminOrgDashboardHref}
          onReviewOverview={onReviewOverview}
        />
      )}
      filteredEmptyLabel={`No matching ${lowerLabel}. Try clearing the search, status, or history filter.`}
      title={(row) => rowTitle(row, tab)}
      hrefFor={(row) => {
        return adminCompanyRecordHref(row, tab, adminOrgSlug, company.id) ?? undefined
      }}
      rowAriaLabel={(_row, title) => `Open ${title} from ${companyName} admin command center`}
      metaFor={(row) => rowMeta(row, tab, tab === 'documents' ? company : undefined)}
      enableFilters={filterable}
      searchPlaceholder={tab === 'projects' ? 'Search projects...' : 'Search documents...'}
      statusEmptyLabel="-"
      linkedRow
    />
    </div>
  )
}

export default function AdminCompanyCommandCenterPage() {
  const params = useParams<{ slug: string; id: string }>()
  const slug = params.slug
  const id = params.id
  const [tab, setTab] = useState<CompanyTab>('overview')
  const [center, setCenter] = useState<CommandCenter | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!slug || !id) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/admin/crm/companies/${id}/command-center?orgSlug=${encodeURIComponent(slug)}&limit=100`)
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setCenter(body.data ?? body)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load company command center')
    } finally {
      setLoading(false)
    }
  }, [id, slug])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (error || !center?.company) {
    return (
      <div className="bento-card p-10 text-center">
        <span className="material-symbols-outlined text-4xl text-[var(--color-pib-text-muted)]">error_outline</span>
        <p className="mt-3 text-sm text-[var(--color-pib-text-muted)]">{error ?? 'Company not found.'}</p>
        <Link href={`/admin/org/${slug}/dashboard`} className="btn-pib-secondary mt-5 inline-flex items-center gap-1.5">
          <span className="material-symbols-outlined text-sm">arrow_back</span>
          Admin org dashboard
        </Link>
      </div>
    )
  }

  const company = center.company
  const adminOrgDashboardHref = `/admin/org/${encodeURIComponent(slug)}/dashboard`

  return (
    <div className="space-y-6">
      <Link
        href={`/admin/org/${slug}/dashboard`}
        className="inline-flex items-center gap-1 text-xs text-[var(--color-pib-text-muted)] transition-colors hover:text-[var(--color-pib-text)]"
      >
        <span className="material-symbols-outlined text-sm">arrow_back</span>
        Admin org workspace
      </Link>

      <div className="bento-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-4">
            {company.logoUrl ? (
              <Image
                src={company.logoUrl}
                alt={company.name}
                width={64}
                height={64}
                unoptimized
                className="h-16 w-16 shrink-0 rounded-2xl object-cover"
              />
            ) : (
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-[var(--color-surface-container)] text-xl font-label text-on-surface-variant">
                {initials(company.name)}
              </div>
            )}
            <div className="min-w-0">
              <p className="eyebrow !text-[10px]">Admin company command center</p>
              <h1 className="truncate text-2xl font-semibold text-[var(--color-pib-text)]">{company.name}</h1>
              <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">
                {center.summary?.contacts ?? 0} contacts · {center.summary?.projects ?? 0} projects · {center.summary?.orders ?? 0} orders
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={adminOrgDashboardHref} className="btn-pib-secondary inline-flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px]">visibility</span>
              Org dashboard
            </Link>
            <button type="button" onClick={() => void load()} className="btn-pib-primary inline-flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px]">refresh</span>
              Refresh
            </button>
          </div>
        </div>
      </div>

      <CompanyTabsBar
        activeTab={tab}
        onChange={(next) => setTab(next as CompanyTab)}
        counts={tabCountsFor(center)}
        includeWorkspace={Boolean(center.linkedWorkspace)}
      />

      <div role="tabpanel">
        {tab === 'overview' && (
          <CompanyOverviewPanel
            company={company}
            center={center}
            onSelectTab={(nextTab) => setTab(nextTab as CompanyTab)}
          />
        )}
        {tab === 'analytics' && (
          <CompanyAnalyticsPanel
            analytics={center.analytics}
            summary={center.summary}
            companyName={company.name}
            hrefForTab={(targetTab) => `/admin/org/${encodeURIComponent(slug)}/crm/companies/${encodeURIComponent(id)}?tab=${encodeURIComponent(targetTab)}`}
            riskClearActionHref={adminOrgDashboardHref}
            riskClearActionLabel="Open admin risk review"
            riskClearActionAriaLabel={`Open admin risk review for ${company.name}`}
            riskClearActionIcon="open_in_new"
            riskClearBody={`No active risk signals are flagged for ${company.name}. Review the selected client org dashboard so finance, delivery, and relationship risk stays visible to PiB operators before the account surprises leadership.`}
          />
        )}
        {tab === 'workspace' && (
          <CompanyWorkspacePanel
            companyName={company.name}
            mode="admin"
            workspace={center.linkedWorkspace ?? null}
          />
        )}
        {tab === 'chat' && (
          <EntityScopedChat
            orgId={company.orgId}
            orgName={company.name}
            entityType="company"
            entityId={company.id}
            entityLabel={company.name}
            href={`/admin/org/${slug}/crm/companies/${id}`}
            summary={`${company.name} CRM company${company.lifecycleStage ? ` · ${company.lifecycleStage}` : ''}${company.linkedOrgId ? ` · linked workspace ${company.linkedOrgId}` : ' · unlinked lead workspace'}`}
          />
        )}
        {tab !== 'overview' && tab !== 'analytics' && tab !== 'workspace' && tab !== 'chat' && (
          <AdminRowsPanel
            tab={tab}
            rows={rowsFor(center, tab)}
            company={company}
            companyName={company.name}
            adminOrgSlug={slug}
            adminOrgDashboardHref={adminOrgDashboardHref}
            onReviewOverview={() => setTab('overview')}
          />
        )}
      </div>
    </div>
  )
}
