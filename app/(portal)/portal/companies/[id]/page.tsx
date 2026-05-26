'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import type { Company } from '@/lib/companies/types'
import type { CustomFieldDefinition } from '@/lib/customFields/types'
import { CompanyHeader } from '@/components/crm/CompanyHeader'
import { CompanyTabsBar } from '@/components/crm/CompanyTabsBar'
import type { CompanyTab } from '@/components/crm/CompanyTabsBar'
import { CompanyOverviewPanel } from '@/components/crm/CompanyOverviewPanel'
import { CompanyEditDrawer } from '@/components/crm/CompanyEditDrawer'
import { CustomFieldsSection } from '@/components/crm/CustomFieldsSection'

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
  value?: number
  currency?: string
  stageId?: string
  probability?: number
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

type RelatedActivity = {
  id: string
  type?: string
  summary?: string
  createdAt?: unknown
}

type RelatedState = {
  contacts: RelatedContact[]
  deals: RelatedDeal[]
  quotes: RelatedQuote[]
  invoices: RelatedInvoice[]
  activities: RelatedActivity[]
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

function EmptyPanel({ icon, label }: { icon: string; label: string }) {
  return (
    <div className="bento-card p-10 text-center">
      <span className="material-symbols-outlined text-4xl text-[var(--color-pib-text-muted)]">{icon}</span>
      <p className="text-sm text-[var(--color-pib-text-muted)] mt-3">
        {label}
      </p>
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

function ContactsPanel({ contacts }: { contacts: RelatedContact[] }) {
  if (contacts.length === 0) return <EmptyPanel icon="person_off" label="No linked contacts yet." />
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

function DealsPanel({ deals }: { deals: RelatedDeal[] }) {
  if (deals.length === 0) return <EmptyPanel icon="work_off" label="No linked deals yet." />
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

function QuotesPanel({ quotes }: { quotes: RelatedQuote[] }) {
  if (quotes.length === 0) return <EmptyPanel icon="request_quote" label="No linked quotes yet." />
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

function ActivityPanel({ activities }: { activities: RelatedActivity[] }) {
  if (activities.length === 0) return <EmptyPanel icon="history" label="No company activity yet." />
  return (
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
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>()

  const [company, setCompany] = useState<Company | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [tab, setTab] = useState<CompanyTab>('overview')
  const [editOpen, setEditOpen] = useState(false)
  const [customFieldDefs, setCustomFieldDefs] = useState<CustomFieldDefinition[]>([])
  const [related, setRelated] = useState<RelatedState>({
    contacts: [],
    deals: [],
    quotes: [],
    invoices: [],
    activities: [],
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

  const companyId = company?.id
  useEffect(() => {
    if (!companyId) return
    let cancelled = false
    async function fetchRelated() {
      setRelatedLoading(true)
      setRelatedError(null)
      try {
        const [contactsRes, dealsRes, quotesRes, invoicesRes, activitiesRes] = await Promise.all([
          fetch(`/api/v1/crm/companies/${companyId}/contacts?limit=100`),
          fetch(`/api/v1/crm/companies/${companyId}/deals?limit=100`),
          fetch(`/api/v1/crm/companies/${companyId}/quotes?limit=100`),
          fetch(`/api/v1/crm/companies/${companyId}/invoices?limit=100`),
          fetch(`/api/v1/crm/companies/${companyId}/activities?limit=100`),
        ])
        const responses = [contactsRes, dealsRes, quotesRes, invoicesRes, activitiesRes]
        const failed = responses.find((res) => !res.ok)
        if (failed) {
          const body = await failed.json().catch(() => ({}))
          throw new Error(body.error ?? `HTTP ${failed.status}`)
        }
        const [contactsBody, dealsBody, quotesBody, invoicesBody, activitiesBody] = await Promise.all(
          responses.map((res) => res.json()),
        )
        if (!cancelled) {
          setRelated({
            contacts: extractList<RelatedContact>(contactsBody, 'contacts'),
            deals: extractList<RelatedDeal>(dealsBody, 'deals'),
            quotes: extractList<RelatedQuote>(quotesBody, 'quotes'),
            invoices: extractList<RelatedInvoice>(invoicesBody, 'invoices'),
            activities: extractList<RelatedActivity>(activitiesBody, 'activities'),
          })
        }
      } catch (err) {
        if (!cancelled) setRelatedError(err instanceof Error ? err.message : 'Failed to load linked records')
      } finally {
        if (!cancelled) setRelatedLoading(false)
      }
    }
    void fetchRelated()
    return () => {
      cancelled = true
    }
  }, [companyId])

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
        <CompanyHeader company={company} onEdit={() => setEditOpen(true)} />
      </div>

      {/* Tabs */}
      <CompanyTabsBar activeTab={tab} onChange={(t) => setTab(t as CompanyTab)} />

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
            <CompanyOverviewPanel company={company} />
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
        {!relatedLoading && tab === 'contacts' && <ContactsPanel contacts={related.contacts} />}
        {!relatedLoading && tab === 'deals' && <DealsPanel deals={related.deals} />}
        {!relatedLoading && tab === 'quotes' && <QuotesPanel quotes={related.quotes} />}
        {!relatedLoading && tab === 'invoices' && <InvoicesPanel invoices={related.invoices} />}
        {!relatedLoading && tab === 'activity' && <ActivityPanel activities={related.activities} />}
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
    </div>
  )
}
