'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { EmptyState, PageHeader, StatusPill, Surface } from '@/components/ui/AppFoundation'
import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'

type InvoiceStatus = 'draft' | 'sent' | 'viewed' | 'paid' | 'overdue' | 'cancelled'
type SerializedDate = Date | string | number | { _seconds?: number; seconds?: number; toDate?: () => Date } | null

interface Invoice {
  id: string
  invoiceNumber: string
  orgId: string
  status: InvoiceStatus
  total: number
  currency: string
  issueDate?: SerializedDate
  dueDate?: SerializedDate
  paidAt?: SerializedDate
}

interface OrgSummary {
  id: string
  slug?: string
  name?: string
  type?: string
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

const STATUS_MAP: Record<InvoiceStatus, { label: string; tone: 'neutral' | 'accent' | 'success' | 'warn' | 'danger' | 'info' }> = {
  draft:     { label: 'Draft',     tone: 'neutral' },
  sent:      { label: 'Sent',      tone: 'info' },
  viewed:    { label: 'Viewed',    tone: 'accent' },
  paid:      { label: 'Paid',      tone: 'success' },
  overdue:   { label: 'Overdue',   tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
}

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
}

function formatDate(ts: SerializedDate | undefined) {
  if (!ts) return '—'
  if (ts instanceof Date) {
    return ts.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }
  if (typeof ts === 'object') {
    if (typeof ts.toDate === 'function') {
      return ts.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    }
    const seconds = ts._seconds ?? ts.seconds
    if (typeof seconds === 'number') {
      return new Date(seconds * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    }
    return '—'
  }
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const PLATFORM_OWNER_SLUGS = new Set(['partners-in-biz', PIB_PLATFORM_ORG_ID])

function isPlatformOwnerSlug(slug?: string) {
  return Boolean(slug && PLATFORM_OWNER_SLUGS.has(slug))
}

function isPlatformOwnerOrg(org: OrgSummary, slug?: string) {
  return org.type === 'platform_owner' ||
    org.id === PIB_PLATFORM_ORG_ID ||
    isPlatformOwnerSlug(slug) ||
    isPlatformOwnerSlug(org.slug)
}

function fallbackPlatformOwnerOrg(slug: string): OrgSummary | null {
  if (!isPlatformOwnerSlug(slug)) return null
  return {
    id: PIB_PLATFORM_ORG_ID,
    slug,
    name: 'Partners in Biz',
    type: 'platform_owner',
  }
}

function invoiceListUrlForOrg(org: OrgSummary, slug: string) {
  const params = new URLSearchParams()
  params.set('view', 'received')

  if (isPlatformOwnerOrg(org, slug)) {
    params.set('billingOrgId', org.id || PIB_PLATFORM_ORG_ID)
  } else {
    params.set('orgId', org.id)
  }

  return `/api/v1/invoices?${params.toString()}`
}

export default function BillingPage() {
  const params = useParams()
  const slug = params.slug as string

  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [orgId, setOrgId] = useState<string>('')
  const [isPlatformBilling, setIsPlatformBilling] = useState(false)
  const [loading, setLoading] = useState(true)

  // Fetch org then invoices
  useEffect(() => {
    const fetchOrgAndInvoices = async () => {
      try {
        setLoading(true)
        setInvoices([])

        // Look up org by slug from the organizations list
        const orgsRes = await fetch('/api/v1/organizations')
        if (!orgsRes.ok) throw new Error('Failed to fetch organisations')
        const orgsBody = await orgsRes.json()
        const foundOrg = ((orgsBody.data ?? []) as OrgSummary[]).find((o) => o.slug === slug) ??
          fallbackPlatformOwnerOrg(slug)
        if (!foundOrg) throw new Error('Organisation not found')

        const platformBilling = isPlatformOwnerOrg(foundOrg, slug)
        setOrgId(foundOrg.id)
        setIsPlatformBilling(platformBilling)

        // Selected client orgs list invoices received by that org.
        // The PiB platform-owner billing surface lists PiB-issued invoices, then the API
        // filters restricted admins by their allowed recipient client orgs.
        const invoicesRes = await fetch(invoiceListUrlForOrg(foundOrg, slug), { headers: { 'X-Org-Id': foundOrg.id, 'X-Org-Slug': slug } })
        if (invoicesRes.ok) {
          const invoicesData = await invoicesRes.json()
          setInvoices(invoicesData.data ?? [])
        }
      } catch (error) {
        console.error('Error fetching billing data:', error)
      } finally {
        setLoading(false)
      }
    }

    if (slug) fetchOrgAndInvoices()
  }, [slug])

  const totalBilled = invoices.reduce((sum, inv) => sum + (inv.total ?? 0), 0)
  const outstanding = invoices
    .filter(i => ['sent', 'viewed', 'overdue'].includes(i.status))
    .reduce((sum, inv) => sum + (inv.total ?? 0), 0)
  const paid = invoices
    .filter(i => i.status === 'paid')
    .reduce((sum, inv) => sum + (inv.total ?? 0), 0)

  const currency = invoices[0]?.currency ?? 'USD'
  const newInvoiceHref = isPlatformBilling || !orgId
    ? '/admin/invoicing/new'
    : `/admin/invoicing/new?orgId=${encodeURIComponent(orgId)}`

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <PageHeader
        eyebrow="Admin org / Billing"
        title="Billing"
        description="Invoice pipeline, outstanding balances, and paid revenue for this selected org."
        actions={(
          <Link
            href={newInvoiceHref}
            className="pib-btn-primary text-sm font-label"
          >
            + New Invoice
          </Link>
        )}
      />

      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-4">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" />)
        ) : (
          <>
            <div className="pib-card">
              <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-2">
                Total Billed
              </p>
              <p className="text-2xl font-headline font-bold" style={{ color: 'var(--color-accent-v2)' }}>
                {formatCurrency(totalBilled, currency)}
              </p>
            </div>
            <div className="pib-card">
              <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-2">
                Outstanding
              </p>
              <p className="text-2xl font-headline font-bold text-on-surface">
                {formatCurrency(outstanding, currency)}
              </p>
            </div>
            <div className="pib-card">
              <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-2">
                Paid
              </p>
              <p className="text-2xl font-headline font-bold text-on-surface">
                {formatCurrency(paid, currency)}
              </p>
            </div>
          </>
        )}
      </div>

