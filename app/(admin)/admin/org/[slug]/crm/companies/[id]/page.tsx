'use client'

import { useCallback, useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import type { Company } from '@/lib/companies/types'
import { CompanyOverviewPanel } from '@/components/crm/CompanyOverviewPanel'
import { CompanyTabsBar, type CompanyTab } from '@/components/crm/CompanyTabsBar'
import { CompanyWorkspacePanel, type LinkedWorkspace } from '@/components/crm/CompanyWorkspacePanel'
import { EntityScopedChat } from '@/components/crm/EntityScopedChat'
import { scopedPortalPath } from '@/lib/portal/scoped-routing'

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

function StatusChip({ value }: { value?: unknown }) {
  const label = typeof value === 'string' ? value.trim() : ''
  if (!label) return <span className="text-xs text-[var(--color-pib-text-muted)]">-</span>
  return (
    <span className="inline-flex rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-label uppercase tracking-wide text-emerald-300">
      {label.replace(/_/g, ' ')}
    </span>
  )
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

function rowMeta(row: Row, tab: CompanyTab) {
  if (tab === 'contacts') return [String(row.email ?? ''), String(row.phone ?? '')]
  if (tab === 'deals') return [formatCurrency(row.value, String(row.currency ?? 'ZAR')), String(row.stageId ?? '')]
  if (tab === 'projects') return [String(row.description ?? ''), formatDate(row.updatedAt)]
  if (tab === 'documents') return [String(row.type ?? ''), formatDate(row.updatedAt)]
  if (tab === 'services') return [String(row.serviceType ?? ''), String(row.visibility ?? '')]
  if (tab === 'relationships') return [String(row.relationshipType ?? ''), Array.isArray(row.sharedCapabilities) ? row.sharedCapabilities.join(', ') : '']
  if (tab === 'quotes' || tab === 'invoices') return [formatCurrency(row.total, String(row.currency ?? 'ZAR')), formatDate(row.validUntil ?? row.dueDate)]
  if (tab === 'orders') return [String(row.fulfillmentStatus ?? ''), formatCurrency(row.total, String(row.currency ?? 'ZAR'))]
  if (tab === 'shipments') return [String(row.carrier ?? ''), formatDate(row.expectedDeliveryDate)]
  if (tab === 'inventory') return [String(row.sku ?? ''), typeof row.quantityAvailable === 'number' ? `${row.quantityAvailable} available` : '']
  if (tab === 'activity') return [String(row.type ?? ''), formatDate(row.createdAt)]
  return []
}

function scopedPortalCompanyPath(path: string, company: Company, workspace?: LinkedWorkspace | null) {
  if (!workspace) return path
  return scopedPortalPath(path, {
    orgId: workspace.orgId || workspace.id,
    orgSlug: workspace.orgSlug || workspace.slug,
    sourceCompanyId: company.id,
    sourceCompanyName: company.name,
  })
}

function rowHref(row: Row, tab: CompanyTab) {
  if (!row.id) return null
  if (tab === 'contacts') return `/portal/contacts/${row.id}`
  if (tab === 'deals') return `/portal/deals/${row.id}`
  if (tab === 'documents') return `/portal/documents/${row.id}`
  if (tab === 'projects') return `/portal/projects/${row.id}`
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

function SimpleRowsPanel({
  tab,
  rows,
  companyName,
  portalHref,
  portalPathFor,
  onReviewOverview,
}: {
  tab: CompanyTab
  rows: Row[]
  companyName: string
  portalHref: string
  portalPathFor: (path: string) => string
  onReviewOverview: () => void
}) {
  if (rows.length === 0) {
    const label = EMPTY_TAB_LABELS[tab] ?? 'Records'
    const lowerLabel = label.toLowerCase()
    return (
      <div className="bento-card p-8 text-center">
        <span className="material-symbols-outlined text-4xl text-amber-200">hub</span>
        <p className="eyebrow mt-4 !text-[10px] text-amber-200">{label} not linked yet</p>
        <h2 className="mt-2 font-display text-xl text-[var(--color-pib-text)]">Start account context from the client workspace</h2>
        <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-[var(--color-pib-text-muted)]">
          No {lowerLabel} are linked to {companyName} yet. Review the company overview or open the portal workspace so relationship ownership, email history, and pipeline handoffs stop living outside CRM.
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
            href={portalHref}
            aria-label={`Open portal workspace for ${companyName}`}
            className="btn-pib-primary inline-flex items-center gap-1.5"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[16px]">open_in_new</span>
            Open portal workspace
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="bento-card divide-y divide-[var(--color-pib-line)]">
      {rows.map((row) => {
        const meta = rowMeta(row, tab).filter(Boolean)
        const title = rowTitle(row, tab)
        const href = rowHref(row, tab)
        const scopedHref = href ? portalPathFor(href) : null
        const rowContent = (
          <>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-[var(--color-pib-text)]">{title}</p>
              {meta.length > 0 && (
                <p className="mt-1 truncate text-xs text-[var(--color-pib-text-muted)]">{meta.join(' · ')}</p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <StatusChip value={row.status} />
              {scopedHref ? (
                <span aria-hidden="true" className="material-symbols-outlined text-[16px] text-[var(--color-pib-text-muted)]">
                  open_in_new
                </span>
              ) : null}
            </div>
          </>
        )

        if (scopedHref) {
          return (
            <Link
              key={row.id}
              href={scopedHref}
              aria-label={`Open ${title} from ${companyName} admin command center`}
              className="flex items-start justify-between gap-4 px-5 py-4 transition-colors hover:bg-white/[0.03] focus:outline-none focus:ring-2 focus:ring-[var(--color-pib-accent)] focus:ring-offset-2 focus:ring-offset-[var(--color-pib-bg)]"
            >
              {rowContent}
            </Link>
          )
        }

        return (
          <div key={row.id} className="flex items-start justify-between gap-4 px-5 py-4">
            {rowContent}
          </div>
        )
      })}
    </div>
  )
}

function AnalyticsPanel({ center, companyName, portalHref }: { center: CommandCenter; companyName: string; portalHref: string }) {
  const analytics = center.analytics ?? {}
  const summary = center.summary ?? {}
  const tiles = [
    { label: 'Account value', value: formatCurrency(analytics.accountValue), icon: 'payments' },
    { label: 'Weighted pipeline', value: formatCurrency(analytics.weightedPipelineValue), icon: 'query_stats' },
    { label: 'Tracked orders', value: formatCurrency(analytics.trackedOrderValue), icon: 'orders' },
    { label: 'Open projects', value: String(analytics.openProjectCount ?? summary.projects ?? 0), icon: 'folder_managed' },
    { label: 'Active services', value: String(analytics.activeServiceCount ?? summary.serviceWorkspaces ?? 0), icon: 'workspaces' },
    { label: 'Collaborations', value: String(analytics.collaborationCount ?? summary.relationships ?? 0), icon: 'hub' },
  ]

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        {tiles.map((tile) => (
          <div key={tile.label} className="pib-stat-card">
            <div className="flex items-start justify-between gap-3">
              <p className="eyebrow !text-[10px]">{tile.label}</p>
              <span className="material-symbols-outlined text-[18px] text-[var(--color-pib-text-muted)]">{tile.icon}</span>
            </div>
            <p className="mt-3 text-2xl font-semibold text-[var(--color-pib-text)]">{tile.value}</p>
          </div>
        ))}
      </div>
      <div className="bento-card p-5">
        <p className="eyebrow !text-[10px]">Risk signals</p>
        {(analytics.riskSignals ?? []).length === 0 ? (
          <div className="mt-3 rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-4">
            <p className="eyebrow !text-[10px] text-emerald-200">Risk watch clear</p>
            <h3 className="mt-1 text-sm font-semibold text-[var(--color-pib-text)]">Keep leadership risk reviewable</h3>
            <p className="mt-1 text-sm leading-6 text-[var(--color-pib-text-muted)]">
              No active risk signals are flagged for {companyName}. Review the portal workspace so finance, delivery, and relationship risk stay visible before the account surprises leadership.
            </p>
            <Link
              href={portalHref}
              aria-label={`Open portal risk review for ${companyName}`}
              className="btn-pib-secondary mt-3 inline-flex items-center gap-1.5 text-xs"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[14px]">open_in_new</span>
              Open portal risk review
            </Link>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            {(analytics.riskSignals ?? []).map((signal) => (
              <span key={signal} className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-xs text-amber-200">
                {signal}
              </span>
            ))}
          </div>
        )}
      </div>
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
          Client dashboard
        </Link>
      </div>
    )
  }

  const company = center.company
  const portalPathFor = (path: string) => scopedPortalCompanyPath(path, company, center.linkedWorkspace)
  const portalCompanyHref = portalPathFor(`/portal/companies/${id}`)

  return (
    <div className="space-y-6">
      <Link
        href={`/admin/org/${slug}/dashboard`}
        className="inline-flex items-center gap-1 text-xs text-[var(--color-pib-text-muted)] transition-colors hover:text-[var(--color-pib-text)]"
      >
        <span className="material-symbols-outlined text-sm">arrow_back</span>
        Client workspace
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
            <Link href={portalCompanyHref} className="btn-pib-secondary inline-flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px]">visibility</span>
              Portal view
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
          <AnalyticsPanel center={center} companyName={company.name} portalHref={portalCompanyHref} />
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
          <SimpleRowsPanel
            tab={tab}
            rows={rowsFor(center, tab)}
            companyName={company.name}
            portalHref={portalCompanyHref}
            portalPathFor={portalPathFor}
            onReviewOverview={() => setTab('overview')}
          />
        )}
      </div>
    </div>
  )
}
