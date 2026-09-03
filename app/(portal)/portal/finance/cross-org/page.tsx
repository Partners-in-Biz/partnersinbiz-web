'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { FinanceModuleFrame } from '@/components/finance/FinanceModuleFrame'
import { scopedPortalPath } from '@/lib/portal/scoped-routing'
import { usePortalOrgScope } from '@/lib/portal/usePortalOrgScope'
import {
  formatMinor,
  newFinanceId,
  parseRandsToMinor,
  readFinanceJson,
  requestIdentity,
  todayISODate,
} from '@/components/finance/financeWorkbench'

type Notice = Record<string, any>

export default function CrossOrgFinancePage() {
  const orgScope = usePortalOrgScope()
  const orgId = orgScope.orgId || ''

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [view, setView] = useState<'inbox' | 'sent' | 'all'>('inbox')
  const [notices, setNotices] = useState<Notice[]>([])

  const [recipientOrgId, setRecipientOrgId] = useState('')
  const [sourceCompanyId, setSourceCompanyId] = useState('')
  const [sourcePaymentId, setSourcePaymentId] = useState('')
  const [amount, setAmount] = useState('1000.00')
  const [description, setDescription] = useState('Observed client payment')
  const [perspective, setPerspective] = useState<'inbound_to_recipient' | 'outbound_from_recipient'>(
    'inbound_to_recipient',
  )

  const queryUrl = useCallback(() => {
    const q = new URLSearchParams()
    q.set('resource', 'notices')
    q.set('view', view)
    if (orgId) q.set('orgId', orgId)
    return `/api/v1/finance/cross-org/queries?${q.toString()}`
  }, [orgId, view])

  const loadNotices = useCallback(async () => {
    if (!orgId) {
      setNotices([])
      return
    }
    try {
      const res = await fetch(queryUrl(), { credentials: 'include' })
      const body = await readFinanceJson(res)
      const next = (body?.data?.result?.notices ?? []) as Notice[]
      setNotices(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load cross-org notices')
    }
  }, [orgId, queryUrl])

  useEffect(() => {
    void loadNotices()
  }, [loadNotices])

  async function runCommand(operation: string, command: Record<string, unknown>) {
    const res = await fetch('/api/v1/finance/cross-org/commands', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(orgId ? { 'X-Org-Id': orgId } : {}),
      },
      body: JSON.stringify({ operation, command: { ...command, orgId } }),
    })
    return readFinanceJson(res)
  }

  async function withBusy(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await fn()
      await loadNotices()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setBusy(false)
    }
  }

  async function notify() {
    await withBusy(async () => {
      const id = newFinanceId('xon')
      const ids = requestIdentity('xon')
      await runCommand('cross_org.payment.notify', {
        id,
        recipientOrgId: recipientOrgId || undefined,
        sourceCompanyId: sourceCompanyId || undefined,
        sourcePaymentId: sourcePaymentId || newFinanceId('pay'),
        perspective,
        amountMinor: parseRandsToMinor(amount),
        currency: 'ZAR',
        description,
        observedDate: todayISODate(),
        method: 'eft',
        ...ids,
      })
      setMessage(`Notified recipient org of observed payment ${id}`)
    })
  }

  async function resolve(id: string, operation: 'cross_org.payment.confirm' | 'cross_org.payment.dispute' | 'cross_org.payment.dismiss') {
    await withBusy(async () => {
      const ids = requestIdentity('xon')
      await runCommand(operation, {
        id,
        resolutionNote: operation === 'cross_org.payment.confirm' ? 'Receipt confirmed' : undefined,
        recipientPaymentId: operation === 'cross_org.payment.confirm' ? newFinanceId('pay') : undefined,
        ...ids,
      })
      setMessage(`${operation} completed for ${id}`)
    })
  }

  return (
    <FinanceModuleFrame
      active="cross-org"
      orgScope={orgScope}
      title="Cross-org payments"
      description="Notify and confirm cross-org payments. No external payment initiation."
      error={error}
      message={message}
    >

      {!orgId && (
        <div className="rounded-lg border border-[var(--st-warning)] bg-[color-mix(in_srgb,var(--st-warning)_10%,transparent)] p-3 text-sm">
          Select an organisation scope to use cross-org payment notices.
        </div>
      )}
      {error && <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm">{error}</div>}
      {message && <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">{message}</div>}

      <div className="grid gap-4 md:grid-cols-2">
        <section className="pib-card space-y-3 p-4">
          <h2 className="text-base">Notify linked org (source side)</h2>
          <p className="text-xs text-[var(--color-pib-text-muted)]">
            Requires CRM company.linkedOrgId or an active businessRelationship. Money movement is recorded only.
          </p>
          <label className="block text-sm">
            Recipient org id
            <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={recipientOrgId} onChange={(e) => setRecipientOrgId(e.target.value)} placeholder="client-org-id" />
          </label>
          <label className="block text-sm">
            Source CRM company id (optional if relationship resolves)
            <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={sourceCompanyId} onChange={(e) => setSourceCompanyId(e.target.value)} />
          </label>
          <label className="block text-sm">
            Source payment id
            <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={sourcePaymentId} onChange={(e) => setSourcePaymentId(e.target.value)} placeholder="pay_..." />
          </label>
          <label className="block text-sm">
            Perspective for recipient
            <select className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={perspective} onChange={(e) => setPerspective(e.target.value as typeof perspective)}>
              <option value="inbound_to_recipient">Inbound receipt to recipient</option>
              <option value="outbound_from_recipient">Outbound disbursement from recipient</option>
            </select>
          </label>
          <label className="block text-sm">
            Amount (ZAR)
            <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className="block text-sm">
            Description
            <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <button type="button" className="pib-btn" disabled={busy || !orgId} onClick={() => void notify()}>
            Notify recipient
          </button>
        </section>

        <section className="pib-card space-y-3 p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base">Notices</h2>
            <select
              aria-label="Notice view"
              className="rounded-lg border border-[var(--color-pib-line)] bg-transparent px-2 py-1 text-sm"
              value={view}
              onChange={(e) => setView(e.target.value as typeof view)}
            >
              <option value="inbox">Inbox (to us)</option>
              <option value="sent">Sent (from us)</option>
              <option value="all">All</option>
            </select>
          </div>
          {notices.length === 0 ? (
            <p className="text-sm text-[var(--color-pib-text-muted)]">No notices in this view.</p>
          ) : (
            <ul className="space-y-3">
              {notices.map((n) => (
                <li key={n.id} className="rounded-lg border border-[var(--color-pib-line)] p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{n.description}</span>
                    <span className="text-xs uppercase tracking-wide text-[var(--color-pib-text-muted)]">{n.status}</span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
                    {formatMinor(n.amountMinor, n.currency || 'ZAR')} · {n.perspective} · source {n.sourceOrgId} → {n.recipientOrgId}
                  </p>
                  <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">payment {n.sourcePaymentId} · {n.observedDate}</p>
                  {n.recipientOrgId === orgId && n.status === 'notified' && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button type="button" className="pib-btn" disabled={busy} onClick={() => void resolve(n.id, 'cross_org.payment.confirm')}>Confirm receipt</button>
                      <button type="button" className="pib-btn-ghost" disabled={busy} onClick={() => void resolve(n.id, 'cross_org.payment.dispute')}>Dispute</button>
                      <button type="button" className="pib-btn-ghost" disabled={busy} onClick={() => void resolve(n.id, 'cross_org.payment.dismiss')}>Dismiss</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </FinanceModuleFrame>
  )
}