      {/* Invoice Table */}
      <Surface variant="table" className="overflow-hidden !p-0" bodyClassName="!p-0">
        <div className="grid grid-cols-12 gap-4 px-5 py-3 border-b border-[var(--color-card-border)]">
          <p className="col-span-2 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
            Invoice #
          </p>
          <p className="col-span-2 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
            Issue Date
          </p>
          <p className="col-span-2 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
            Due Date
          </p>
          <p className="col-span-2 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
            Amount
          </p>
          <p className="col-span-2 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
            Status
          </p>
          <p className="col-span-2 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
            Actions
          </p>
        </div>

        {loading ? (
          <div className="divide-y divide-[var(--color-card-border)]">
            {[1, 2, 3].map(i => (
              <div key={i} className="px-5 py-4">
                <Skeleton className="h-5 w-48" />
              </div>
            ))}
          </div>
        ) : invoices.length === 0 ? (
          <EmptyState
            icon="receipt_long"
            title="No invoices yet"
            description="Create the first invoice for this selected org when billing is ready."
            action={(
              <Link
                href={newInvoiceHref}
                className="pib-btn-primary text-sm font-label"
              >
                Create Invoice
              </Link>
            )}
          />
        ) : (
          <div className="divide-y divide-[var(--color-card-border)]">
            {invoices.map(inv => {
              const status = STATUS_MAP[inv.status] ?? { label: inv.status, tone: 'neutral' as const }
              return (
                <div
                  key={inv.id}
                  className="grid grid-cols-12 gap-4 items-center px-5 py-3 hover:bg-[var(--color-row-hover)] transition-colors"
                >
                  <div className="col-span-2">
                    <p className="text-sm font-mono text-on-surface">{inv.invoiceNumber}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-sm text-on-surface-variant">{formatDate(inv.issueDate)}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-sm text-on-surface-variant">{formatDate(inv.dueDate)}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-sm font-medium text-on-surface">
                      {formatCurrency(inv.total ?? 0, inv.currency ?? 'USD')}
                    </p>
                  </div>
                  <div className="col-span-2">
                    <StatusPill tone={status.tone} dot>
                      {status.label}
                    </StatusPill>
                  </div>
                  <div className="col-span-2 flex justify-end gap-3">
                    <a
                      href={`/api/v1/invoices/${inv.id}/pdf`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] font-label uppercase tracking-wide"
                      style={{ color: 'var(--color-accent-v2)' }}
                    >
                      PDF
                    </a>
                    <Link
                      href={`/admin/invoicing/${inv.id}`}
                      className="text-[10px] font-label uppercase tracking-wide"
                      style={{ color: 'var(--color-accent-v2)' }}
                    >
                      View →
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Surface>
    </div>
  )
}
