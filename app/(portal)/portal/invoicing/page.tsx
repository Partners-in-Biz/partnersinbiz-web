'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import Link from 'next/link'

type InvoiceStatus = 'draft' | 'sent' | 'viewed' | 'paid' | 'overdue' | 'cancelled'

interface Invoice {
  id: string
  invoiceNumber: string
  orgId: string
  orgName?: string
  status: InvoiceStatus
  total: number
  currency: string
  issueDate?: any
  dueDate?: any
  paidAt?: any
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

const STATUS_MAP: Record<InvoiceStatus, { label: string; color: string }> = {
  draft:     { label: 'Draft',     color: 'var(--color-outline)' },
  sent:      { label: 'Sent',      color: '#60a5fa' },
  viewed:    { label: 'Viewed',    color: '#c084fc' },
  paid:      { label: 'Paid',      color: '#4ade80' },
  overdue:   { label: 'Overdue',   color: '#ef4444' },
  cancelled: { label: 'Cancelled', color: 'var(--color-outline)' },
}

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
}

function formatDate(ts: any) {
  if (!ts) return '—'
  const d = ts._seconds ? new Date(ts._seconds * 1000) : new Date(ts)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function InvoicingPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<InvoiceStatus | 'all'>('all')
  const [orgMap, setOrgMap] = useState<Record<string, string>>({})

  useEffect(() => {
    fetch('/api/v1/invoices')
      .then(r => r.json())
      .then(body => { setInvoices(body.data ?? []); setLoading(false) })
      .catch(() => setLoading(false))
    fetch('/api/v1/organizations')
      .then(r => r.json())
      .then(body => {
        const map: Record<string, string> = {}
        for (const org of body.data ?? []) map[org.id] = org.name
        setOrgMap(map)
      })
  }, [])

  const filtered = filter === 'all' ? invoices : invoices.filter(i => i.status === filter)

  const totalRevenue = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.total ?? 0), 0)
  const outstanding = invoices.filter(i => ['sent', 'viewed', 'overdue'].includes(i.status)).reduce((s, i) => s + (i.total ?? 0), 0)
  const overdueCount = invoices.filter(i => i.status === 'overdue').length

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-headline font-bold text-on-surface">Invoicing</h1>
          <p className="text-sm text-on-surface-variant mt-0.5">{loading ? '—' : `${invoices.length} invoices`}</p>
        </div>
        <Link href="/portal/invoicing/new" className="pib-btn-primary text-sm font-label">
          + New Invoice
        </Link>
      </div>

      {/* Stats */}
      {!loading && (
        <div className="grid grid-cols-3 gap-4">
          <div className="pib-card">
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">Revenue Collected</p>
            <p className="text-2xl font-headline font-bold" style={{ color: 'var(--color-accent-v2)' }}>
              {formatCurrency(totalRevenue, 'ZAR')}
            </p>
          </div>
          <div className="pib-card">
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">Outstanding</p>
            <p className="text-2xl font-headline font-bold text-on-surface">{formatCurrency(outstanding, 'ZAR')}</p>
          </div>
          <div className="pib-card">
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">Overdue</p>
            <p className="text-2xl font-headline font-bold" style={{ color: overdueCount > 0 ? '#ef4444' : 'var(--color-on-surface)' }}>
              {overdueCount}
            </p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {(['all', 'draft', 'sent', 'viewed', 'paid', 'overdue'] as const).map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className="text-xs font-label px-3 py-1.5 rounded-[var(--radius-btn)] transition-colors capitalize"
            style={filter === s
              ? { background: 'var(--color-accent-v2)', color: '#000' }
              : { color: 'var(--color-on-surface-variant)' }
            }
          >
            {s === 'all' ? `All (${invoices.length})` : `${s} (${invoices.filter(i => i.status === s).length})`}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="pib-card overflow-hidden !p-0">
        <div className="grid grid-cols-12 gap-4 px-5 py-3 border-b border-[var(--color-card-border)]">
          <p className="col-span-2 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">#</p>
          <p className="col-span-3 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Client</p>
          <p className="col-span-2 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Status</p>
          <p className="col-span-2 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Amount</p>
          <p className="col-span-2 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Due</p>
          <p className="col-span-1 text-[10px] font-label uppercase tracking-widest text-on-surface-variant"></p>
        </div>

        {loading ? (
          <div className="divide-y divide-[var(--color-card-border)]">
            {[1,2,3].map(i => <div key={i} className="px-5 py-4"><Skeleton className="h-5 w-48" /></div>)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-on-surface-variant text-sm">No invoices found.</p>
            <Link href="/portal/invoicing/new" className="text-sm mt-2 inline-block" style={{ color: 'var(--color-accent-v2)' }}>
              Create your first invoice →
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-[var(--color-card-border)]">
            {filtered.map(inv => {
              const status = STATUS_MAP[inv.status] ?? { label: inv.status, color: 'var(--color-outline)' }
              return (
                <div key={inv.id} className="grid grid-cols-12 gap-4 items-center px-5 py-3 hover:bg-[var(--color-row-hover)] transition-colors">
                  <div className="col-span-2">
                    <p className="text-sm font-mono text-on-surface">{inv.invoiceNumber}</p>
                  </div>
                  <div className="col-span-3 min-w-0">
                    <p className="text-sm text-on-surface truncate">{orgMap[inv.orgId] ?? inv.orgId}</p>
                  </div>
                  <div className="col-span-2">
                    <span className="text-[10px] font-label uppercase tracking-wide px-2 py-0.5 rounded-full" style={{ background: `${status.color}20`, color: status.color }}>
                      {status.label}
                    </span>
                  </div>
                  <div className="col-span-2">
                    <p className="text-sm font-medium text-on-surface">{formatCurrency(inv.total ?? 0, inv.currency ?? 'USD')}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-sm text-on-surface-variant">{formatDate(inv.dueDate)}</p>
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <Link href={`/portal/invoicing/${inv.id}`} className="text-[10px] font-label uppercase tracking-wide" style={{ color: 'var(--color-accent-v2)' }}>
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
