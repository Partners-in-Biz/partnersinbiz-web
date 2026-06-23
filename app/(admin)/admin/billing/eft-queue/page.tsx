'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { formatZar, formatDate, tsToMillis } from '@/lib/billing/format'

interface EftQueueItem {
  invoiceId: string
  invoiceNumber: string
  orgId: string | null
  orgName: string | null
  total: number
  currency: string
  paymentProofUploadedAt: unknown
  paymentProofNote: string | null
  proofFileId: string | null
  proofUrl: string | null
  proofContentType: string | null
  proofFilename: string | null
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

function money(amount: number, currency: string): string {
  if (currency === 'ZAR') return formatZar(amount, { decimals: true })
  try {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

export default function EftQueuePage() {
  const [items, setItems] = useState<EftQueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [topError, setTopError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Per-invoice action state
  const [busyId, setBusyId] = useState<string | null>(null)
  const [refById, setRefById] = useState<Record<string, string>>({})
  const [amountById, setAmountById] = useState<Record<string, string>>({})
  const [rejectOpenId, setRejectOpenId] = useState<string | null>(null)
  const [reasonById, setReasonById] = useState<Record<string, string>>({})

  async function load() {
    setLoading(true)
    setTopError(null)
    try {
      const res = await fetch('/api/v1/admin/billing/eft-queue')
      const body = await res.json()
      if (!res.ok) {
        setTopError(body?.error ?? 'Failed to load EFT queue')
        setItems([])
      } else {
        setItems((body.data ?? []) as EftQueueItem[])
      }
    } catch (err) {
      setTopError(err instanceof Error ? err.message : 'Failed to load EFT queue')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function confirm(item: EftQueueItem) {
    setBusyId(item.invoiceId)
    setTopError(null)
    setNotice(null)
    try {
      const amountStr = amountById[item.invoiceId]
      const parsedAmount = amountStr !== undefined && amountStr.trim() ? Number(amountStr) : undefined
      const reference = refById[item.invoiceId]?.trim()
      const res = await fetch(`/api/v1/admin/billing/invoices/${item.invoiceId}/verify-eft`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'confirm',
          ...(reference ? { reference } : {}),
          ...(parsedAmount !== undefined && Number.isFinite(parsedAmount) ? { amount: parsedAmount } : {}),
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'Failed to confirm payment')
      setNotice(`Invoice ${item.invoiceNumber} marked paid.`)
      await load()
    } catch (err) {
      setTopError(err instanceof Error ? err.message : 'Failed to confirm payment')
    } finally {
      setBusyId(null)
    }
  }

  async function reject(item: EftQueueItem) {
    setBusyId(item.invoiceId)
    setTopError(null)
    setNotice(null)
    try {
      const reason = reasonById[item.invoiceId]?.trim()
      const res = await fetch(`/api/v1/admin/billing/invoices/${item.invoiceId}/verify-eft`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'reject',
          ...(reason ? { reason } : {}),
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'Failed to reject proof')
      setNotice(`EFT proof for invoice ${item.invoiceNumber} rejected.`)
      setRejectOpenId(null)
      await load()
    } catch (err) {
      setTopError(err instanceof Error ? err.message : 'Failed to reject proof')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">
            Billing / Payments
          </p>
          <h1 className="text-2xl font-headline font-bold text-on-surface">EFT Verification Queue</h1>
          <p className="text-sm text-on-surface-variant mt-0.5">
            Review client EFT proof-of-payment uploads and confirm or reject each one.
          </p>
        </div>
        <button onClick={load} disabled={loading} className="pib-btn-ghost text-sm font-label self-start md:self-auto">
          Refresh
        </button>
      </div>

      {topError && (
        <div className="pib-card border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400">
          {topError}
        </div>
      )}

      {notice && (
        <div className="pib-card border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm text-green-400">
          {notice}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
        </div>
      ) : items.length === 0 ? (
        <div className="pib-card p-8 text-center text-sm text-on-surface-variant">
          No EFT proofs awaiting verification.
        </div>
      ) : (
        <ul className="space-y-4">
          {items.map((item) => {
            const busy = busyId === item.invoiceId
            const uploadedMs = tsToMillis(item.paymentProofUploadedAt)
            const isImage = (item.proofContentType ?? '').startsWith('image/')
            const rejectOpen = rejectOpenId === item.invoiceId
            return (
              <li key={item.invoiceId} className="pib-card p-5">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
                  {/* Details */}
                  <div className="flex-1 min-w-0 space-y-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-base font-semibold text-on-surface">{item.invoiceNumber}</h2>
                      <span
                        className="text-[10px] font-label uppercase tracking-wide px-2 py-0.5 rounded-full"
                        style={{ background: 'var(--color-accent-v2)20', color: 'var(--color-accent-v2)' }}
                      >
                        Pending verification
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                      <div>
                        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Client</p>
                        <p className="text-on-surface truncate">{item.orgName ?? item.orgId ?? '—'}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Amount</p>
                        <p className="text-on-surface font-semibold">{money(item.total, item.currency)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Uploaded</p>
                        <p className="text-on-surface">{formatDate(uploadedMs)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Currency</p>
                        <p className="text-on-surface">{item.currency}</p>
                      </div>
                    </div>

                    {item.paymentProofNote && (
                      <div className="rounded-md border border-on-surface/10 bg-on-surface/5 p-3">
                        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">
                          Client note
                        </p>
                        <p className="text-sm text-on-surface-variant">{item.paymentProofNote}</p>
                      </div>
                    )}

                    {/* Confirm controls */}
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end pt-1">
                      <label className="block flex-1">
                        <span className="text-[10px] font-label uppercase tracking-wide text-on-surface-variant">
                          Reference (optional)
                        </span>
                        <input
                          type="text"
                          value={refById[item.invoiceId] ?? ''}
                          onChange={(e) => setRefById((p) => ({ ...p, [item.invoiceId]: e.target.value }))}
                          placeholder="Bank reference"
                          className="pib-input w-full mt-1"
                          disabled={busy}
                        />
                      </label>
                      <label className="block flex-1">
                        <span className="text-[10px] font-label uppercase tracking-wide text-on-surface-variant">
                          Amount (optional)
                        </span>
                        <input
                          type="number"
                          step="0.01"
                          value={amountById[item.invoiceId] ?? ''}
                          onChange={(e) => setAmountById((p) => ({ ...p, [item.invoiceId]: e.target.value }))}
                          placeholder={String(item.total)}
                          className="pib-input w-full mt-1"
                          disabled={busy}
                        />
                      </label>
                    </div>

                    <div className="flex flex-wrap gap-2 pt-1">
                      <button
                        onClick={() => confirm(item)}
                        disabled={busy}
                        className="pib-btn-primary text-sm font-label"
                      >
                        {busy ? 'Working...' : 'Confirm payment'}
                      </button>
                      <button
                        onClick={() => {
                          setRejectOpenId(rejectOpen ? null : item.invoiceId)
                        }}
                        disabled={busy}
                        className="pib-btn-ghost text-sm font-label"
                      >
                        {rejectOpen ? 'Cancel reject' : 'Reject'}
                      </button>
                      {item.orgId && (
                        <Link
                          href={`/portal/invoicing/${item.invoiceId}`}
                          className="pib-btn-ghost text-sm font-label"
                        >
                          Open invoice
                        </Link>
                      )}
                    </div>

                    {rejectOpen && (
                      <div className="rounded-md border border-on-surface/10 bg-on-surface/5 p-3 space-y-2">
                        <label className="block">
                          <span className="text-[10px] font-label uppercase tracking-wide text-on-surface-variant">
                            Rejection reason
                          </span>
                          <input
                            type="text"
                            value={reasonById[item.invoiceId] ?? ''}
                            onChange={(e) => setReasonById((p) => ({ ...p, [item.invoiceId]: e.target.value }))}
                            placeholder="Why is this proof being rejected?"
                            className="pib-input w-full mt-1"
                            disabled={busy}
                          />
                        </label>
                        <button
                          onClick={() => reject(item)}
                          disabled={busy}
                          className="pib-btn-secondary text-sm font-label"
                          style={{ color: '#f87171' }}
                        >
                          {busy ? 'Working...' : 'Confirm rejection'}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Proof preview */}
                  <div className="w-full lg:w-64 flex-shrink-0">
                    <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-2">
                      Proof of payment
                    </p>
                    {item.proofUrl ? (
                      isImage ? (
                        <a href={item.proofUrl} target="_blank" rel="noopener noreferrer" className="block">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={item.proofUrl}
                            alt={`Proof for ${item.invoiceNumber}`}
                            className="w-full rounded-md border border-on-surface/10 object-contain max-h-64 bg-on-surface/5"
                          />
                        </a>
                      ) : (
                        <a
                          href={item.proofUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="pib-btn-secondary text-sm font-label inline-block"
                        >
                          View proof{item.proofFilename ? ` (${item.proofFilename})` : ''}
                        </a>
                      )
                    ) : (
                      <p className="text-sm text-on-surface-variant">No proof file attached</p>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
