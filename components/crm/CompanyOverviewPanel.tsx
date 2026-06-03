'use client'

import Link from 'next/link'
import { DonutChart, HorizontalBarChart, RevenueBarChart, StatCardWithChart } from '@/components/ui/Charts'
import type { Company } from '@/lib/companies/types'

type OverviewRow = { id?: string; [key: string]: unknown }

type SummaryKey =
  | 'contacts'
  | 'deals'
  | 'projects'
  | 'documents'
  | 'serviceWorkspaces'
  | 'relationships'
  | 'quotes'
  | 'invoices'
  | 'orders'
  | 'shipments'
  | 'inventoryItems'
  | 'openOrders'
  | 'lowStockItems'
  | 'overdueInvoices'

type ListKey =
  | 'contacts'
  | 'deals'
  | 'projects'
  | 'documents'
  | 'serviceWorkspaces'
  | 'relationships'
  | 'quotes'
  | 'invoices'
  | 'orders'
  | 'shipments'
  | 'inventoryItems'
  | 'activities'

export interface CompanyOverviewCenter {
  summary?: Partial<Record<SummaryKey, number>>
  analytics?: {
    accountValue?: number
    weightedPipelineValue?: number
    trackedOrderValue?: number
    openProjectCount?: number
    activeServiceCount?: number
    collaborationCount?: number
    riskSignals?: string[]
  }
  contacts?: OverviewRow[]
  deals?: OverviewRow[]
  projects?: OverviewRow[]
  documents?: OverviewRow[]
  serviceWorkspaces?: OverviewRow[]
  relationships?: OverviewRow[]
  quotes?: OverviewRow[]
  invoices?: OverviewRow[]
  orders?: OverviewRow[]
  shipments?: OverviewRow[]
  inventoryItems?: OverviewRow[]
  activities?: OverviewRow[]
}

export interface CompanyOverviewPanelProps {
  company: Company
  center?: CompanyOverviewCenter
  loading?: boolean
  onSelectTab?: (tab: string) => void
  onEditCompany?: () => void
}

const WIDGETS: Array<{
  key: SummaryKey
  listKey?: ListKey
  label: string
  icon: string
  color: string
  tab: string
}> = [
  { key: 'contacts', listKey: 'contacts', label: 'Contacts', icon: 'groups', color: '#60a5fa', tab: 'contacts' },
  { key: 'deals', listKey: 'deals', label: 'Deals', icon: 'monetization_on', color: '#4ade80', tab: 'deals' },
  { key: 'projects', listKey: 'projects', label: 'Projects', icon: 'folder_managed', color: '#f59e0b', tab: 'projects' },
  { key: 'documents', listKey: 'documents', label: 'Documents', icon: 'description', color: '#a78bfa', tab: 'documents' },
  { key: 'serviceWorkspaces', listKey: 'serviceWorkspaces', label: 'Services', icon: 'workspaces', color: '#22d3ee', tab: 'services' },
  { key: 'relationships', listKey: 'relationships', label: 'Relationships', icon: 'hub', color: '#f472b6', tab: 'relationships' },
  { key: 'quotes', listKey: 'quotes', label: 'Quotes', icon: 'request_quote', color: '#fb923c', tab: 'quotes' },
  { key: 'invoices', listKey: 'invoices', label: 'Invoices', icon: 'receipt_long', color: '#38bdf8', tab: 'invoices' },
  { key: 'orders', listKey: 'orders', label: 'Orders', icon: 'orders', color: '#34d399', tab: 'orders' },
  { key: 'shipments', listKey: 'shipments', label: 'Shipments', icon: 'local_shipping', color: '#818cf8', tab: 'shipments' },
  { key: 'inventoryItems', listKey: 'inventoryItems', label: 'Stock', icon: 'inventory_2', color: '#f87171', tab: 'inventory' },
]

const PROFILE_CHECKS = [
  { label: 'Website', done: (company: Company, counts: Record<SummaryKey, number>) => Boolean(company.website || company.domain || counts.projects > 0) },
  { label: 'Billing', done: (company: Company) => Boolean(company.billingEmail || company.vatNumber || company.registrationNumber || company.accountsContact?.email) },
  { label: 'Primary contact', done: (company: Company, counts: Record<SummaryKey, number>) => Boolean(company.phone || counts.contacts > 0) },
  { label: 'CRM links', done: (_company: Company, counts: Record<SummaryKey, number>) => counts.contacts + counts.deals + counts.relationships > 0 },
  { label: 'Delivery work', done: (_company: Company, counts: Record<SummaryKey, number>) => counts.projects + counts.serviceWorkspaces + counts.documents > 0 },
  { label: 'Commerce', done: (_company: Company, counts: Record<SummaryKey, number>) => counts.quotes + counts.invoices + counts.orders > 0 },
]

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

function numberValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function externalHref(value?: string | null): string {
  const trimmed = value?.trim() ?? ''
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

function timestampMs(value: unknown): number {
  if (!value) return 0
  if (value instanceof Date) {
    const ms = value.getTime()
    return Number.isFinite(ms) ? ms : 0
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  if (typeof value === 'object') {
    const timestamp = value as { toMillis?: () => number; toDate?: () => Date; seconds?: number; _seconds?: number }
    if (typeof timestamp.toMillis === 'function') {
      const ms = timestamp.toMillis()
      return Number.isFinite(ms) ? ms : 0
    }
    if (typeof timestamp.toDate === 'function') {
      const ms = timestamp.toDate().getTime()
      return Number.isFinite(ms) ? ms : 0
    }
    const seconds = timestamp.seconds ?? timestamp._seconds
    if (typeof seconds === 'number' && Number.isFinite(seconds)) return seconds * 1000
  }
  return 0
}

function hasUnreadableTimestamp(value: unknown): boolean {
  if (!value) return false
  if (value instanceof Date) return !Number.isFinite(value.getTime())
  if (typeof value === 'string') return !Number.isFinite(Date.parse(value))
  if (typeof value === 'object') {
    const timestamp = value as { toMillis?: () => number; toDate?: () => Date; seconds?: unknown; _seconds?: unknown }
    if (typeof timestamp.toMillis === 'function') {
      const ms = timestamp.toMillis()
      return !Number.isFinite(ms)
    }
    if (typeof timestamp.toDate === 'function') {
      const ms = timestamp.toDate().getTime()
      return !Number.isFinite(ms)
    }
    if ('seconds' in timestamp || '_seconds' in timestamp) {
      const seconds = timestamp.seconds ?? timestamp._seconds
      return typeof seconds !== 'number' || !Number.isFinite(seconds)
    }
  }
  return false
}

function formatDate(value: unknown): string {
  const ms = timestampMs(value)
  if (!ms) return hasUnreadableTimestamp(value) ? 'Movement date needs review' : 'No date'
  return new Date(ms).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatCurrency(value: unknown, currency = 'ZAR'): string {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(numberValue(value))
}

function rowList(center: CompanyOverviewCenter | undefined, key: ListKey): OverviewRow[] {
  const rows = center?.[key]
  return Array.isArray(rows) ? rows : []
}

function countFor(center: CompanyOverviewCenter | undefined, key: SummaryKey, listKey?: ListKey): number {
  const summaryValue = center?.summary?.[key]
  if (typeof summaryValue === 'number' && Number.isFinite(summaryValue)) return summaryValue
  return listKey ? rowList(center, listKey).length : 0
}

function buildCounts(center: CompanyOverviewCenter | undefined): Record<SummaryKey, number> {
  return WIDGETS.reduce<Record<SummaryKey, number>>((acc, item) => {
    acc[item.key] = countFor(center, item.key, item.listKey)
    return acc
  }, {
    contacts: 0,
    deals: 0,
    projects: 0,
    documents: 0,
    serviceWorkspaces: 0,
    relationships: 0,
    quotes: 0,
    invoices: 0,
    orders: 0,
    shipments: 0,
    inventoryItems: 0,
    openOrders: countFor(center, 'openOrders'),
    lowStockItems: countFor(center, 'lowStockItems'),
    overdueInvoices: countFor(center, 'overdueInvoices'),
  })
}

function sumRows(rows: OverviewRow[], fieldNames: string[]): number {
  return rows.reduce((total, row) => {
    const field = fieldNames.find((name) => row[name] !== undefined)
    return total + numberValue(field ? row[field] : 0)
  }, 0)
}

function statusTone(value: unknown): { label: string; className: string } {
  const status = stringValue(value).toLowerCase()
  if (!status) return { label: 'Linked', className: 'border-white/10 bg-white/5 text-[var(--color-pib-text-muted)]' }
  const label = readableStatusLabel(status)
  if (['active', 'approved', 'paid', 'fulfilled', 'live', 'completed', 'won'].includes(status)) {
    return { label, className: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200' }
  }
  if (['pending', 'pending_approval', 'client_review', 'qa_review', 'in_progress', 'open', 'draft', 'review'].includes(status)) {
    return { label, className: 'border-amber-400/30 bg-amber-400/10 text-amber-200' }
  }
  if (['blocked', 'overdue', 'failed', 'cancelled', 'lost', 'out_of_stock', 'low_stock'].includes(status)) {
    return { label, className: 'border-red-400/30 bg-red-400/10 text-red-200' }
  }
  return { label, className: 'border-white/10 bg-white/5 text-[var(--color-pib-text-muted)]' }
}

function readableStatusLabel(value: string): string {
  return value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part, index) => {
      const lower = part.toLowerCase()
      return index === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower
    })
    .join(' ')
}

function readableAccountLabel(value?: string): string | undefined {
  if (!value) return undefined
  return readableStatusLabel(value)
}

function rowTitle(row: OverviewRow, fallback: string): string {
  return (
    stringValue(row.title) ||
    stringValue(row.name) ||
    stringValue(row.summary) ||
    stringValue(row.email) ||
    stringValue(row.quoteNumber) ||
    stringValue(row.invoiceNumber) ||
    stringValue(row.trackingNumber) ||
    stringValue(row.sku) ||
    fallback
  )
}

function latestMovement(center: CompanyOverviewCenter | undefined): Array<{
  id: string
  title: string
  meta: string
  icon: string
  dateValue: unknown
  status?: unknown
}> {
  const rows = [
    ...rowList(center, 'activities').map((row, index) => ({
      id: `activity-${row.id ?? index}`,
      title: rowTitle(row, 'Activity'),
      meta: stringValue(row.type) || 'Activity',
      icon: 'history',
      dateValue: row.createdAt ?? row.updatedAt,
      status: row.status,
    })),
    ...rowList(center, 'deals').map((row, index) => ({
      id: `deal-${row.id ?? index}`,
      title: rowTitle(row, 'Deal'),
      meta: `${formatCurrency(row.value, stringValue(row.currency) || 'ZAR')} deal`,
      icon: 'monetization_on',
      dateValue: row.updatedAt ?? row.createdAt,
      status: row.status ?? row.stageId,
    })),
    ...rowList(center, 'projects').map((row, index) => ({
      id: `project-${row.id ?? index}`,
      title: rowTitle(row, 'Project'),
      meta: 'Project',
      icon: 'folder_managed',
      dateValue: row.updatedAt ?? row.createdAt,
      status: row.status,
    })),
    ...rowList(center, 'documents').map((row, index) => ({
      id: `document-${row.id ?? index}`,
      title: rowTitle(row, 'Document'),
      meta: stringValue(row.type) || 'Document',
      icon: 'description',
      dateValue: row.updatedAt ?? row.createdAt,
      status: row.status,
    })),
    ...rowList(center, 'orders').map((row, index) => ({
      id: `order-${row.id ?? index}`,
      title: rowTitle(row, 'Order'),
      meta: `${formatCurrency(row.total, stringValue(row.currency) || 'ZAR')} order`,
      icon: 'orders',
      dateValue: row.updatedAt ?? row.createdAt,
      status: row.status ?? row.fulfillmentStatus,
    })),
  ]

  return rows
    .sort((a, b) => timestampMs(b.dateValue) - timestampMs(a.dateValue))
    .slice(0, 6)
}

function SectionCard({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="pib-card-section overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-pib-line)] bg-white/[0.02] px-5 py-3">
        <p className="eyebrow !text-[10px]">{title}</p>
        {action}
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  )
}

function Field({
  label,
  value,
  href,
  external = false,
}: {
  label: string
  value?: string | number | null
  href?: string
  external?: boolean
}) {
  if (!value && value !== 0) return null
  return (
    <div className="flex items-baseline gap-3 py-1">
      <span className="w-28 shrink-0 text-[11px] text-[var(--color-pib-text-muted)]">{label}</span>
      {href ? (
        <a
          href={href}
          target={external ? '_blank' : undefined}
          rel={external ? 'noopener noreferrer' : undefined}
          className="min-w-0 break-all text-sm text-[var(--color-accent-v2)] hover:underline"
        >
          {value}
        </a>
      ) : (
        <span className="min-w-0 break-words text-sm text-[var(--color-pib-text)]">{value}</span>
      )}
    </div>
  )
}

function ProfileCaptureAction({
  title,
  body,
  icon,
  actionLabel,
  onEditCompany,
}: {
  title: string
  body: string
  icon: string
  actionLabel: string
  onEditCompany?: () => void
}) {
  return (
    <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] p-4">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="material-symbols-outlined mt-0.5 text-[18px] text-[var(--color-accent-v2)]">{icon}</span>
        <div className="min-w-0">
          <h3 className="font-display text-lg text-[var(--color-pib-text)]">{title}</h3>
          <p className="mt-1 text-sm leading-6 text-[var(--color-pib-text-muted)]">{body}</p>
          {onEditCompany ? (
            <button
              type="button"
              onClick={onEditCompany}
              aria-label={actionLabel}
              className="btn-pib-secondary mt-4 inline-flex items-center gap-1.5 text-xs"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[14px]">edit</span>
              Open profile editor
            </button>
          ) : (
            <p className="mt-3 text-xs text-[var(--color-pib-text-muted)]">Open profile editing to capture this next.</p>
          )}
        </div>
      </div>
    </div>
  )
}

function WidgetCard({
  label,
  value,
  icon,
  color,
  hint,
  onClick,
}: {
  label: string
  value: string | number
  icon: string
  color: string
  hint?: string
  onClick?: () => void
}) {
  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="eyebrow !text-[10px]">{label}</p>
        <span aria-hidden="true" className="material-symbols-outlined text-[18px]" style={{ color }}>
          {icon}
        </span>
      </div>
      <p className="mt-3 text-3xl font-semibold leading-none text-[var(--color-pib-text)]">{value}</p>
      {hint ? <p className="mt-3 truncate text-xs text-[var(--color-pib-text-muted)]">{hint}</p> : null}
    </>
  )

  const className = 'pib-stat-card min-h-[124px] text-left transition-colors hover:border-[var(--color-pib-accent)] hover:bg-white/[0.03]'
  if (onClick) {
    return (
      <button type="button" className={className} onClick={onClick}>
        {content}
      </button>
    )
  }
  return <div className={className}>{content}</div>
}

