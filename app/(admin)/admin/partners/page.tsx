'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { formatZar, formatDate, tsToMillis } from '@/lib/billing/format'

type PartnerStatus = 'pending' | 'approved' | 'rejected' | 'suspended'

interface PartnerApplication {
  id: string
  companyName: string
  contactName: string
  email: string
  phone?: string
  website?: string
  pitch?: string
  expectedVolume?: string
  status: PartnerStatus
  commissionPercent?: number
  payoutMethod?: 'eft' | 'paypal'
  rejectionReason?: string | null
  referralsCount?: number
  totalCommissionZar?: number
  createdAt?: unknown
  reviewedAt?: unknown
}

interface Summary {
  pendingCount: number
  approvedCount: number
  totalCommissionZar: number
  avgCommissionPercent: number
}

const STATUS_FILTERS: Array<{ key: PartnerStatus | 'all'; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'suspended', label: 'Suspended' },
  { key: 'rejected', label: 'Rejected' },
]

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

function StatusBadge({ status }: { status: PartnerStatus }) {
  const colors: Record<PartnerStatus, string> = {
    pending: '#d97706',
    approved: '#16a34a',
    rejected: '#dc2626',
    suspended: '#6b7280',
  }
  return (
    <span
      className="text-[10px] font-label uppercase tracking-wide px-2 py-0.5 rounded-full"
      style={{ background: `${colors[status]}20`, color: colors[status] }}
    >
      {status}
    </span>
  )
}

