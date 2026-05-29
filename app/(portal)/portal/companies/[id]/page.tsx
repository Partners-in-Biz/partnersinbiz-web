'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import type { Company } from '@/lib/companies/types'
import type { CustomFieldDefinition } from '@/lib/customFields/types'
import { CompanyHeader } from '@/components/crm/CompanyHeader'
import { CompanyTabsBar } from '@/components/crm/CompanyTabsBar'
import type { CompanyTab } from '@/components/crm/CompanyTabsBar'
import { CompanyOverviewPanel } from '@/components/crm/CompanyOverviewPanel'
import { CompanyEditDrawer } from '@/components/crm/CompanyEditDrawer'
import { CustomFieldsSection } from '@/components/crm/CustomFieldsSection'
import { ContactForm } from '@/components/admin/crm/ContactForm'
import { DealDrawer } from '@/components/crm/DealDrawer'

type RelatedContact = {
  id: string
  name?: string
  email?: string
  phone?: string
  type?: string
  stage?: string
  updatedAt?: unknown
}

type RelatedDeal = {
  id: string
  title?: string
  contactId?: string
  value?: number
  currency?: string
  stageId?: string
  probability?: number
  updatedAt?: unknown
}

type RelatedProject = {
  id: string
  name?: string
  status?: string
  description?: string
  updatedAt?: unknown
}

type RelatedDocument = {
  id: string
  title?: string
  status?: string
  type?: string
  updatedAt?: unknown
}

type RelatedServiceWorkspace = {
  id: string
  name?: string
  serviceType?: string
  status?: string
  visibility?: string
  updatedAt?: unknown
}

type RelatedRelationship = {
  id: string
  targetName?: string
  relationshipType?: string
  status?: string
  sharedCapabilities?: string[]
  updatedAt?: unknown
}

type RelatedQuote = {
  id: string
  quoteNumber?: string
  status?: string
  total?: number
  currency?: string
  validUntil?: unknown
  updatedAt?: unknown
}

type RelatedInvoice = {
  id: string
  invoiceNumber?: string
  status?: string
  total?: number
  currency?: string
  dueDate?: unknown
  publicToken?: string
  updatedAt?: unknown
}

type RelatedOrder = {
  id: string
  title?: string
  status?: string
  fulfillmentStatus?: string
  total?: number
  currency?: string
  updatedAt?: unknown
}

type RelatedShipment = {
  id: string
  status?: string
  carrier?: string
  trackingNumber?: string
  expectedDeliveryDate?: unknown
  updatedAt?: unknown
}

type RelatedInventoryItem = {
  id: string
  name?: string
  sku?: string
  status?: string
  quantityAvailable?: number
  lowStockThreshold?: number
  updatedAt?: unknown
}

type RelatedActivity = {
  id: string
  type?: string
  summary?: string
  createdAt?: unknown
}

type CommandCenterSummary = {
  projects?: number
  serviceWorkspaces?: number
  relationships?: number
  orders?: number
  shipments?: number
  inventoryItems?: number
  openOrders?: number
  lowStockItems?: number
  overdueInvoices?: number
}

type CommandCenterAnalytics = {
  accountValue?: number
  weightedPipelineValue?: number
  trackedOrderValue?: number
  openProjectCount?: number
  activeServiceCount?: number
  collaborationCount?: number
  riskSignals?: string[]
}

type RelatedState = {
  contacts: RelatedContact[]
  deals: RelatedDeal[]
  projects: RelatedProject[]
  documents: RelatedDocument[]
  serviceWorkspaces: RelatedServiceWorkspace[]
  relationships: RelatedRelationship[]
  quotes: RelatedQuote[]
  invoices: RelatedInvoice[]
  orders: RelatedOrder[]
  shipments: RelatedShipment[]
  inventoryItems: RelatedInventoryItem[]
  activities: RelatedActivity[]
  summary: CommandCenterSummary
  analytics: CommandCenterAnalytics
}

// ── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

function PageSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-6 w-24" />
      <div className="flex items-start gap-4">
        <Skeleton className="h-16 w-16 rounded-2xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-5 w-40" />
        </div>
      </div>
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  )
}

function EmptyPanel({ icon, label, children }: { icon: string; label: string; children?: React.ReactNode }) {
  return (
    <div className="bento-card p-10 text-center">
      <span className="material-symbols-outlined text-4xl text-[var(--color-pib-text-muted)]">{icon}</span>
      <p className="text-sm text-[var(--color-pib-text-muted)] mt-3">
        {label}
      </p>
      {children ? <div className="mt-5 flex justify-center">{children}</div> : null}
    </div>
  )
}

function TableShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="bento-card overflow-hidden">
      <div className="overflow-x-auto">
        {children}
      </div>
    </div>
  )
}