function MiniStatus({
  label,
  value,
  tone,
  icon,
}: {
  label: string
  value: string | number
  tone: 'neutral' | 'good' | 'warn' | 'danger'
  icon: string
}) {
  const toneClasses = {
    neutral: 'border-white/10 bg-white/[0.03] text-[var(--color-pib-text-muted)]',
    good: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
    warn: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
    danger: 'border-red-400/30 bg-red-400/10 text-red-200',
  }
  return (
    <div className={`rounded-lg border px-3 py-2 ${toneClasses[tone]}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-label uppercase tracking-wide">{label}</span>
        <span aria-hidden="true" className="material-symbols-outlined text-[16px]">{icon}</span>
      </div>
      <p className="mt-2 text-xl font-semibold leading-none">{value}</p>
    </div>
  )
}

type AccountRiskItem = {
  key: string
  label: string
  detail: string
  icon: string
  tone: 'danger' | 'warn'
  actionLabel: string
  onAction?: () => void
}

function pluralLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`
}

function AccountRiskBrief({
  companyName,
  items,
}: {
  companyName: string
  items: AccountRiskItem[]
}) {
  if (items.length === 0) return null

  const toneClasses = {
    danger: 'border-red-400/30 bg-red-500/10 text-red-100',
    warn: 'border-amber-400/30 bg-amber-400/10 text-amber-100',
  }

  return (
    <section className="bento-card p-5" role="region" aria-label="Account risk brief">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="eyebrow !text-[10px]">Leadership brief</p>
          <h2 className="mt-1 font-display text-xl text-[var(--color-pib-text)]">Account risk brief</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-pib-text-muted)]">
            {items.length} account {items.length === 1 ? 'risk needs' : 'risks need'} leadership attention before {companyName} is board-ready.
          </p>
        </div>
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-red-400/25 bg-red-500/10 px-3 py-1 text-xs font-medium text-red-100">
          <span aria-hidden="true" className="material-symbols-outlined text-[14px]">crisis_alert</span>
          {items.length} active
        </span>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {items.map((item) => (
          <div key={item.key} className={`flex min-h-[150px] flex-col justify-between rounded-lg border p-4 ${toneClasses[item.tone]}`}>
            <div>
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-sm font-semibold">{item.label}</h3>
                <span aria-hidden="true" className="material-symbols-outlined text-[18px]">{item.icon}</span>
              </div>
              <p className="mt-2 text-xs leading-5 opacity-85">{item.detail}</p>
            </div>
            {item.onAction ? (
              <button
                type="button"
                onClick={item.onAction}
                aria-label={item.actionLabel}
                className="mt-4 inline-flex w-fit items-center gap-1.5 rounded-md border border-current/20 bg-black/10 px-2.5 py-1.5 text-xs font-semibold transition-colors hover:bg-black/20"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[14px]">arrow_forward</span>
                Fix now
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  )
}

function BusinessProfile({ company, onEditCompany }: { company: Company; onEditCompany?: () => void }) {
  const addr = company.address
  const social = company.socialProfiles
  const customFields = company.customFields ? Object.entries(company.customFields) : []
  const hasAddress = addr && (addr.street || addr.city || addr.country)
  const hasSocial = social && (social.linkedin || social.twitter || social.facebook || social.instagram)
  const billingAddress = company.billingAddress
  const hasBillingAddress = billingAddress && (billingAddress.line1 || billingAddress.line2 || billingAddress.city || billingAddress.state || billingAddress.postalCode || billingAddress.country)
  const parentCompanyLabel = company.parentCompanyName?.trim() || 'parent company'

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <SectionCard title="Identity">
        <Field label="Legal name" value={company.legalName} />
        <Field label="Trading name" value={company.tradingName} />
        <Field label="Lifecycle" value={company.lifecycleStage} />
        <Field label="Tier" value={company.tier} />
        <Field label="Industry" value={company.industry} />
        <Field label="Size" value={company.size} />
        <Field label="Employees" value={company.employeeCount} />
        <Field label="Annual revenue" value={company.annualRevenue ? formatCurrency(company.annualRevenue, company.currency || 'ZAR') : null} />
        <Field label="Website" value={company.website} href={externalHref(company.website)} external />
        {!company.legalName && !company.tradingName && !company.lifecycleStage && !company.tier && !company.industry && !company.size && !company.employeeCount && !company.annualRevenue && !company.website && (
          <ProfileCaptureAction
            title="Capture account identity."
            body="Add legal name, trading name, lifecycle stage, industry, size, and website so the account is useful in reviews."
            icon="badge"
            actionLabel={`Edit account identity for ${company.name}`}
            onEditCompany={onEditCompany}
          />
        )}
      </SectionCard>

      <SectionCard title="Billing & Contacts">
        <Field label="Phone" value={company.phone} href={company.phone ? `tel:${company.phone}` : undefined} />
        <Field label="Billing email" value={company.billingEmail} href={company.billingEmail ? `mailto:${company.billingEmail}` : undefined} />
        <Field label="Registration" value={company.registrationNumber} />
        <Field label="VAT" value={company.vatNumber} />
        <Field label="Tax number" value={company.taxNumber} />
        <Field label="Accounts" value={company.accountsContact?.name} />
        <Field label="Accounts email" value={company.accountsContact?.email} href={company.accountsContact?.email ? `mailto:${company.accountsContact.email}` : undefined} />
        <Field label="Accounts phone" value={company.accountsContact?.phone} href={company.accountsContact?.phone ? `tel:${company.accountsContact.phone}` : undefined} />
        <Field label="Signatory" value={company.authorizedSignatory?.name} />
        <Field label="PO required" value={company.purchaseOrderRequired ? 'Yes' : null} />
        <Field label="PO number" value={company.purchaseOrderNumber} />
        <Field label="Invoice notes" value={company.invoiceInstructions} />
        {!company.phone && !company.billingEmail && !company.registrationNumber && !company.vatNumber && !company.taxNumber && !company.accountsContact?.name && !company.authorizedSignatory?.name && !company.purchaseOrderRequired && !company.purchaseOrderNumber && !company.invoiceInstructions && (
          <ProfileCaptureAction
            title="Capture billing and contact detail."
            body="Add phone, billing email, registration, VAT, accounts contact, signatory, and invoice notes before proposals become admin work."
            icon="receipt_long"
            actionLabel={`Edit billing and contact details for ${company.name}`}
            onEditCompany={onEditCompany}
          />
        )}
      </SectionCard>

      {hasAddress || hasBillingAddress ? (
        <SectionCard title="Addresses">
          {addr?.street && <Field label="Street" value={addr.street} />}
          {addr?.city && <Field label="City" value={addr.city} />}
          {addr?.state && <Field label="State" value={addr.state} />}
          {addr?.country && <Field label="Country" value={addr.country} />}
          {addr?.postalCode && <Field label="Postal code" value={addr.postalCode} />}
          {company.billingAddress?.line1 && <Field label="Billing line 1" value={company.billingAddress.line1} />}
          {company.billingAddress?.line2 && <Field label="Billing line 2" value={company.billingAddress.line2} />}
          {company.billingAddress?.city && <Field label="Billing city" value={company.billingAddress.city} />}
          {company.billingAddress?.country && <Field label="Billing country" value={company.billingAddress.country} />}
        </SectionCard>
      ) : null}

      {hasSocial || customFields.length > 0 || company.parentCompanyId ? (
        <SectionCard title="Signals">
          {social?.linkedin && <SocialLink label="LinkedIn" href={social.linkedin} />}
          {social?.twitter && <SocialLink label="X / Twitter" href={social.twitter} />}
          {social?.facebook && <SocialLink label="Facebook" href={social.facebook} />}
          {social?.instagram && <SocialLink label="Instagram" href={social.instagram} />}
          {company.parentCompanyId && (
            <Link
              href={`/portal/companies/${company.parentCompanyId}`}
              className="inline-flex max-w-full items-center gap-2 rounded-md border border-[var(--color-pib-line)] bg-white/[0.03] px-2.5 py-1.5 text-sm text-[var(--color-accent-v2)] transition-colors hover:border-[var(--color-accent-v2)]/50 hover:bg-white/[0.06]"
              aria-label={`Open ${parentCompanyLabel}`}
              title={`Open ${parentCompanyLabel}`}
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[16px]">domain</span>
              <span className="truncate">Open {parentCompanyLabel}</span>
            </Link>
          )}
          {customFields.map(([key, val]) => (
            <Field key={key} label={key} value={String(val)} />
          ))}
        </SectionCard>
      ) : null}
    </div>
  )
}

function SocialLink({ label, href }: { label: string; href: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 py-1 text-sm text-[var(--color-accent-v2)] hover:underline">
      <span aria-hidden="true" className="material-symbols-outlined text-[16px]">link</span>
      {label}
    </a>
  )
}

export function CompanyOverviewPanel({ company, center, loading, onSelectTab, onEditCompany }: CompanyOverviewPanelProps) {
  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-28" />)}
        </div>
        <Skeleton className="h-72 w-full" />
      </div>
    )
  }

  const counts = buildCounts(center)
  const totalLinkedRecords = WIDGETS.reduce((sum, item) => sum + counts[item.key], 0)
  const completedChecks = PROFILE_CHECKS.filter((check) => check.done(company, counts))
  const profileScore = company.healthScore ?? Math.round((completedChecks.length / PROFILE_CHECKS.length) * 100)
  const openWork = numberValue(center?.analytics?.openProjectCount) + numberValue(center?.analytics?.activeServiceCount)
  const dealTotal = sumRows(rowList(center, 'deals'), ['value', 'amount', 'total'])
  const quoteTotal = sumRows(rowList(center, 'quotes'), ['total', 'value', 'amount'])
  const invoiceTotal = sumRows(rowList(center, 'invoices'), ['total', 'value', 'amount'])
  const orderTotal = sumRows(rowList(center, 'orders'), ['total', 'value', 'amount'])
  const accountValue = center?.analytics?.accountValue ?? dealTotal + orderTotal
  const weightedPipelineValue = center?.analytics?.weightedPipelineValue ?? dealTotal
  const trackedOrderValue = center?.analytics?.trackedOrderValue ?? orderTotal
  const currency = company.currency || 'ZAR'
  const riskSignals = center?.analytics?.riskSignals ?? []
  const movement = latestMovement(center)
  const accountContext = [
    readableAccountLabel(company.lifecycleStage),
    readableAccountLabel(company.tier),
    company.industry,
    company.domain,
  ].filter(Boolean).join(' · ')

  const pulseChartData = [
    { value: Math.max(profileScore, 1) },
    { value: Math.max(counts.contacts, 1) },
    { value: Math.max(counts.deals, 1) },
    { value: Math.max(counts.projects + counts.documents, 1) },
  ]

  const mixData = WIDGETS
    .map((item) => ({
      label: item.label,
      value: counts[item.key],
      color: item.color,
    }))
    .filter((item) => item.value > 0)

  const revenueData = [
    { label: 'Deals', value: dealTotal },
    { label: 'Weighted', value: weightedPipelineValue },
    { label: 'Orders', value: trackedOrderValue },
    { label: 'Quotes', value: quoteTotal },
    { label: 'Invoices', value: invoiceTotal },
  ]
  const hasRevenueData = revenueData.some((item) => item.value > 0)

  const riskDonut = [
    { name: 'Open orders', value: counts.openOrders, color: '#f59e0b' },
    { name: 'Low stock', value: counts.lowStockItems, color: '#ef4444' },
    { name: 'Overdue invoices', value: counts.overdueInvoices, color: '#f87171' },
    { name: 'Open projects', value: numberValue(center?.analytics?.openProjectCount), color: '#60a5fa' },
    { name: 'Active services', value: numberValue(center?.analytics?.activeServiceCount), color: '#22d3ee' },
  ].filter((item) => item.value > 0)

  const setupFocus = PROFILE_CHECKS.filter((check) => !check.done(company, counts)).slice(0, 4)
  const missingAccountOwner = !company.accountManagerRef?.displayName && !company.accountManagerUid
  const hasPipeline = weightedPipelineValue > 0 || counts.deals > 0
  const accountRiskItems: AccountRiskItem[] = [
    ...(missingAccountOwner
      ? [{
          key: 'owner',
          label: 'No account owner',
          detail: 'Assign one accountable manager so escalations, renewals, and delivery handoffs do not drift.',
          icon: 'assignment_ind',
          tone: 'danger' as const,
          actionLabel: `Assign account owner for ${company.name} from account risk brief`,
          onAction: onEditCompany,
        }]
      : []),
    ...(profileScore < 70
      ? [{
          key: 'profile',
          label: 'Profile below 70%',
          detail: 'Complete the account profile before leadership relies on this record for planning.',
          icon: 'fact_check',
          tone: 'warn' as const,
          actionLabel: `Improve profile completeness for ${company.name} from account risk brief`,
          onAction: onEditCompany,
        }]
      : []),
    ...(counts.contacts === 0
      ? [{
          key: 'contacts',
          label: 'No stakeholders linked',
          detail: 'Add buyers, approvers, finance owners, and delivery contacts so the team knows who to engage.',
          icon: 'groups',
          tone: 'danger' as const,
          actionLabel: `Review stakeholders for ${company.name} from account risk brief`,
          onAction: onSelectTab ? () => onSelectTab('contacts') : undefined,
        }]
      : []),
    ...(!hasPipeline
      ? [{
          key: 'pipeline',
          label: 'No active pipeline',
          detail: 'Review or create opportunity records so forecast, quote readiness, and growth value are visible.',
          icon: 'query_stats',
          tone: 'warn' as const,
          actionLabel: `Review pipeline for ${company.name} from account risk brief`,
          onAction: onSelectTab ? () => onSelectTab('deals') : undefined,
        }]
      : []),
    ...(counts.overdueInvoices > 0
      ? [{
          key: 'overdue-invoices',
          label: pluralLabel(counts.overdueInvoices, 'overdue invoice', 'overdue invoices'),
          detail: 'Clear finance risk before account reviews turn into cash-collection surprises.',
          icon: 'receipt_long',
          tone: 'danger' as const,
          actionLabel: `Review overdue invoices for ${company.name} from account risk brief`,
          onAction: onSelectTab ? () => onSelectTab('invoices') : undefined,
        }]
      : []),
    ...(counts.openOrders > 0
      ? [{
          key: 'open-orders',
          label: pluralLabel(counts.openOrders, 'open order', 'open orders'),
          detail: 'Check fulfillment so delivery blockers are visible before the client chases the team.',
          icon: 'orders',
          tone: 'warn' as const,
          actionLabel: `Review fulfillment orders for ${company.name} from account risk brief`,
          onAction: onSelectTab ? () => onSelectTab('orders') : undefined,
        }]
      : []),
    ...(counts.lowStockItems > 0
      ? [{
          key: 'low-stock',
          label: pluralLabel(counts.lowStockItems, 'low-stock item', 'low-stock items'),
          detail: 'Review inventory coverage before service delivery depends on stock or capacity that is not there.',
          icon: 'inventory_2',
          tone: 'danger' as const,
          actionLabel: `Review inventory risk for ${company.name} from account risk brief`,
          onAction: onSelectTab ? () => onSelectTab('inventory') : undefined,
        }]
      : []),
  ]

  return (
    <div className="space-y-6">
      <section className="bento-card overflow-hidden p-0">
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.6fr)]">
          <div className="space-y-5 p-5 md:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="eyebrow !text-[10px]">Business pulse</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--color-pib-text)]">
                  {company.name}
                </h2>
                <p className="mt-2 max-w-2xl text-sm text-[var(--color-pib-text-muted)]">
                  {accountContext || 'Command center'}
                </p>
              </div>
              <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] px-4 py-3 text-right">
                <p className="eyebrow !text-[10px]">Profile strength</p>
                <p className="mt-1 text-3xl font-semibold text-[var(--color-pib-accent)]">{profileScore}%</p>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <StatCardWithChart
                label="Account value"
                value={formatCurrency(accountValue, currency)}
                sub="deals + orders"
                data={pulseChartData}
                chartType="area"
                accent
              />
              <StatCardWithChart
                label="Weighted pipeline"
                value={formatCurrency(weightedPipelineValue, currency)}
                sub={`${counts.deals} deal${counts.deals === 1 ? '' : 's'}`}
                data={rowList(center, 'deals').slice(0, 8).map((deal) => ({ value: numberValue(deal.value) }))}
              />
              <StatCardWithChart
                label="Open work"
                value={openWork}
                sub={`${counts.projects} projects · ${counts.serviceWorkspaces} services`}
                accent={openWork > 0}
              />
              <StatCardWithChart
                label="Linked records"
                value={totalLinkedRecords}
                sub="across CRM, delivery, finance"
              />
            </div>
          </div>

          <div className="border-t border-[var(--color-pib-line)] bg-white/[0.02] p-5 lg:border-l lg:border-t-0">
            <p className="eyebrow !text-[10px]">Operational pulse</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <MiniStatus label="Open orders" value={counts.openOrders} icon="orders" tone={counts.openOrders > 0 ? 'warn' : 'neutral'} />
              <MiniStatus label="Overdue invoices" value={counts.overdueInvoices} icon="warning" tone={counts.overdueInvoices > 0 ? 'danger' : 'good'} />
              <MiniStatus label="Low stock" value={counts.lowStockItems} icon="inventory" tone={counts.lowStockItems > 0 ? 'danger' : 'good'} />
              <MiniStatus label="Collaborations" value={numberValue(center?.analytics?.collaborationCount)} icon="hub" tone={numberValue(center?.analytics?.collaborationCount) > 0 ? 'good' : 'neutral'} />
            </div>
            {riskSignals.length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {riskSignals.map((signal) => (
                  <span key={signal} className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-xs text-amber-200">
                    {signal}
                  </span>
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-3">
                <p className="eyebrow !text-[10px] text-emerald-200">Risk watch clear</p>
                <h3 className="mt-1 text-sm font-semibold text-[var(--color-pib-text)]">Keep pulse risk reviewable</h3>
                <p className="mt-1 text-xs leading-5 text-[var(--color-pib-text-muted)]">
                  No active risk signals are flagged in the account pulse. Review invoices so finance, delivery, and operations stay checked before leadership sees surprises.
                </p>
                {onSelectTab ? (
                  <button
                    type="button"
                    onClick={() => onSelectTab('invoices')}
                    aria-label={`Review operational risk for ${company.name}`}
                    className="btn-pib-secondary mt-3 inline-flex items-center gap-1.5 text-xs"
                  >
                    <span aria-hidden="true" className="material-symbols-outlined text-[14px]">receipt_long</span>
                    Review invoices
                  </button>
                ) : (
                  <p className="mt-2 text-xs text-[var(--color-pib-text-muted)]">Open Invoices to keep the account pulse reviewed.</p>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      <AccountRiskBrief companyName={company.name} items={accountRiskItems} />

      <section>
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="eyebrow">Command widgets</h2>
          <span className="text-xs text-[var(--color-pib-text-muted)]">{totalLinkedRecords} linked records</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {WIDGETS.map((item) => (
            <WidgetCard
              key={item.key}
              label={item.label}
              value={counts[item.key]}
              icon={item.icon}
              color={item.color}
              hint={counts[item.key] > 0 ? 'Open tab' : 'No records yet'}
              onClick={onSelectTab ? () => onSelectTab(item.tab) : undefined}
            />
          ))}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.7fr)]">
        <SectionCard title="Revenue mix">
          {hasRevenueData ? (
            <RevenueBarChart data={revenueData} valueFormatter={(value) => formatCurrency(value, currency)} height={260} />
          ) : (
            <div className="flex min-h-[220px] items-center justify-center rounded-lg border border-dashed border-[var(--color-pib-line)] bg-white/[0.02] p-6 text-center">
              <div className="max-w-md">
                <p className="eyebrow !text-[10px] text-amber-200">Revenue model missing</p>
                <h3 className="mt-2 font-display text-lg text-[var(--color-pib-text)]">Build the first commercial signal</h3>
                <p className="mt-2 text-sm leading-6 text-[var(--color-pib-text-muted)]">
                  No deals, quotes, invoices, or orders are linked to this account yet. Review deals so pipeline value, quote readiness, and revenue history become visible to leadership.
                </p>
                {onSelectTab ? (
                  <button
                    type="button"
                    onClick={() => onSelectTab('deals')}
                    aria-label={`Review commercial records for ${company.name}`}
                    className="btn-pib-secondary mt-4 inline-flex items-center gap-1.5 text-xs"
                  >
                    <span aria-hidden="true" className="material-symbols-outlined text-[14px]">monetization_on</span>
                    Review deals
                  </button>
                ) : (
                  <p className="mt-3 text-xs text-[var(--color-pib-text-muted)]">Open Deals to capture the first commercial record.</p>
                )}
              </div>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Business mix">
          {mixData.length > 0 ? (
            <HorizontalBarChart data={mixData} height={260} />
          ) : (
            <div className="flex min-h-[220px] items-center justify-center rounded-lg border border-dashed border-[var(--color-pib-line)] bg-white/[0.02] p-6 text-center">
              <div className="max-w-md">
                <p className="eyebrow !text-[10px] text-amber-200">Operating footprint missing</p>
                <h3 className="mt-2 font-display text-lg text-[var(--color-pib-text)]">Link the first account record</h3>
                <p className="mt-2 text-sm leading-6 text-[var(--color-pib-text-muted)]">
                  No contacts, deals, delivery work, documents, finance, or commerce records are linked yet. Start with contacts so every team can see who owns the relationship.
                </p>
                {onSelectTab ? (
                  <button
                    type="button"
                    onClick={() => onSelectTab('contacts')}
                    aria-label={`Review linked contacts for ${company.name}`}
                    className="btn-pib-secondary mt-4 inline-flex items-center gap-1.5 text-xs"
                  >
                    <span aria-hidden="true" className="material-symbols-outlined text-[14px]">groups</span>
                    Review contacts
                  </button>
                ) : (
                  <p className="mt-3 text-xs text-[var(--color-pib-text-muted)]">Open Contacts to link the first relationship record.</p>
                )}
              </div>
            </div>
          )}
        </SectionCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(360px,0.7fr)_minmax(0,1fr)]">
        <SectionCard title="Risk map">
          {riskDonut.length > 0 ? (
            <DonutChart data={riskDonut} centerValue={riskDonut.reduce((sum, item) => sum + item.value, 0)} centerLabel="Signals" />
          ) : (
            <div className="flex min-h-[220px] items-center justify-center rounded-lg border border-dashed border-[var(--color-pib-line)] bg-white/[0.02] p-6 text-center">
              <div className="max-w-md">
                <p className="eyebrow !text-[10px] text-emerald-200">Risk coverage clear</p>
                <h3 className="mt-2 font-display text-lg text-[var(--color-pib-text)]">Keep account risk monitored</h3>
                <p className="mt-2 text-sm leading-6 text-[var(--color-pib-text-muted)]">
                  No overdue invoices, low stock, open orders, projects, or service risks are active right now. Review invoices so finance risk stays visible before it surprises leadership.
                </p>
                {onSelectTab ? (
                  <button
                    type="button"
                    onClick={() => onSelectTab('invoices')}
                    aria-label={`Review risk records for ${company.name}`}
                    className="btn-pib-secondary mt-4 inline-flex items-center gap-1.5 text-xs"
                  >
                    <span aria-hidden="true" className="material-symbols-outlined text-[14px]">receipt_long</span>
                    Review invoices
                  </button>
                ) : (
                  <p className="mt-3 text-xs text-[var(--color-pib-text-muted)]">Open Invoices to keep finance risk visible.</p>
                )}
              </div>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Latest movement">
          {movement.length > 0 ? (
            <div className="divide-y divide-[var(--color-pib-line)]">
              {movement.map((item) => {
                const tone = statusTone(item.status)
                return (
                  <div key={item.id} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
                    <div className="flex min-w-0 items-start gap-3">
                      <span aria-hidden="true" className="material-symbols-outlined mt-0.5 text-[18px] text-[var(--color-pib-text-muted)]">
                        {item.icon}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-[var(--color-pib-text)]">{item.title}</p>
                        <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">{item.meta} · {formatDate(item.dateValue)}</p>
                      </div>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-label uppercase tracking-wide ${tone.className}`}>
                      {tone.label}
                    </span>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="flex min-h-[220px] items-center justify-center rounded-lg border border-dashed border-[var(--color-pib-line)] bg-white/[0.02] p-6 text-center">
              <div className="max-w-md">
                <p className="eyebrow !text-[10px] text-amber-200">Account history quiet</p>
                <h3 className="mt-2 font-display text-lg text-[var(--color-pib-text)]">Start the next account signal</h3>
                <p className="mt-2 text-sm leading-6 text-[var(--color-pib-text-muted)]">
                  No recent activity, deal movement, document, project, or order is visible yet. Review activity so leadership can see the next account touchpoint.
                </p>
                {onSelectTab ? (
                  <button
                    type="button"
                    onClick={() => onSelectTab('activity')}
                    aria-label={`Review activity for ${company.name}`}
                    className="btn-pib-secondary mt-4 inline-flex items-center gap-1.5 text-xs"
                  >
                    <span aria-hidden="true" className="material-symbols-outlined text-[14px]">history</span>
                    Review activity
                  </button>
                ) : (
                  <p className="mt-3 text-xs text-[var(--color-pib-text-muted)]">Open Activity to capture the next touchpoint.</p>
                )}
              </div>
            </div>
          )}
        </SectionCard>
      </div>

      {setupFocus.length > 0 && (
        <section>
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="eyebrow">Setup focus</h2>
            <span className="text-xs text-[var(--color-pib-text-muted)]">{completedChecks.length}/{PROFILE_CHECKS.length} complete</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {setupFocus.map((item) => (
              <div key={item.label} className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-[var(--color-pib-text)]">{item.label}</p>
                  <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-[var(--color-pib-text-muted)]">add_circle</span>
                </div>
                {onEditCompany ? (
                  <button
                    type="button"
                    onClick={onEditCompany}
                    aria-label={`Edit company profile to capture ${item.label}`}
                    className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-accent-v2)] hover:underline"
                  >
                    <span aria-hidden="true" className="material-symbols-outlined text-[14px]">edit</span>
                    Capture now
                  </button>
                ) : (
                  <p className="mt-2 text-xs text-[var(--color-pib-text-muted)]">Worth capturing next.</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <BusinessProfile company={company} onEditCompany={onEditCompany} />
    </div>
  )
}