export default function AdminPartnersPage() {
  const [applications, setApplications] = useState<PartnerApplication[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [defaultCommission, setDefaultCommission] = useState(20)
  const [loading, setLoading] = useState(true)
  const [topError, setTopError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [filter, setFilter] = useState<PartnerStatus | 'all'>('all')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Review-panel action state
  const [commissionInput, setCommissionInput] = useState('')
  const [payoutMethod, setPayoutMethod] = useState<'eft' | 'paypal'>('eft')
  const [rejectionReason, setRejectionReason] = useState('')
  const [panelError, setPanelError] = useState<string | null>(null)

  // New applicant form
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [form, setForm] = useState({
    companyName: '',
    contactName: '',
    email: '',
    phone: '',
    website: '',
    expectedVolume: '',
    pitch: '',
  })

  async function load() {
    setLoading(true)
    setTopError(null)
    try {
      const res = await fetch('/api/v1/admin/partners')
      const body = await res.json()
      if (!res.ok) {
        setTopError(body?.error ?? 'Failed to load partners')
        setApplications([])
        setSummary(null)
      } else {
        const data = body.data ?? body
        setApplications(data.applications ?? [])
        setSummary(data.summary ?? null)
        if (typeof data.defaultCommissionPercent === 'number') {
          setDefaultCommission(data.defaultCommissionPercent)
        }
      }
    } catch (err) {
      setTopError(err instanceof Error ? err.message : 'Failed to load partners')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const selected = useMemo(
    () => applications.find((a) => a.id === selectedId) ?? null,
    [applications, selectedId],
  )

  // Seed the review-panel inputs when a new applicant is selected.
  useEffect(() => {
    if (!selected) return
    setCommissionInput(
      typeof selected.commissionPercent === 'number'
        ? String(selected.commissionPercent)
        : String(defaultCommission),
    )
    setPayoutMethod(selected.payoutMethod ?? 'eft')
    setRejectionReason('')
    setPanelError(null)
  }, [selectedId, selected, defaultCommission])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return applications.filter((a) => {
      if (filter !== 'all' && a.status !== filter) return false
      if (!q) return true
      return [a.companyName, a.contactName, a.email, a.expectedVolume]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q)
    })
  }, [applications, filter, search])

  const activePartners = useMemo(
    () => applications.filter((a) => a.status === 'approved'),
    [applications],
  )

  async function runAction(action: 'approve' | 'reject' | 'suspend') {
    if (!selected) return
    setPanelError(null)
    setNotice(null)

    const payload: Record<string, unknown> = { action }
    if (action === 'approve') {
      const commissionPercent = Number(commissionInput)
      if (!Number.isFinite(commissionPercent) || commissionPercent < 0 || commissionPercent > 100) {
        setPanelError('Commission must be between 0 and 100')
        return
      }
      payload.commissionPercent = commissionPercent
      payload.payoutMethod = payoutMethod
    }
    if (action === 'reject') {
      if (!rejectionReason.trim()) {
        setPanelError('A rejection reason is required')
        return
      }
      payload.rejectionReason = rejectionReason.trim()
    }

    setBusy(true)
    try {
      const res = await fetch(`/api/v1/admin/partners/${selected.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json()
      if (!res.ok) {
        setPanelError(body?.error ?? `Failed to ${action} partner`)
        return
      }
      const data = body.data ?? body
      const emailNote =
        data.emailStatus === 'queued'
          ? ' (email queued — provider not configured)'
          : data.emailStatus === 'sent'
            ? ' and applicant emailed'
            : ''
      setNotice(`${selected.companyName} ${action}d${emailNote}.`)
      await load()
    } catch (err) {
      setPanelError(err instanceof Error ? err.message : `Failed to ${action} partner`)
    } finally {
      setBusy(false)
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreateError(null)
    setNotice(null)
    if (!form.companyName.trim() || !form.contactName.trim() || !form.email.trim()) {
      setCreateError('Company, contact and email are required')
      return
    }
    setCreating(true)
    try {
      const res = await fetch('/api/v1/admin/partners', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          companyName: form.companyName.trim(),
          contactName: form.contactName.trim(),
          email: form.email.trim(),
          phone: form.phone.trim() || undefined,
          website: form.website.trim() || undefined,
          expectedVolume: form.expectedVolume.trim() || undefined,
          pitch: form.pitch.trim() || undefined,
        }),
      })
      const body = await res.json()
      if (!res.ok) {
        setCreateError(body?.error ?? 'Failed to add applicant')
        return
      }
      setNotice(`Applicant ${form.companyName.trim()} added.`)
      setForm({
        companyName: '',
        contactName: '',
        email: '',
        phone: '',
        website: '',
        expectedVolume: '',
        pitch: '',
      })
      setShowCreate(false)
      await load()
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to add applicant')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">
            Billing / Partner programme
          </p>
          <h1 className="text-2xl font-headline font-bold text-on-surface">Partners</h1>
          <p className="text-sm text-on-surface-variant mt-0.5">
            Review partner applications, set commission rates, and track referral payouts. Payouts
            settle offline via EFT / PayPal.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 self-start md:self-auto">
          <button
            onClick={() => setShowCreate((v) => !v)}
            className="pib-btn-primary text-sm font-label"
          >
            {showCreate ? 'Cancel' : '+ New applicant'}
          </button>
          <a href="/api/v1/admin/partners/export" className="pib-btn-ghost text-sm font-label">
            Export CSV
          </a>
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

      {showCreate && (
        <form onSubmit={handleCreate} className="pib-card p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { key: 'companyName', label: 'Company', placeholder: 'Acme Agency', required: true },
              { key: 'contactName', label: 'Contact', placeholder: 'Jane Doe', required: true },
              { key: 'email', label: 'Email', placeholder: 'jane@acme.co.za', required: true, type: 'email' },
              { key: 'phone', label: 'Phone', placeholder: '+27 ...' },
              { key: 'website', label: 'Website', placeholder: 'https://acme.co.za' },
              { key: 'expectedVolume', label: 'Expected volume', placeholder: 'e.g. 5–10 referrals / month' },
            ].map((f) => (
              <label key={f.key} className="block">
                <span className="text-xs font-label uppercase tracking-wide text-on-surface-variant">
                  {f.label}
                </span>
                <input
                  type={f.type ?? 'text'}
                  value={form[f.key as keyof typeof form]}
                  onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  className="pib-input w-full mt-1"
                  required={f.required}
                />
              </label>
            ))}
            <label className="block md:col-span-2">
              <span className="text-xs font-label uppercase tracking-wide text-on-surface-variant">
                Pitch
              </span>
              <textarea
                value={form.pitch}
                onChange={(e) => setForm((prev) => ({ ...prev, pitch: e.target.value }))}
                placeholder="Audience, channels, why they want to partner..."
                rows={3}
                className="pib-input w-full mt-1"
              />
            </label>
          </div>
          {createError && <p className="text-xs text-red-400">{createError}</p>}
          <div className="flex justify-end">
            <button type="submit" disabled={creating} className="pib-btn-primary text-sm font-label">
              {creating ? 'Adding...' : 'Add applicant'}
            </button>
          </div>
        </form>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {loading || !summary ? (
          <>
            <Skeleton className="h-20 rounded-xl" />
            <Skeleton className="h-20 rounded-xl" />
            <Skeleton className="h-20 rounded-xl" />
            <Skeleton className="h-20 rounded-xl" />
          </>
        ) : (
          <>
            <div className="pib-card p-4">
              <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Pending</p>
              <p className="text-2xl font-headline font-bold text-on-surface mt-1">{summary.pendingCount}</p>
            </div>
            <div className="pib-card p-4">
              <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Active partners</p>
              <p className="text-2xl font-headline font-bold text-on-surface mt-1">{summary.approvedCount}</p>
            </div>
            <div className="pib-card p-4">
              <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Total commission</p>
              <p className="text-2xl font-headline font-bold text-on-surface mt-1">{formatZar(summary.totalCommissionZar)}</p>
            </div>
            <div className="pib-card p-4">
              <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Avg commission</p>
              <p className="text-2xl font-headline font-bold text-on-surface mt-1">{summary.avgCommissionPercent}%</p>
            </div>
          </>
        )}
      </div>

      {/* Filters + search */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`text-xs font-label px-3 py-1.5 rounded-full transition-colors ${
                filter === f.key
                  ? 'text-on-surface'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
              style={filter === f.key ? { background: 'var(--color-accent-v2)' } : { background: 'rgba(255,255,255,0.06)' }}
            >
              {f.label}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Search company, contact, email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pib-input w-full md:w-72"
        />
      </div>

      {/* Applicant list */}
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-20 rounded-xl" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="pib-card p-6 text-center text-sm text-on-surface-variant">
          {applications.length === 0 ? 'No partner applications yet.' : 'No matches for this filter.'}
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.map((a) => {
            const isSelected = a.id === selectedId
            return (
              <li key={a.id} className="pib-card p-4">
                <button
                  onClick={() => setSelectedId(isSelected ? null : a.id)}
                  className="w-full text-left"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-on-surface truncate">{a.companyName}</p>
                        <StatusBadge status={a.status} />
                      </div>
                      <p className="text-xs text-on-surface-variant truncate">
                        {a.contactName} · {a.email}
                      </p>
                      {a.expectedVolume && (
                        <p className="text-[11px] text-on-surface-variant/60 mt-0.5">
                          Expected volume: {a.expectedVolume}
                        </p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      {a.status === 'approved' && (
                        <p className="text-xs text-on-surface-variant">{a.commissionPercent}% commission</p>
                      )}
                      <p className="text-[11px] text-on-surface-variant/60">
                        Applied {formatDate(tsToMillis(a.createdAt))}
                      </p>
                    </div>
                  </div>
                </button>

                {isSelected && selected && (
                  <div className="mt-4 rounded-md border border-on-surface/10 bg-on-surface/5 p-4 space-y-4">
                    {/* Detail */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      {selected.phone && (
                        <div>
                          <span className="text-on-surface-variant/60 uppercase font-label text-[10px]">Phone</span>
                          <p className="text-on-surface">{selected.phone}</p>
                        </div>
                      )}
                      {selected.website && (
                        <div>
                          <span className="text-on-surface-variant/60 uppercase font-label text-[10px]">Website</span>
                          <p className="text-on-surface break-all">{selected.website}</p>
                        </div>
                      )}
                      {selected.pitch && (
                        <div className="sm:col-span-2">
                          <span className="text-on-surface-variant/60 uppercase font-label text-[10px]">Pitch</span>
                          <p className="text-on-surface whitespace-pre-wrap">{selected.pitch}</p>
                        </div>
                      )}
                      {selected.status === 'rejected' && selected.rejectionReason && (
                        <div className="sm:col-span-2">
                          <span className="text-on-surface-variant/60 uppercase font-label text-[10px]">Rejection reason</span>
                          <p className="text-red-400">{selected.rejectionReason}</p>
                        </div>
                      )}
                    </div>

                    {panelError && <p className="text-xs text-red-400">{panelError}</p>}

                    {/* Actions */}
                    {(selected.status === 'pending' || selected.status === 'suspended') && (
                      <div className="space-y-3 border-t border-on-surface/10 pt-3">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <label className="block">
                            <span className="text-[10px] font-label uppercase tracking-wide text-on-surface-variant">
                              Commission %
                            </span>
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step="0.5"
                              value={commissionInput}
                              onChange={(e) => setCommissionInput(e.target.value)}
                              className="pib-input w-full mt-1"
                            />
                          </label>
                          <label className="block">
                            <span className="text-[10px] font-label uppercase tracking-wide text-on-surface-variant">
                              Payout method
                            </span>
                            <select
                              value={payoutMethod}
                              onChange={(e) => setPayoutMethod(e.target.value as 'eft' | 'paypal')}
                              className="pib-input w-full mt-1"
                            >
                              <option value="eft">EFT</option>
                              <option value="paypal">PayPal</option>
                            </select>
                          </label>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => runAction('approve')}
                            disabled={busy}
                            className="pib-btn-primary text-xs font-label"
                          >
                            {busy ? 'Working...' : 'Approve'}
                          </button>
                        </div>
                      </div>
                    )}

                    {selected.status === 'approved' && (
                      <div className="flex flex-wrap gap-2 border-t border-on-surface/10 pt-3">
                        <button
                          onClick={() => runAction('suspend')}
                          disabled={busy}
                          className="pib-btn-secondary text-xs font-label"
                        >
                          {busy ? 'Working...' : 'Suspend'}
                        </button>
                      </div>
                    )}

                    {selected.status !== 'rejected' && (
                      <div className="space-y-2 border-t border-on-surface/10 pt-3">
                        <label className="block">
                          <span className="text-[10px] font-label uppercase tracking-wide text-on-surface-variant">
                            Rejection reason
                          </span>
                          <input
                            type="text"
                            value={rejectionReason}
                            onChange={(e) => setRejectionReason(e.target.value)}
                            placeholder="Why this application is declined"
                            className="pib-input w-full mt-1"
                          />
                        </label>
                        <button
                          onClick={() => runAction('reject')}
                          disabled={busy}
                          className="pib-btn-ghost text-xs font-label text-red-400"
                        >
                          {busy ? 'Working...' : 'Reject'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {/* Active partners section */}
      {!loading && activePartners.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-headline font-bold text-on-surface">Active partners</h2>
          <div className="pib-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] font-label uppercase tracking-wide text-on-surface-variant border-b border-on-surface/10">
                  <th className="px-4 py-2">Company</th>
                  <th className="px-4 py-2">Commission</th>
                  <th className="px-4 py-2 text-right">Referrals</th>
                  <th className="px-4 py-2 text-right">Total commission</th>
                </tr>
              </thead>
              <tbody>
                {activePartners.map((a) => (
                  <tr key={a.id} className="border-b border-on-surface/5 last:border-0">
                    <td className="px-4 py-2 text-on-surface">{a.companyName}</td>
                    <td className="px-4 py-2 text-on-surface-variant">{a.commissionPercent}%</td>
                    <td className="px-4 py-2 text-right text-on-surface-variant">{a.referralsCount ?? 0}</td>
                    <td className="px-4 py-2 text-right text-on-surface">{formatZar(a.totalCommissionZar ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
