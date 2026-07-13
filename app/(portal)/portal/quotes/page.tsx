'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'declined' | 'expired' | 'converted'

interface Quote {
  id: string
  quoteNumber: string
  orgId: string
  status: QuoteStatus
  total: number
  currency: string
  issueDate?: DateLike
  validUntil?: DateLike
  convertedInvoiceId?: string
}

type DateLike = string | number | Date | { _seconds?: number; seconds?: number } | null | undefined

const STATUS_MAP: Record<QuoteStatus, { label: string; color: string }> = {
  draft:     { label: 'Draft',     color: 'var(--color-outline)' },
  sent:      { label: 'Sent',      color: '#60a5fa' },
  accepted:  { label: 'Accepted',  color: '#4ade80' },
  declined:  { label: 'Declined',  color: '#ef4444' },
  expired:   { label: 'Expired',   color: 'var(--color-outline)' },
  converted: { label: 'Converted', color: '#c084fc' },
}

function formatCurrency(amount: number, currency: string) {
  const locales: Record<string, string> = { USD: 'en-US', EUR: 'de-DE', ZAR: 'en-ZA' }
  return new Intl.NumberFormat(locales[currency] || 'en-US', { style: 'currency', currency }).format(amount)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object')
}

function formatDate(ts: DateLike) {
  if (!ts) return '—'
  const seconds = isRecord(ts) && typeof ts._seconds === 'number'
    ? ts._seconds
    : isRecord(ts) && typeof ts.seconds === 'number'
      ? ts.seconds
      : null
  const d = seconds ? new Date(seconds * 1000) : new Date(ts as string | number | Date)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function extractQuotes(body: unknown): Quote[] {
  const data = isRecord(body) ? body.data : undefined
  if (Array.isArray(data)) return data
  if (isRecord(data) && Array.isArray(data.quotes)) return data.quotes as Quote[]
  return []
}

function extractOrgs(body: unknown): Array<{ id: string; name: string }> {
  const data = isRecord(body) ? body.data : undefined
  if (Array.isArray(data)) return data
  if (isRecord(data) && Array.isArray(data.organizations)) return data.organizations as Array<{ id: string; name: string }>
  if (isRecord(data) && Array.isArray(data.orgs)) return data.orgs as Array<{ id: string; name: string }>
  return []
}

export default function QuotesPage() {
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [orgMap, setOrgMap] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<QuoteStatus | 'all'>('all')

  useEffect(() => {
    Promise.all([
      fetch('/api/v1/quotes').then(r => r.json()),
      fetch('/api/v1/organizations').then(r => r.json()),
    ]).then(([quotesBody, orgsBody]) => {
      setQuotes(extractQuotes(quotesBody))
      const map: Record<string, string> = {}
      for (const org of extractOrgs(orgsBody)) map[org.id] = org.name
      setOrgMap(map)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const filtered = filter === 'all' ? quotes : quotes.filter(q => q.status === filter)

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow">CRM · Sales</p>
          <h1 className="pib-page-title mt-2">Quotes</h1>
          <p className="pib-page-sub">{loading ? '—' : `${quotes.length} quotes`}</p>
        </div>
        <Link href="/portal/quotes/new" className="btn-pib-primary text-sm shrink-0">+ New Quote</Link>
      </header>

      {/* Filters */}
      <div className="pib-tabs pib-tabs-segmented" role="tablist" aria-label="Quote status filter">
        {(['all', 'draft', 'sent', 'accepted', 'declined', 'converted'] as const).map(s => (
          <button
            key={s}
            role="tab"
            aria-selected={filter === s}
            onClick={() => setFilter(s)}
            className={`pib-tab capitalize ${filter === s ? 'pib-tab-active' : ''}`}
          >
            {s === 'all' ? `All (${quotes.length})` : `${s} (${quotes.filter(q => q.status === s).length})`}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="pib-surface pib-surface-table">
        <div className="grid grid-cols-12 gap-4 px-5 py-3 border-b border-[var(--color-pib-line)]">
          <p className="col-span-2 pib-label mb-0">#</p>
          <p className="col-span-3 pib-label mb-0">Client</p>
          <p className="col-span-2 pib-label mb-0">Status</p>
          <p className="col-span-2 pib-label mb-0">Amount</p>
          <p className="col-span-2 pib-label mb-0">Valid Until</p>
          <p className="col-span-1 pib-label mb-0"></p>
        </div>

        {loading ? (
          <div className="divide-y divide-[var(--color-pib-line)]">
            {[1,2,3].map(i => <div key={i} className="px-5 py-4"><div className="pib-skeleton h-5 w-48" /></div>)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="pib-empty-state border-0">
            <p className="pib-empty-state-description">No quotes found.</p>
            <Link href="/portal/quotes/new" className="btn-pib-secondary text-sm mt-4">
              Create your first quote →
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-[var(--color-pib-line)]">
            {filtered.map(q => {
              const status = STATUS_MAP[q.status] ?? { label: q.status, color: 'var(--color-outline)' }
              return (
                <div key={q.id} className="grid grid-cols-12 gap-4 items-center px-5 py-3 hover:bg-[var(--color-row-hover)] transition-colors">
                  <div className="col-span-2">
                    <p className="text-sm font-mono text-[var(--color-pib-text)]">{q.quoteNumber}</p>
                  </div>
                  <div className="col-span-3 min-w-0">
                    <p className="text-sm text-[var(--color-pib-text)] truncate">{orgMap[q.orgId] ?? q.orgId}</p>
                  </div>
                  <div className="col-span-2">
                    <span className="pib-pill" style={{ background: `${status.color}20`, color: status.color, borderColor: `${status.color}40` }}>
                      {status.label}
                    </span>
                  </div>
                  <div className="col-span-2">
                    <p className="text-sm font-medium text-[var(--color-pib-text)]">{formatCurrency(q.total ?? 0, q.currency ?? 'USD')}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-sm text-[var(--color-pib-text-muted)]">{formatDate(q.validUntil)}</p>
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <Link href={`/portal/quotes/${q.id}`} className="pib-label mb-0 text-[var(--color-pib-accent-hover)]">
                      View →
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
