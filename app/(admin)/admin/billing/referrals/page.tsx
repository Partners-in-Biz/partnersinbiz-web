'use client'

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { formatZar, formatDate, tsToMillis } from '@/lib/billing/format'
import type { Referral, ReferralSettings, ReferralStatus } from '@/lib/billing/types'

interface Summary {
  pendingCount: number
  pendingCreditZar: number
  approvedCount: number
  approvedCreditZar: number
  paidCreditZar: number
}

interface OrgOption {
  id: string
  name: string
}

const STATUS_TABS: Array<{ key: ReferralStatus | 'all'; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'disputed', label: 'Disputed' },
  { key: 'paid', label: 'Paid' },
]

const STATUS_STYLE: Record<ReferralStatus, { bg: string; color: string }> = {
  pending: { bg: 'rgba(234,179,8,0.12)', color: '#facc15' },
  approved: { bg: 'rgba(34,197,94,0.12)', color: '#4ade80' },
  disputed: { bg: 'rgba(239,68,68,0.12)', color: '#f87171' },
  paid: { bg: 'rgba(59,130,246,0.12)', color: '#60a5fa' },
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

function StatusBadge({ status }: { status: ReferralStatus }) {
  const s = STATUS_STYLE[status]
  return (
    <span
      className="text-xs font-label px-2.5 py-1 rounded-full capitalize"
      style={{ background: s.bg, color: s.color }}
    >
      {status}
    </span>
  )
}

export default function ReferralsPage() {
  const [referrals, setReferrals] = useState<Referral[]>([])
  const [settings, setSettings] = useState<ReferralSettings | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [orgs, setOrgs] = useState<OrgOption[]>([])
  const [loading, setLoading] = useState(true)
  const [topError, setTopError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [filter, setFilter] = useState<ReferralStatus | 'all'>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [disputeReason, setDisputeReason] = useState('')

  // New referral form
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [newReferrer, setNewReferrer] = useState('')
  const [newReferred, setNewReferred] = useState('')
  const [newCredit, setNewCredit] = useState('')

  // Settings panel
  const [settingsForm, setSettingsForm] = useState<ReferralSettings | null>(null)
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsError, setSettingsError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setTopError(null)
    try {
      const [refRes, orgRes] = await Promise.all([
        fetch('/api/v1/admin/billing/referrals'),
        fetch('/api/v1/organizations'),
      ])
      const refBody = await refRes.json()
      const orgBody = await orgRes.json()
      if (!refRes.ok) {
        setTopError(refBody?.error ?? 'Failed to load referrals')
        setReferrals([])
      } else {
        const data = refBody.data ?? {}
        setReferrals(data.referrals ?? [])
        setSettings(data.settings ?? null)
        setSettingsForm(data.settings ?? null)
        setSummary(data.summary ?? null)
      }
      if (orgRes.ok) {
        const list = (orgBody.data ?? []) as Array<{ id: string; name?: string }>
        setOrgs(list.map((o) => ({ id: o.id, name: o.name ?? o.id })))
      }
    } catch (err) {
      setTopError(err instanceof Error ? err.message : 'Failed to load referrals')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const filtered = useMemo(
    () => (filter === 'all' ? referrals : referrals.filter((r) => r.status === filter)),
    [referrals, filter],
  )

  const selected = useMemo(
    () => referrals.find((r) => r.id === selectedId) ?? null,
    [referrals, selectedId],
  )

  function openDetail(r: Referral) {
    setSelectedId(r.id ?? null)
    setDisputeReason(r.disputeReason ?? '')
    setNotice(null)
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreateError(null)
    setNotice(null)
    if (!newReferrer) return setCreateError('Select a referrer org')
    if (!newReferred) return setCreateError('Select a referred org')
    if (newReferrer === newReferred) return setCreateError('Referrer and referred must differ')
    const credit = Number(newCredit)
    if (!Number.isFinite(credit) || credit <= 0) return setCreateError('Credit must be greater than 0')

    setCreating(true)
    try {
      const res = await fetch('/api/v1/admin/billing/referrals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          referrerOrgId: newReferrer,
          referredOrgId: newReferred,
          creditZar: credit,
        }),
      })
      const body = await res.json()
      if (!res.ok) {
        setCreateError(body?.error ?? 'Failed to create referral')
        return
      }
      setNotice('Referral created.')
      setShowCreate(false)
      setNewReferrer('')
      setNewReferred('')
      setNewCredit('')
      await load()
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create referral')
    } finally {
      setCreating(false)
    }
  }

  async function runAction(action: 'approve' | 'dispute' | 'mark_paid') {
    if (!selected?.id) return
    if (action === 'dispute' && !disputeReason.trim()) {
      setTopError('A reason is required to dispute.')
      return
    }
    setBusy(true)
    setTopError(null)
    setNotice(null)
    try {
      const payload: Record<string, unknown> = { action }
      if (action === 'dispute') payload.disputeReason = disputeReason.trim()
      const res = await fetch(`/api/v1/admin/billing/referrals/${selected.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'Action failed')
      setNotice(`Referral ${action === 'mark_paid' ? 'marked paid' : action + 'd'}.`)
      await load()
    } catch (err) {
      setTopError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  function patchSettings(patch: Partial<ReferralSettings>) {
    setSettingsForm((prev) => (prev ? { ...prev, ...patch } : prev))
  }

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault()
    if (!settingsForm) return
    setSettingsError(null)
    setNotice(null)
    setSavingSettings(true)
    try {
      const res = await fetch('/api/v1/admin/billing/referrals/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          referrerCreditZar: Number(settingsForm.referrerCreditZar),
          referredCreditZar: Number(settingsForm.referredCreditZar),
          minPaidInvoices: Number(settingsForm.minPaidInvoices),
          requireApproval: settingsForm.requireApproval,
          active: settingsForm.active,
        }),
      })
      const body = await res.json()
      if (!res.ok) {
        setSettingsError(body?.error ?? 'Failed to save settings')
        return
      }
      setSettings(body.data ?? settingsForm)
      setSettingsForm(body.data ?? settingsForm)
      setNotice('Referral settings saved.')
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setSavingSettings(false)
    }
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">
            Billing / Referrals
          </p>
          <h1 className="text-2xl font-headline font-bold text-on-surface">Referral Credits</h1>
          <p className="text-sm text-on-surface-variant mt-0.5">
            Track referral credits between orgs. Payouts are settled offline via EFT / PayPal —
            mark them paid here once the transfer is done. No Stripe.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 self-start md:self-auto">
          <button
            onClick={() => {
              setShowCreate((v) => !v)
              setCreateError(null)
            }}
            className="pib-btn-primary text-sm font-label"
          >
            {showCreate ? 'Cancel' : '+ New referral'}
          </button>
          <Link href="/admin/settings" className="pib-btn-ghost text-sm font-label">
            Back to settings
          </Link>
        </div>
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

      {/* Summary cards */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
        </div>
      ) : summary ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="pib-card p-4">
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
              Pending
            </p>
            <p className="text-2xl font-headline font-bold text-on-surface mt-1">
              {formatZar(summary.pendingCreditZar)}
            </p>
            <p className="text-xs text-on-surface-variant mt-0.5">{summary.pendingCount} awaiting</p>
          </div>
          <div className="pib-card p-4">
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
              Approved (unpaid)
            </p>
            <p className="text-2xl font-headline font-bold text-on-surface mt-1">
              {formatZar(summary.approvedCreditZar)}
            </p>
            <p className="text-xs text-on-surface-variant mt-0.5">{summary.approvedCount} to pay out</p>
          </div>
          <div className="pib-card p-4">
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
              Paid out
            </p>
            <p className="text-2xl font-headline font-bold text-on-surface mt-1">
              {formatZar(summary.paidCreditZar)}
            </p>
            <p className="text-xs text-on-surface-variant mt-0.5">total settled</p>
          </div>
        </div>
      ) : null}

      {/* New referral form */}
      {showCreate && (
        <form onSubmit={handleCreate} className="pib-card p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <label className="block">
              <span className="text-xs font-label uppercase tracking-wide text-on-surface-variant">
                Referrer org
              </span>
              <select
                value={newReferrer}
                onChange={(e) => setNewReferrer(e.target.value)}
                className="pib-input w-full mt-1"
                required
              >
                <option value="">Select org…</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-label uppercase tracking-wide text-on-surface-variant">
                Referred org
              </span>
              <select
                value={newReferred}
                onChange={(e) => setNewReferred(e.target.value)}
                className="pib-input w-full mt-1"
                required
              >
                <option value="">Select org…</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-label uppercase tracking-wide text-on-surface-variant">
                Credit (ZAR)
              </span>
              <input
                type="number"
                min="1"
                step="0.01"
                value={newCredit}
                onChange={(e) => setNewCredit(e.target.value)}
                placeholder={settings ? String(settings.referrerCreditZar) : '500'}
                className="pib-input w-full mt-1"
                required
              />
            </label>
          </div>
          {createError && <p className="text-xs text-red-400">{createError}</p>}
          <div className="flex justify-end">
            <button type="submit" disabled={creating} className="pib-btn-primary text-sm font-label">
              {creating ? 'Creating…' : 'Create referral'}
            </button>
          </div>
        </form>
      )}

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-2">
        {STATUS_TABS.map((tab) => {
          const active = filter === tab.key
          return (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className="text-xs font-label px-3 py-1.5 rounded-full border transition-colors"
              style={{
                borderColor: active ? 'var(--color-accent-v2)' : 'rgba(255,255,255,0.12)',
                background: active ? 'var(--color-accent-v2)' : 'transparent',
                color: active ? '#fff' : undefined,
              }}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Table */}
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-14 rounded-xl" />
          <Skeleton className="h-14 rounded-xl" />
          <Skeleton className="h-14 rounded-xl" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="pib-card p-6 text-center text-sm text-on-surface-variant">
          {referrals.length === 0
            ? 'No referrals yet. Create one above.'
            : `No ${filter} referrals.`}
        </div>
      ) : (
        <div className="pib-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-on-surface/10 text-left">
                  <th className="px-4 py-3 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Referrer</th>
                  <th className="px-4 py-3 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Referred</th>
                  <th className="px-4 py-3 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Credit</th>
                  <th className="px-4 py-3 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Status</th>
                  <th className="px-4 py-3 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Created</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => openDetail(r)}
                    className={`border-b border-on-surface/5 last:border-0 cursor-pointer hover:bg-on-surface/[0.03] ${
                      selectedId === r.id ? 'bg-on-surface/[0.05]' : ''
                    }`}
                  >
                    <td className="px-4 py-3 text-on-surface">{r.referrerName ?? r.referrerOrgId}</td>
                    <td className="px-4 py-3 text-on-surface-variant">{r.referredName ?? r.referredOrgId}</td>
                    <td className="px-4 py-3 text-on-surface">{formatZar(r.creditZar)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-4 py-3 text-on-surface-variant">
                      {formatDate(tsToMillis(r.createdAt))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Detail panel */}
      {selected && (
        <div className="pib-card p-5 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">
                Referral detail
              </p>
              <h2 className="text-lg font-headline font-bold text-on-surface">
                {selected.referrerName ?? selected.referrerOrgId}
                <span className="text-on-surface-variant"> → </span>
                {selected.referredName ?? selected.referredOrgId}
              </h2>
            </div>
            <button
              onClick={() => setSelectedId(null)}
              className="pib-btn-ghost text-xs font-label"
            >
              Close
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Credit</p>
              <p className="text-on-surface mt-0.5">{formatZar(selected.creditZar)}</p>
            </div>
            <div>
              <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Status</p>
              <div className="mt-1"><StatusBadge status={selected.status} /></div>
            </div>
            <div>
              <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Approved</p>
              <p className="text-on-surface-variant mt-0.5">{formatDate(tsToMillis(selected.approvedAt))}</p>
            </div>
            <div>
              <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Paid</p>
              <p className="text-on-surface-variant mt-0.5">{formatDate(tsToMillis(selected.paidAt))}</p>
            </div>
          </div>

          {selected.status === 'disputed' && selected.disputeReason && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-400">
              Dispute reason: {selected.disputeReason}
            </div>
          )}

          {/* Dispute reason input — shown when disputing is possible */}
          {selected.status !== 'paid' && (
            <label className="block">
              <span className="text-xs font-label uppercase tracking-wide text-on-surface-variant">
                Dispute reason (required to dispute)
              </span>
              <textarea
                value={disputeReason}
                onChange={(e) => setDisputeReason(e.target.value)}
                placeholder="e.g. Referred org cancelled before first paid invoice"
                className="pib-input w-full mt-1"
                rows={2}
              />
            </label>
          )}

          <div className="flex flex-wrap gap-2">
            {(selected.status === 'pending' || selected.status === 'disputed') && (
              <button
                onClick={() => runAction('approve')}
                disabled={busy}
                className="pib-btn-primary text-sm font-label disabled:opacity-50"
              >
                {busy ? 'Working…' : 'Approve'}
              </button>
            )}
            {selected.status === 'approved' && (
              <button
                onClick={() => runAction('mark_paid')}
                disabled={busy}
                className="pib-btn-primary text-sm font-label disabled:opacity-50"
              >
                {busy ? 'Working…' : 'Mark paid (EFT/PayPal)'}
              </button>
            )}
            {selected.status !== 'paid' && selected.status !== 'disputed' && (
              <button
                onClick={() => runAction('dispute')}
                disabled={busy}
                className="text-sm font-label px-3 py-1.5 rounded-lg text-red-400 hover:bg-red-500/10 disabled:opacity-50"
              >
                Dispute
              </button>
            )}
          </div>
        </div>
      )}

      {/* Settings panel */}
      <div className="pib-card p-5">
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">
          Programme settings
        </p>
        <h2 className="text-lg font-headline font-bold text-on-surface mb-4">Referral Settings</h2>
        {loading || !settingsForm ? (
          <Skeleton className="h-40 rounded-xl" />
        ) : (
          <form onSubmit={saveSettings} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <label className="block">
                <span className="text-xs font-label uppercase tracking-wide text-on-surface-variant">
                  Referrer credit (ZAR)
                </span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={settingsForm.referrerCreditZar}
                  onChange={(e) => patchSettings({ referrerCreditZar: Number(e.target.value) })}
                  className="pib-input w-full mt-1"
                />
              </label>
              <label className="block">
                <span className="text-xs font-label uppercase tracking-wide text-on-surface-variant">
                  Referred credit (ZAR)
                </span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={settingsForm.referredCreditZar}
                  onChange={(e) => patchSettings({ referredCreditZar: Number(e.target.value) })}
                  className="pib-input w-full mt-1"
                />
              </label>
              <label className="block">
                <span className="text-xs font-label uppercase tracking-wide text-on-surface-variant">
                  Min paid invoices to qualify
                </span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={settingsForm.minPaidInvoices}
                  onChange={(e) => patchSettings({ minPaidInvoices: Number(e.target.value) })}
                  className="pib-input w-full mt-1"
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-6">
              <label className="flex items-center gap-2 text-sm text-on-surface">
                <input
                  type="checkbox"
                  checked={settingsForm.requireApproval}
                  onChange={(e) => patchSettings({ requireApproval: e.target.checked })}
                />
                Require manual approval for new referrals
              </label>
              <label className="flex items-center gap-2 text-sm text-on-surface">
                <input
                  type="checkbox"
                  checked={settingsForm.active}
                  onChange={(e) => patchSettings({ active: e.target.checked })}
                />
                Programme active
              </label>
            </div>
            {settingsError && <p className="text-xs text-red-400">{settingsError}</p>}
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={savingSettings}
                className="pib-btn-primary text-sm font-label disabled:opacity-50"
              >
                {savingSettings ? 'Saving…' : 'Save settings'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