function StatusChip({ value }: { value?: string }) {
  if (!value) return <span className="text-[var(--color-pib-text-muted)]">-</span>
  return (
    <span className="inline-flex rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-label uppercase tracking-wide text-emerald-300">
      {value.replace(/_/g, ' ')}
    </span>
  )
}

function formatCurrency(value?: number, currency = 'ZAR') {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-'
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value)
}

function formatDate(value: unknown) {
  if (!value) return '-'
  let date: Date | null = null
  if (value instanceof Date) date = value
  else if (typeof value === 'string') {
    const parsed = new Date(value)
    date = Number.isNaN(parsed.getTime()) ? null : parsed
  } else if (typeof value === 'object') {
    const timestamp = value as { toDate?: () => Date; seconds?: number; _seconds?: number }
    if (typeof timestamp.toDate === 'function') date = timestamp.toDate()
    else {
      const seconds = timestamp.seconds ?? timestamp._seconds
      if (typeof seconds === 'number') date = new Date(seconds * 1000)
    }
  }
  return date ? date.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'
}

function extractList<T>(body: unknown, key: keyof RelatedState): T[] {
  if (!body || typeof body !== 'object') return []
  const record = body as Record<string, unknown>
  const data = record.data && typeof record.data === 'object' ? record.data as Record<string, unknown> : {}
  const value = data[key] ?? record[key]
  return Array.isArray(value) ? value as T[] : []
}

function ContactsPanel({
  contacts,
  company,
  onCreateContact,
}: {
  contacts: RelatedContact[]
  company: Company
  onCreateContact: () => void
}) {
  if (contacts.length === 0) {
    return (
      <EmptyPanel
        icon="person_add"
        label="No linked contacts yet. Add the first stakeholder so emails, deals, quotes, and activity have a real relationship anchor."
      >
        <button type="button" onClick={onCreateContact} className="btn-pib-primary inline-flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[16px]" aria-hidden="true">person_add</span>
          Add first contact for {company.name}
        </button>
      </EmptyPanel>
    )
  }
  return (
    <TableShell>
      <table className="w-full text-sm">
        <thead className="border-b border-[var(--color-pib-line)] text-[10px] font-label uppercase tracking-wider text-[var(--color-pib-text-muted)]">
          <tr>
            <th className="px-5 py-3 text-left">Name</th>
            <th className="px-5 py-3 text-left">Email</th>
            <th className="px-5 py-3 text-left">Type</th>
            <th className="px-5 py-3 text-left">Stage</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-pib-line)]">
          {contacts.map((contact) => (
            <tr key={contact.id} className="hover:bg-white/[0.02]">
              <td className="px-5 py-4">
                <Link href={`/portal/contacts/${contact.id}`} className="font-medium text-[var(--color-accent-v2)] hover:underline">
                  {contact.name || contact.email || contact.id}
                </Link>
              </td>
              <td className="px-5 py-4 text-[var(--color-pib-text-muted)]">{contact.email || '-'}</td>
              <td className="px-5 py-4"><StatusChip value={contact.type} /></td>
              <td className="px-5 py-4"><StatusChip value={contact.stage} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableShell>
  )
}

function contactLabel(contact: RelatedContact) {
  return contact.name || contact.email || contact.id
}

function DealsPanel({
  deals,
  company,
  contacts,
  onCreateDeal,
  onCreateContact,
}: {
  deals: RelatedDeal[]
  company: Company
  contacts: RelatedContact[]
  onCreateDeal: () => void
  onCreateContact: () => void
}) {
  if (deals.length === 0) {
    const firstContact = contacts[0]
    return (
      <EmptyPanel
        icon="work_off"
        label={
          firstContact
            ? `No linked deals yet. Start the first opportunity against ${contactLabel(firstContact)} so pipeline, forecast, quotes, and activity stay anchored to this account.`
            : 'No linked deals yet. Add a stakeholder first so the first opportunity has a contact anchor.'
        }
      >
        {firstContact ? (
          <button type="button" onClick={onCreateDeal} className="btn-pib-primary inline-flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">add_business</span>
            Create first deal for {company.name}
          </button>
        ) : (
          <button type="button" onClick={onCreateContact} className="btn-pib-secondary inline-flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">person_add</span>
            Add contact before deal
          </button>
        )}
      </EmptyPanel>
    )
  }
  return (
    <TableShell>
      <table className="w-full text-sm">
        <thead className="border-b border-[var(--color-pib-line)] text-[10px] font-label uppercase tracking-wider text-[var(--color-pib-text-muted)]">
          <tr>
            <th className="px-5 py-3 text-left">Deal</th>
            <th className="px-5 py-3 text-left">Value</th>
            <th className="px-5 py-3 text-left">Stage</th>
            <th className="px-5 py-3 text-left">Probability</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-pib-line)]">
          {deals.map((deal) => (
            <tr key={deal.id} className="hover:bg-white/[0.02]">
              <td className="px-5 py-4">
                <Link href={`/portal/deals/${deal.id}`} className="font-medium text-[var(--color-accent-v2)] hover:underline">
                  {deal.title || deal.id}
                </Link>
              </td>
              <td className="px-5 py-4">{formatCurrency(deal.value, deal.currency || 'ZAR')}</td>
              <td className="px-5 py-4"><StatusChip value={deal.stageId} /></td>
              <td className="px-5 py-4 text-[var(--color-pib-text-muted)]">{typeof deal.probability === 'number' ? `${deal.probability}%` : '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableShell>
  )
}

function dealLabel(deal: RelatedDeal) {
  return deal.title || deal.id
}

function numericDealValue(deal: RelatedDeal) {
  return typeof deal.value === 'number' && Number.isFinite(deal.value) ? deal.value : 0
}

function QuotesPanel({
  quotes,
  company,
  deals,
  creatingQuote,
  quoteError,
  onCreateQuote,
  onCreateDeal,
}: {
  quotes: RelatedQuote[]
  company: Company
  deals: RelatedDeal[]
  creatingQuote: boolean
  quoteError: string | null
  onCreateQuote: () => void
  onCreateDeal: () => void
}) {
  if (quotes.length === 0) {
    const firstDeal = deals[0]
    return (
      <EmptyPanel
        icon="request_quote"
        label={
          firstDeal
            ? `No linked quotes yet. Turn ${dealLabel(firstDeal)} into the first commercial proposal for ${company.name}.`
            : 'No linked quotes yet. Create a deal first so pricing, forecast, and quote history stay connected.'
        }
      >
        <div className="flex flex-col items-center gap-3">
          {firstDeal ? (
            <button
              type="button"
              onClick={onCreateQuote}
              disabled={creatingQuote}
              className="btn-pib-primary inline-flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="material-symbols-outlined text-[16px]" aria-hidden="true">request_quote</span>
              {creatingQuote ? 'Creating quote...' : `Create quote from ${dealLabel(firstDeal)}`}
            </button>
          ) : (
            <button type="button" onClick={onCreateDeal} className="btn-pib-secondary inline-flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px]" aria-hidden="true">add_business</span>
              Create deal before quote
            </button>
          )}
          {quoteError ? <p className="max-w-md text-xs text-red-300">{quoteError}</p> : null}
        </div>
      </EmptyPanel>
    )
  }
  return (
    <TableShell>
      <table className="w-full text-sm">
        <thead className="border-b border-[var(--color-pib-line)] text-[10px] font-label uppercase tracking-wider text-[var(--color-pib-text-muted)]">
          <tr>
            <th className="px-5 py-3 text-left">Quote</th>
            <th className="px-5 py-3 text-left">Status</th>
            <th className="px-5 py-3 text-left">Total</th>
            <th className="px-5 py-3 text-left">Valid Until</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-pib-line)]">
          {quotes.map((quote) => (
            <tr key={quote.id} className="hover:bg-white/[0.02]">
              <td className="px-5 py-4 font-mono">{quote.quoteNumber || quote.id}</td>
              <td className="px-5 py-4"><StatusChip value={quote.status} /></td>
              <td className="px-5 py-4">{formatCurrency(quote.total, quote.currency || 'ZAR')}</td>
              <td className="px-5 py-4 text-[var(--color-pib-text-muted)]">{formatDate(quote.validUntil)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableShell>
  )
}

function InvoicesPanel({ invoices }: { invoices: RelatedInvoice[] }) {
  if (invoices.length === 0) return <EmptyPanel icon="receipt_long" label="No linked invoices yet." />
  return (
    <TableShell>
      <table className="w-full text-sm">
        <thead className="border-b border-[var(--color-pib-line)] text-[10px] font-label uppercase tracking-wider text-[var(--color-pib-text-muted)]">
          <tr>
            <th className="px-5 py-3 text-left">Invoice</th>
            <th className="px-5 py-3 text-left">Status</th>
            <th className="px-5 py-3 text-left">Total</th>
            <th className="px-5 py-3 text-left">Due</th>
            <th className="px-5 py-3 text-right">PDF</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-pib-line)]">
          {invoices.map((invoice) => (
            <tr key={invoice.id} className="hover:bg-white/[0.02]">
              <td className="px-5 py-4 font-mono">{invoice.invoiceNumber || invoice.id}</td>
              <td className="px-5 py-4"><StatusChip value={invoice.status} /></td>
              <td className="px-5 py-4">{formatCurrency(invoice.total, invoice.currency || 'ZAR')}</td>
              <td className="px-5 py-4 text-[var(--color-pib-text-muted)]">{formatDate(invoice.dueDate)}</td>
              <td className="px-5 py-4 text-right">
                <a href={`/api/v1/invoices/${invoice.id}/pdf`} target="_blank" rel="noopener noreferrer" className="text-[var(--color-accent-v2)] hover:underline">
                  Open
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableShell>
  )
}

function SimpleRowsPanel({
  rows,
  emptyIcon,
  emptyLabel,
  title,
  hrefFor,
  metaFor,
}: {
  rows: Array<{ id: string; [key: string]: unknown }>
  emptyIcon: string
  emptyLabel: string
  title: (row: { id: string; [key: string]: unknown }) => string
  hrefFor?: (row: { id: string; [key: string]: unknown }) => string | undefined
  metaFor: (row: { id: string; [key: string]: unknown }) => Array<string | undefined>
}) {
  if (rows.length === 0) return <EmptyPanel icon={emptyIcon} label={emptyLabel} />
  return (
    <div className="bento-card divide-y divide-[var(--color-pib-line)]">
      {rows.map((row) => {
        const rowTitle = title(row)
        const href = hrefFor?.(row)
        const meta = metaFor(row).filter(Boolean)
        return (
          <div key={row.id} className="px-5 py-4 flex items-start justify-between gap-4">
            <div className="min-w-0">
              {href ? (
                <Link href={href} className="font-medium text-sm text-[var(--color-accent-v2)] hover:underline">
                  {rowTitle}
                </Link>
              ) : (
                <p className="font-medium text-sm text-[var(--color-pib-text)]">{rowTitle}</p>
              )}
              {meta.length > 0 && (
                <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
                  {meta.join(' · ')}
                </p>
              )}
            </div>
            {'status' in row && typeof row.status === 'string' ? <StatusChip value={row.status} /> : null}
          </div>
        )
      })}
    </div>
  )
}

function AnalyticsPanel({ analytics, summary }: { analytics: CommandCenterAnalytics; summary: CommandCenterSummary }) {
  const tiles = [
    { label: 'Account value', value: formatCurrency(analytics.accountValue ?? 0), icon: 'payments' },
    { label: 'Weighted pipeline', value: formatCurrency(analytics.weightedPipelineValue ?? 0), icon: 'query_stats' },
    { label: 'Tracked orders', value: formatCurrency(analytics.trackedOrderValue ?? 0), icon: 'orders' },
    { label: 'Open projects', value: String(analytics.openProjectCount ?? summary.projects ?? 0), icon: 'folder_managed' },
    { label: 'Active services', value: String(analytics.activeServiceCount ?? summary.serviceWorkspaces ?? 0), icon: 'workspaces' },
    { label: 'Collaborations', value: String(analytics.collaborationCount ?? summary.relationships ?? 0), icon: 'hub' },
  ]
  const riskSignals = analytics.riskSignals ?? []
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {tiles.map((tile) => (
          <div key={tile.label} className="pib-stat-card">
            <div className="flex items-start justify-between gap-3">
              <p className="eyebrow !text-[10px]">{tile.label}</p>
              <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-[var(--color-pib-text-muted)]">{tile.icon}</span>
            </div>
            <p className="mt-3 text-2xl font-semibold text-[var(--color-pib-text)]">{tile.value}</p>
          </div>
        ))}
      </div>
      <div className="bento-card p-5">
        <p className="eyebrow !text-[10px]">Risk signals</p>
        {riskSignals.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--color-pib-text-muted)]">No active risk signals for this company.</p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            {riskSignals.map((signal) => (
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

function ActivityPanel({
  activities,
  company,
  contacts,
  noteOpen,
  note,
  savingNote,
  noteError,
  onOpenNote,
  onNoteChange,
  onSaveNote,
  onCancelNote,
  onCreateContact,
}: {
  activities: RelatedActivity[]
  company: Company
  contacts: RelatedContact[]
  noteOpen: boolean
  note: string
  savingNote: boolean
  noteError: string | null
  onOpenNote: () => void
  onNoteChange: (value: string) => void
  onSaveNote: () => void
  onCancelNote: () => void
  onCreateContact: () => void
}) {
  const firstContact = contacts[0]
  const composer = noteOpen && firstContact ? (
    <div className="bento-card p-5 text-left">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow !text-[10px]">Company note</p>
          <h3 className="mt-1 font-display text-lg text-[var(--color-pib-text)]">Log context for {company.name}</h3>
          <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
            Anchored to {contactLabel(firstContact)} so this note joins the contact and company timeline.
          </p>
        </div>
        <button
          type="button"
          onClick={onCancelNote}
          className="text-[var(--color-pib-text-muted)] transition-colors hover:text-[var(--color-pib-text)]"
          aria-label="Cancel note"
        >
          <span className="material-symbols-outlined text-[20px]">close</span>
        </button>
      </div>
      <div className="mt-4 space-y-3">
        <label htmlFor="company-activity-note" className="block text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">
          Company note
        </label>
        <textarea
          id="company-activity-note"
          value={note}
          onChange={(event) => onNoteChange(event.target.value)}
          rows={4}
          className="pib-input w-full resize-none"
          placeholder="Capture a decision, call summary, risk, or follow-up..."
        />
        {noteError ? <p className="text-xs text-red-300">{noteError}</p> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onCancelNote} disabled={savingNote} className="btn-pib-secondary">
            Cancel
          </button>
          <button
            type="button"
            onClick={onSaveNote}
            disabled={savingNote || !note.trim()}
            className="btn-pib-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            {savingNote ? 'Saving...' : 'Save note'}
          </button>
        </div>
      </div>
    </div>
  ) : null

  if (activities.length === 0) {
    if (composer) return composer
    return (
      <EmptyPanel
        icon="history"
        label={
          firstContact
            ? `No company activity yet. Log the first note against ${contactLabel(firstContact)} so the account timeline starts with real sales context.`
            : 'No company activity yet. Add a stakeholder first so notes, calls, and emails have a contact anchor.'
        }
      >
        {firstContact ? (
          <button type="button" onClick={onOpenNote} className="btn-pib-primary inline-flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">edit_note</span>
            Log first note for {company.name}
          </button>
        ) : (
          <button type="button" onClick={onCreateContact} className="btn-pib-secondary inline-flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">person_add</span>
            Add contact before activity
          </button>
        )}
      </EmptyPanel>
    )
  }
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button type="button" onClick={onOpenNote} className="btn-pib-secondary inline-flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[16px]" aria-hidden="true">edit_note</span>
          Log note
        </button>
      </div>
      {composer}
      <div className="bento-card divide-y divide-[var(--color-pib-line)]">
        {activities.map((activity) => (
          <div key={activity.id} className="px-5 py-4 flex items-start justify-between gap-4">
            <div>
              <p className="font-medium text-sm text-[var(--color-pib-text)]">{activity.summary || activity.type || 'Activity'}</p>
              {activity.type && <p className="text-xs text-[var(--color-pib-text-muted)] mt-1">{activity.type.replace(/_/g, ' ')}</p>}
            </div>
            <span className="text-xs text-[var(--color-pib-text-muted)] shrink-0">{formatDate(activity.createdAt)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()

  const [company, setCompany] = useState<Company | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const [tab, setTab] = useState<CompanyTab>('overview')
  const [editOpen, setEditOpen] = useState(false)
  const [newContactOpen, setNewContactOpen] = useState(false)
  const [newDealOpen, setNewDealOpen] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  const [companyNote, setCompanyNote] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [noteError, setNoteError] = useState<string | null>(null)
  const [creatingQuote, setCreatingQuote] = useState(false)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [customFieldDefs, setCustomFieldDefs] = useState<CustomFieldDefinition[]>([])
  const [related, setRelated] = useState<RelatedState>({
    contacts: [],
    deals: [],
    projects: [],
    documents: [],
    serviceWorkspaces: [],
    relationships: [],
    quotes: [],
    invoices: [],
    orders: [],
    shipments: [],
    inventoryItems: [],
    activities: [],
    summary: {},
    analytics: {},
  })
  const [relatedLoading, setRelatedLoading] = useState(false)
  const [relatedError, setRelatedError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/v1/crm/custom-fields?resource=company')
      .then((r) => r.json())
      .then((b) => setCustomFieldDefs(b.data?.definitions ?? b.definitions ?? []))
      .catch(() => setCustomFieldDefs([]))
  }, [])

  const fetchCompany = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/crm/companies/${id}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      const body = await res.json()
      setCompany(body.data?.company ?? body.data ?? body)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load company')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void fetchCompany()
  }, [fetchCompany])

  const loadRelated = useCallback(async (nextCompanyId: string, isCancelled: () => boolean = () => false) => {
      setRelatedLoading(true)
      setRelatedError(null)
      try {
        const commandCenterRes = await fetch(`/api/v1/crm/companies/${nextCompanyId}/command-center?limit=100`)
        if (!commandCenterRes.ok) {
          const body = await commandCenterRes.json().catch(() => ({}))
          throw new Error(body.error ?? `HTTP ${commandCenterRes.status}`)
        }
        const commandCenterBody = await commandCenterRes.json()
        if (!isCancelled()) {
          const commandData = commandCenterBody?.data ?? commandCenterBody ?? {}
          setRelated({
            contacts: extractList<RelatedContact>(commandCenterBody, 'contacts'),
            deals: extractList<RelatedDeal>(commandCenterBody, 'deals'),
            projects: extractList<RelatedProject>(commandCenterBody, 'projects'),
            documents: extractList<RelatedDocument>(commandCenterBody, 'documents'),
            serviceWorkspaces: extractList<RelatedServiceWorkspace>(commandCenterBody, 'serviceWorkspaces'),
            relationships: extractList<RelatedRelationship>(commandCenterBody, 'relationships'),
            quotes: extractList<RelatedQuote>(commandCenterBody, 'quotes'),
            invoices: extractList<RelatedInvoice>(commandCenterBody, 'invoices'),
            orders: extractList<RelatedOrder>(commandCenterBody, 'orders'),
            shipments: extractList<RelatedShipment>(commandCenterBody, 'shipments'),
            inventoryItems: extractList<RelatedInventoryItem>(commandCenterBody, 'inventoryItems'),
            activities: extractList<RelatedActivity>(commandCenterBody, 'activities'),
            summary: (commandData.summary ?? {}) as CommandCenterSummary,
            analytics: (commandData.analytics ?? {}) as CommandCenterAnalytics,
          })
        }
      } catch (err) {
        if (!isCancelled()) setRelatedError(err instanceof Error ? err.message : 'Failed to load linked records')
      } finally {
        if (!isCancelled()) setRelatedLoading(false)
      }
  }, [])

  const companyId = company?.id
  useEffect(() => {
    if (!companyId) return
    let cancelled = false
    void loadRelated(companyId, () => cancelled)
    return () => {
      cancelled = true
    }
  }, [companyId, loadRelated])

  async function handleSave(patch: Partial<Company>): Promise<void> {
    const res = await fetch(`/api/v1/crm/companies/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error ?? 'Save failed')
    }
    await fetchCompany()
  }

  async function createCompanyContact(data: Record<string, unknown>): Promise<void> {
    if (!company) return
    const res = await fetch('/api/v1/crm/contacts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...data,
        company: company.name,
        companyId: company.id,
        companyName: company.name,
      }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error ?? 'Failed to create contact')
    }
    setNewContactOpen(false)
    await loadRelated(company.id)
  }

  async function handleDealSaved(): Promise<void> {
    if (!company) return
    setNewDealOpen(false)
    await loadRelated(company.id)
  }

  async function saveCompanyNote(): Promise<void> {
    if (!company) return
    const firstContact = related.contacts[0]
    if (!firstContact) {
      setNoteError('Add a contact before logging activity.')
      return
    }
    const summary = companyNote.trim()
    if (!summary) return

    setSavingNote(true)
    setNoteError(null)
    try {
      const res = await fetch('/api/v1/crm/activities', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contactId: firstContact.id,
          companyId: company.id,
          type: 'note',
          summary,
          metadata: {
            source: 'company_detail',
            companyName: company.name,
            contactName: contactLabel(firstContact),
          },
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'Failed to log activity')
      }
      setCompanyNote('')
      setNoteOpen(false)
      await loadRelated(company.id)
    } catch (err) {
      setNoteError(err instanceof Error ? err.message : 'Failed to log activity')
    } finally {
      setSavingNote(false)
    }
  }

  async function createQuoteFromFirstDeal(): Promise<void> {
    if (!company) return
    const firstDeal = related.deals[0]
    if (!firstDeal) {
      setQuoteError('Create a deal before creating a quote.')
      return
    }
    setCreatingQuote(true)
    setQuoteError(null)
    try {
      const res = await fetch('/api/v1/quotes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          dealId: firstDeal.id,
          contactId: firstDeal.contactId || related.contacts[0]?.id,
          companyId: company.id,
          currency: firstDeal.currency || 'ZAR',
          lineItems: numericDealValue(firstDeal) > 0 ? [
            {
              description: dealLabel(firstDeal),
              quantity: 1,
              unitPrice: numericDealValue(firstDeal),
            },
          ] : undefined,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Failed to create quote')
      await loadRelated(company.id)
    } catch (err) {
      setQuoteError(err instanceof Error ? err.message : 'Failed to create quote')
    } finally {
      setCreatingQuote(false)
    }
  }

  async function handleDelete(): Promise<void> {
    if (!company) return
    const confirmed = window.confirm(`Archive ${company.name}? Linked contacts, deals, quotes, and activities will keep their history but no longer point at this company.`)
    if (!confirmed) return
    setDeleting(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/crm/companies/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      router.push('/portal/companies')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to archive company')
      setDeleting(false)
    }
  }

  // ── Loading / error states ──────────────────────────────────────────────────

  if (loading) return <PageSkeleton />

  if (error || !company) {
    return (
      <div className="bento-card p-10 text-center space-y-4">
        <span className="material-symbols-outlined text-4xl text-[var(--color-pib-text-muted)]">
          {error ? 'error_outline' : 'domain_disabled'}
        </span>
        <p className="text-sm text-[var(--color-pib-text-muted)]">
          {error ?? 'Company not found.'}
        </p>
        <Link href="/portal/companies" className="btn-pib-secondary inline-flex items-center gap-1.5 mt-2">
          <span className="material-symbols-outlined text-sm">arrow_back</span>
          Back to companies
        </Link>
      </div>
    )
  }

  // ── Main render ─────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Link
        href="/portal/companies"
        className="text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] inline-flex items-center gap-1 transition-colors"
      >
        <span className="material-symbols-outlined text-sm">arrow_back</span>
        Companies
      </Link>

      {/* Header */}
      <div className="bento-card p-5">
        <CompanyHeader
          company={company}
          onEdit={() => setEditOpen(true)}
          onDelete={handleDelete}
          deleting={deleting}
          stats={{
            contacts: related.contacts.length,
            deals: related.deals.length,
            projects: related.projects.length,
            documents: related.documents.length,
            activity: related.activities.length,
          }}
        />
      </div>

      {/* Tabs */}
      <CompanyTabsBar
        activeTab={tab}
        onChange={(t) => setTab(t as CompanyTab)}
        counts={{
          contacts: related.contacts.length,
          deals: related.deals.length,
          projects: related.projects.length,
          documents: related.documents.length,
          services: related.serviceWorkspaces.length,
          relationships: related.relationships.length,
          quotes: related.quotes.length,
          invoices: related.invoices.length,
          orders: related.orders.length,
          shipments: related.shipments.length,
          inventory: related.inventoryItems.length,
          activity: related.activities.length,
        }}
      />

      {/* Tab content */}
      <div role="tabpanel">
        {relatedError && tab !== 'overview' && (
          <div className="bento-card p-4 mb-4 text-sm text-red-300 border border-red-500/30">
            {relatedError}
          </div>
        )}
        {relatedLoading && tab !== 'overview' && <Skeleton className="h-36 w-full" />}
        {tab === 'overview' && (
          <div className="space-y-6">
            <CompanyOverviewPanel
              company={company}
              loading={relatedLoading}
              center={{
                contacts: related.contacts,
                deals: related.deals,
                projects: related.projects,
                documents: related.documents,
                serviceWorkspaces: related.serviceWorkspaces,
                relationships: related.relationships,
                quotes: related.quotes,
                invoices: related.invoices,
                orders: related.orders,
                shipments: related.shipments,
                inventoryItems: related.inventoryItems,
                activities: related.activities,
                summary: related.summary,
                analytics: related.analytics,
              }}
              onSelectTab={(nextTab) => setTab(nextTab as CompanyTab)}
            />
            {customFieldDefs.length > 0 && (
              <div className="bento-card p-5 space-y-3">
                <p className="eyebrow !text-[10px]">Custom fields</p>
                <CustomFieldsSection
                  definitions={customFieldDefs}
                  values={(company.customFields as Record<string, unknown>) ?? {}}
                  mode="read"
                />
              </div>
            )}
          </div>
        )}
        {!relatedLoading && tab === 'contacts' && (
          <ContactsPanel
            contacts={related.contacts}
            company={company}
            onCreateContact={() => setNewContactOpen(true)}
          />
        )}
        {!relatedLoading && tab === 'deals' && (
          <DealsPanel
            deals={related.deals}
            company={company}
            contacts={related.contacts}
            onCreateDeal={() => setNewDealOpen(true)}
            onCreateContact={() => setNewContactOpen(true)}
          />
        )}
        {!relatedLoading && tab === 'projects' && (
          <SimpleRowsPanel
            rows={related.projects}
            emptyIcon="folder_off"
            emptyLabel="No linked projects yet."
            title={(row) => String(row.name ?? row.id)}
            hrefFor={(row) => `/portal/projects/${row.id}`}
            metaFor={(row) => [String(row.description ?? ''), formatDate(row.updatedAt)]}
          />
        )}
        {!relatedLoading && tab === 'documents' && (
          <SimpleRowsPanel
            rows={related.documents}
            emptyIcon="description"
            emptyLabel="No linked documents yet."
            title={(row) => String(row.title ?? row.id)}
            hrefFor={(row) => `/portal/documents/${row.id}`}
            metaFor={(row) => [String(row.type ?? ''), formatDate(row.updatedAt)]}
          />
        )}
        {!relatedLoading && tab === 'services' && (
          <SimpleRowsPanel
            rows={related.serviceWorkspaces}
            emptyIcon="workspaces"
            emptyLabel="No service workspaces yet."
            title={(row) => String(row.name ?? row.id)}
            metaFor={(row) => [String(row.serviceType ?? ''), String(row.visibility ?? '')]}
          />
        )}
        {!relatedLoading && tab === 'relationships' && (
          <SimpleRowsPanel
            rows={related.relationships}
            emptyIcon="hub"
            emptyLabel="No business relationships yet."
            title={(row) => String(row.targetName ?? row.relationshipType ?? row.id)}
            metaFor={(row) => [String(row.relationshipType ?? ''), Array.isArray(row.sharedCapabilities) ? row.sharedCapabilities.join(', ') : undefined]}
          />
        )}
        {!relatedLoading && tab === 'quotes' && (
          <QuotesPanel
            quotes={related.quotes}
            company={company}
            deals={related.deals}
            creatingQuote={creatingQuote}
            quoteError={quoteError}
            onCreateQuote={createQuoteFromFirstDeal}
            onCreateDeal={() => setNewDealOpen(true)}
          />
        )}
        {!relatedLoading && tab === 'invoices' && <InvoicesPanel invoices={related.invoices} />}
        {!relatedLoading && tab === 'orders' && (
          <SimpleRowsPanel
            rows={related.orders}
            emptyIcon="orders"
            emptyLabel="No linked orders yet."
            title={(row) => String(row.title ?? row.id)}
            metaFor={(row) => [String(row.fulfillmentStatus ?? ''), formatCurrency(typeof row.total === 'number' ? row.total : undefined, String(row.currency ?? 'ZAR'))]}
          />
        )}
        {!relatedLoading && tab === 'shipments' && (
          <SimpleRowsPanel
            rows={related.shipments}
            emptyIcon="local_shipping"
            emptyLabel="No shipments yet."
            title={(row) => String(row.carrier ?? row.trackingNumber ?? row.id)}
            metaFor={(row) => [String(row.trackingNumber ?? ''), formatDate(row.expectedDeliveryDate)]}
          />
        )}
        {!relatedLoading && tab === 'inventory' && (
          <SimpleRowsPanel
            rows={related.inventoryItems}
            emptyIcon="inventory_2"
            emptyLabel="No inventory items yet."
            title={(row) => String(row.name ?? row.sku ?? row.id)}
            metaFor={(row) => [String(row.sku ?? ''), typeof row.quantityAvailable === 'number' ? `${row.quantityAvailable} available` : undefined]}
          />
        )}
        {!relatedLoading && tab === 'analytics' && <AnalyticsPanel analytics={related.analytics} summary={related.summary} />}
        {!relatedLoading && tab === 'activity' && (
          <ActivityPanel
            activities={related.activities}
            company={company}
            contacts={related.contacts}
            noteOpen={noteOpen}
            note={companyNote}
            savingNote={savingNote}
            noteError={noteError}
            onOpenNote={() => setNoteOpen(true)}
            onNoteChange={setCompanyNote}
            onSaveNote={saveCompanyNote}
            onCancelNote={() => {
              setNoteOpen(false)
              setCompanyNote('')
              setNoteError(null)
            }}
            onCreateContact={() => setNewContactOpen(true)}
          />
        )}
      </div>

      {/* Edit drawer */}
      {editOpen && (
        <CompanyEditDrawer
          company={company}
          mode="edit"
          onSave={handleSave}
          onClose={() => setEditOpen(false)}
          customFieldDefinitions={customFieldDefs}
        />
      )}

      {newContactOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/60 backdrop-blur-sm" onClick={() => setNewContactOpen(false)} />
          <div className="w-full max-w-md overflow-y-auto border-l border-[var(--color-pib-line)] bg-[var(--color-pib-surface)]">
            <div className="flex items-center justify-between border-b border-[var(--color-pib-line)] px-6 py-4">
              <div>
                <p className="eyebrow !text-[10px]">Company contact</p>
                <h2 className="font-display text-lg">New contact</h2>
              </div>
              <button
                type="button"
                onClick={() => setNewContactOpen(false)}
                className="text-[var(--color-pib-text-muted)] transition-colors hover:text-[var(--color-pib-text)]"
                aria-label="Close"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>
            <ContactForm
              onSave={createCompanyContact}
              onCancel={() => setNewContactOpen(false)}
              initial={{
                company: company.name,
                companyId: company.id,
                companyName: company.name,
              }}
            />
          </div>
        </div>
      )}

      {newDealOpen && related.contacts[0] && (
        <DealDrawer
          defaultContactId={related.contacts[0].id}
          defaultContactLabel={contactLabel(related.contacts[0])}
          defaultCompanyId={company.id}
          defaultCompanyName={company.name}
          orgId={company.orgId}
          onSaved={handleDealSaved}
          onClose={() => setNewDealOpen(false)}
        />
      )}
    </div>
  )
}
