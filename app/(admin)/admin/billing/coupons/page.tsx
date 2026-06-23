'use client'

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { formatZar, formatDate, tsToMillis } from '@/lib/billing/format'
import type { Coupon, CouponType, CouponDuration } from '@/lib/billing/types'

interface PlanOption {
  id: string
  key: string
  name: string
}

interface UsageRow {
  id: string
  orgId: string
  orgName: string
  invoiceId: string | null
  discountZar: number
  redeemedBy: string
  createdAt: number | null
}

const DURATION_LABELS: Record<CouponDuration, string> = {
  once: 'Once',
  repeating: 'Repeating',
  forever: 'Forever',
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

function couponValueLabel(coupon: Coupon): string {
  return coupon.type === 'percent' ? `${coupon.value}%` : formatZar(coupon.value)
}

interface NewCouponForm {
  code: string
  type: CouponType
  value: string
  duration: CouponDuration
  durationMonths: string
  maxRedemptions: string
  expiresAt: string
  appliesToPlanKeys: string[]
  notes: string
}

const EMPTY_FORM: NewCouponForm = {
  code: '',
  type: 'percent',
  value: '',
  duration: 'once',
  durationMonths: '',
  maxRedemptions: '',
  expiresAt: '',
  appliesToPlanKeys: [],
  notes: '',
}

export default function CouponsPage() {
  const [coupons, setCoupons] = useState<Coupon[]>([])
  const [plans, setPlans] = useState<PlanOption[]>([])
  const [loading, setLoading] = useState(true)
  const [topError, setTopError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState<NewCouponForm>(EMPTY_FORM)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const [busyId, setBusyId] = useState<string | null>(null)

  // Usage panel state.
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [usageRows, setUsageRows] = useState<UsageRow[]>([])
  const [usageLoading, setUsageLoading] = useState(false)
  const [usageError, setUsageError] = useState<string | null>(null)

  const planKeyToName = useMemo(() => {
    const map = new Map<string, string>()
    plans.forEach((p) => map.set(p.key, p.name))
    return map
  }, [plans])

  async function load() {
    setLoading(true)
    setTopError(null)
    try {
      const [couponsRes, plansRes] = await Promise.all([
        fetch('/api/v1/admin/billing/coupons'),
        fetch('/api/v1/admin/plans'),
      ])
      const couponsBody = await couponsRes.json()
      const plansBody = await plansRes.json()
      if (!couponsRes.ok) {
        setTopError(couponsBody?.error ?? 'Failed to load coupons')
        setCoupons([])
      } else {
        setCoupons(couponsBody.data ?? [])
      }
      if (plansRes.ok) {
        const list = (plansBody.data ?? []) as Array<{ id: string; key: string; name: string }>
        setPlans(list.map((p) => ({ id: p.id, key: p.key, name: p.name })))
      }
    } catch (err) {
      setTopError(err instanceof Error ? err.message : 'Failed to load coupons')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  function patchForm(patch: Partial<NewCouponForm>) {
    setForm((prev) => ({ ...prev, ...patch }))
  }

  function togglePlanKey(key: string) {
    setForm((prev) => ({
      ...prev,
      appliesToPlanKeys: prev.appliesToPlanKeys.includes(key)
        ? prev.appliesToPlanKeys.filter((k) => k !== key)
        : [...prev.appliesToPlanKeys, key],
    }))
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreateError(null)
    setNotice(null)

    const code = form.code.trim().toUpperCase()
    if (!code) {
      setCreateError('Coupon code is required')
      return
    }
    if (!/^[A-Z0-9_-]+$/.test(code)) {
      setCreateError('Code may only contain letters, numbers, hyphens and underscores')
      return
    }
    const value = Number(form.value)
    if (!Number.isFinite(value) || value <= 0) {
      setCreateError('Value must be a number greater than 0')
      return
    }
    if (form.type === 'percent' && value > 100) {
      setCreateError('Percent value cannot exceed 100')
      return
    }

    setCreating(true)
    try {
      const payload: Record<string, unknown> = {
        code,
        type: form.type,
        value,
        duration: form.duration,
        appliesToPlanKeys: form.appliesToPlanKeys,
        notes: form.notes.trim(),
      }
      if (form.duration === 'repeating' && form.durationMonths.trim()) {
        payload.durationMonths = Number(form.durationMonths)
      }
      if (form.maxRedemptions.trim()) {
        payload.maxRedemptions = Number(form.maxRedemptions)
      }
      if (form.expiresAt) {
        payload.expiresAt = form.expiresAt
      }

      const res = await fetch('/api/v1/admin/billing/coupons', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json()
      if (!res.ok) {
        setCreateError(body?.error ?? 'Failed to create coupon')
        return
      }
      setNotice(`Coupon ${code} created.`)
      setForm(EMPTY_FORM)
      setShowCreate(false)
      await load()
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create coupon')
    } finally {
      setCreating(false)
    }
  }

  async function toggleActive(coupon: Coupon) {
    if (!coupon.id) return
    setBusyId(coupon.id)
    setTopError(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/v1/admin/billing/coupons/${coupon.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ active: !coupon.active }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'Failed to update coupon')
      setNotice(`${coupon.code} is now ${!coupon.active ? 'active' : 'inactive'}.`)
      await load()
    } catch (err) {
      setTopError(err instanceof Error ? err.message : 'Failed to update coupon')
    } finally {
      setBusyId(null)
    }
  }

  async function deleteCoupon(coupon: Coupon) {
    if (!coupon.id) return
    if (!window.confirm(`Delete coupon ${coupon.code}? This cannot be undone.`)) return
    setBusyId(coupon.id)
    setTopError(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/v1/admin/billing/coupons/${coupon.id}`, { method: 'DELETE' })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'Failed to delete coupon')
      setNotice(`Coupon ${coupon.code} deleted.`)
      if (expandedId === coupon.id) setExpandedId(null)
      await load()
    } catch (err) {
      setTopError(err instanceof Error ? err.message : 'Failed to delete coupon')
    } finally {
      setBusyId(null)
    }
  }

  async function toggleUsage(coupon: Coupon) {
    if (!coupon.id) return
    if (expandedId === coupon.id) {
      setExpandedId(null)
      return
    }
    setExpandedId(coupon.id)
    setUsageRows([])
    setUsageError(null)
    setUsageLoading(true)
    try {
      const res = await fetch(`/api/v1/admin/billing/coupons/${coupon.id}/usage`)
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'Failed to load usage history')
      setUsageRows(body.data ?? [])
    } catch (err) {
      setUsageError(err instanceof Error ? err.message : 'Failed to load usage history')
    } finally {
      setUsageLoading(false)
    }
  }

  function planScopeLabel(coupon: Coupon): string {
    const keys = coupon.appliesToPlanKeys ?? []
    if (keys.length === 0) return 'All plans'
    return keys.map((k) => planKeyToName.get(k) ?? k).join(', ')
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">
            Billing / Coupons
          </p>
          <h1 className="text-2xl font-headline font-bold text-on-surface">Discount Coupons</h1>
          <p className="text-sm text-on-surface-variant mt-0.5">
            Manual EFT / PayPal discount codes applied to platform invoices. No Stripe — discounts
            are applied when an operator or agent raises an invoice for an org.
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
            {showCreate ? 'Cancel' : '+ New coupon'}
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

      {showCreate && (
        <form onSubmit={handleCreate} className="pib-card p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-xs font-label uppercase tracking-wide text-on-surface-variant">
                Code
              </span>
              <input
                type="text"
                value={form.code}
                onChange={(e) => patchForm({ code: e.target.value.toUpperCase() })}
                placeholder="LAUNCH20"
                className="pib-input w-full mt-1 font-mono"
                required
              />
            </label>
            <label className="block">
              <span className="text-xs font-label uppercase tracking-wide text-on-surface-variant">
                Type
              </span>
              <select
                value={form.type}
                onChange={(e) => patchForm({ type: e.target.value as CouponType })}
                className="pib-input w-full mt-1"
              >
                <option value="percent">Percent (%)</option>
                <option value="fixed">Fixed (ZAR)</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-label uppercase tracking-wide text-on-surface-variant">
                {form.type === 'percent' ? 'Value (% off, 1–100)' : 'Value (ZAR off)'}
              </span>
              <input
                type="number"
                min="1"
                step={form.type === 'percent' ? '1' : '0.01'}
                value={form.value}
                onChange={(e) => patchForm({ value: e.target.value })}
                placeholder={form.type === 'percent' ? '20' : '500'}
                className="pib-input w-full mt-1"
                required
              />
            </label>
            <label className="block">
              <span className="text-xs font-label uppercase tracking-wide text-on-surface-variant">
                Duration
              </span>
              <select
                value={form.duration}
                onChange={(e) => patchForm({ duration: e.target.value as CouponDuration })}
                className="pib-input w-full mt-1"
              >
                <option value="once">Once</option>
                <option value="repeating">Repeating</option>
                <option value="forever">Forever</option>
              </select>
            </label>
            {form.duration === 'repeating' && (
              <label className="block">
                <span className="text-xs font-label uppercase tracking-wide text-on-surface-variant">
                  Duration (billing periods)
                </span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={form.durationMonths}
                  onChange={(e) => patchForm({ durationMonths: e.target.value })}
                  placeholder="3"
                  className="pib-input w-full mt-1"
                />
              </label>
            )}
            <label className="block">
              <span className="text-xs font-label uppercase tracking-wide text-on-surface-variant">
                Max redemptions (optional)
              </span>
              <input
                type="number"
                min="1"
                step="1"
                value={form.maxRedemptions}
                onChange={(e) => patchForm({ maxRedemptions: e.target.value })}
                placeholder="Unlimited"
                className="pib-input w-full mt-1"
              />
            </label>
            <label className="block">
              <span className="text-xs font-label uppercase tracking-wide text-on-surface-variant">
                Expires at (optional)
              </span>
              <input
                type="date"
                value={form.expiresAt}
                onChange={(e) => patchForm({ expiresAt: e.target.value })}
                className="pib-input w-full mt-1"
              />
            </label>
            <div className="block md:col-span-2">
              <span className="text-xs font-label uppercase tracking-wide text-on-surface-variant">
                Applies to plans
              </span>
              {plans.length === 0 ? (
                <p className="text-xs text-on-surface-variant/60 mt-1">
                  No plans loaded — coupon will apply to all plans.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2 mt-2">
                  {plans.map((plan) => {
                    const selected = form.appliesToPlanKeys.includes(plan.key)
                    return (
                      <button
                        type="button"
                        key={plan.id}
                        onClick={() => togglePlanKey(plan.key)}
                        className="text-xs font-label px-3 py-1 rounded-full border transition-colors"
                        style={{
                          borderColor: selected ? 'var(--color-accent-v2)' : 'rgba(255,255,255,0.12)',
                          background: selected ? 'var(--color-accent-v2)' : 'transparent',
                          color: selected ? '#fff' : undefined,
                        }}
                      >
                        {plan.name}
                      </button>
                    )
                  })}
                </div>
              )}
              <p className="text-[11px] text-on-surface-variant/60 mt-1">
                Leave empty to apply to all plans.
              </p>
            </div>
            <label className="block md:col-span-2">
              <span className="text-xs font-label uppercase tracking-wide text-on-surface-variant">
                Notes (optional)
              </span>
              <textarea
                value={form.notes}
                onChange={(e) => patchForm({ notes: e.target.value })}
                placeholder="Internal note — e.g. Q3 launch promo for new EFT customers"
                className="pib-input w-full mt-1"
                rows={2}
              />
            </label>
          </div>
          {createError && <p className="text-xs text-red-400">{createError}</p>}
          <div className="flex justify-end">
            <button type="submit" disabled={creating} className="pib-btn-primary text-sm font-label">
              {creating ? 'Creating...' : 'Create coupon'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-14 rounded-xl" />
          <Skeleton className="h-14 rounded-xl" />
          <Skeleton className="h-14 rounded-xl" />
        </div>
      ) : coupons.length === 0 ? (
        <div className="pib-card p-6 text-center text-sm text-on-surface-variant">
          No coupons yet. Create your first discount code above.
        </div>
      ) : (
        <div className="pib-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-on-surface/10 text-left">
                  <th className="px-4 py-3 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Code</th>
                  <th className="px-4 py-3 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Value</th>
                  <th className="px-4 py-3 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Duration</th>
                  <th className="px-4 py-3 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Redemptions</th>
                  <th className="px-4 py-3 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Expires</th>
                  <th className="px-4 py-3 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Plans</th>
                  <th className="px-4 py-3 text-[10px] font-label uppercase tracking-widest text-on-surface-variant text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {coupons.map((coupon) => {
                  const busy = busyId === coupon.id
                  const expanded = expandedId === coupon.id
                  const durationLabel =
                    coupon.duration === 'repeating' && coupon.durationMonths
                      ? `${DURATION_LABELS[coupon.duration]} · ${coupon.durationMonths}×`
                      : DURATION_LABELS[coupon.duration]
                  return (
                    <Fragment key={coupon.id}>
                      <tr className="border-b border-on-surface/5 last:border-0">
                        <td className="px-4 py-3">
                          <span className="font-mono font-semibold text-on-surface">{coupon.code}</span>
                          {coupon.notes ? (
                            <p className="text-[11px] text-on-surface-variant/60 truncate max-w-[200px]">{coupon.notes}</p>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-on-surface">{couponValueLabel(coupon)}</td>
                        <td className="px-4 py-3 text-on-surface-variant">{durationLabel}</td>
                        <td className="px-4 py-3 text-on-surface-variant">
                          {coupon.redemptions ?? 0}
                          {coupon.maxRedemptions ? ` / ${coupon.maxRedemptions}` : ''}
                        </td>
                        <td className="px-4 py-3 text-on-surface-variant">
                          {formatDate(tsToMillis(coupon.expiresAt))}
                        </td>
                        <td className="px-4 py-3 text-on-surface-variant max-w-[160px] truncate" title={planScopeLabel(coupon)}>
                          {planScopeLabel(coupon)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-2 justify-end">
                            <button
                              onClick={() => toggleActive(coupon)}
                              disabled={busy}
                              className="text-xs font-label px-2.5 py-1 rounded-full"
                              style={{
                                background: coupon.active ? 'rgba(34,197,94,0.12)' : 'rgba(148,163,184,0.12)',
                                color: coupon.active ? '#4ade80' : '#94a3b8',
                              }}
                              title="Toggle active"
                            >
                              {coupon.active ? 'Active' : 'Inactive'}
                            </button>
                            <button
                              onClick={() => toggleUsage(coupon)}
                              disabled={busy}
                              className="pib-btn-ghost text-xs font-label"
                            >
                              {expanded ? 'Hide usage' : 'Usage'}
                            </button>
                            <button
                              onClick={() => deleteCoupon(coupon)}
                              disabled={busy}
                              className="text-xs font-label px-2.5 py-1 rounded-full text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expanded && (
                        <tr>
                          <td colSpan={7} className="px-4 py-3 bg-on-surface/[0.03]">
                            {usageLoading ? (
                              <div className="space-y-2">
                                <Skeleton className="h-8 rounded-lg" />
                                <Skeleton className="h-8 rounded-lg" />
                              </div>
                            ) : usageError ? (
                              <p className="text-xs text-red-400">{usageError}</p>
                            ) : usageRows.length === 0 ? (
                              <p className="text-xs text-on-surface-variant">No redemptions yet for this coupon.</p>
                            ) : (
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-left text-on-surface-variant/70">
                                    <th className="py-1.5 pr-4 font-label uppercase tracking-wide">Org</th>
                                    <th className="py-1.5 pr-4 font-label uppercase tracking-wide">Invoice</th>
                                    <th className="py-1.5 pr-4 font-label uppercase tracking-wide">Discount</th>
                                    <th className="py-1.5 pr-4 font-label uppercase tracking-wide">Redeemed by</th>
                                    <th className="py-1.5 pr-4 font-label uppercase tracking-wide">When</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {usageRows.map((row) => (
                                    <tr key={row.id} className="border-t border-on-surface/5">
                                      <td className="py-1.5 pr-4 text-on-surface">{row.orgName}</td>
                                      <td className="py-1.5 pr-4 text-on-surface-variant font-mono">{row.invoiceId ?? '—'}</td>
                                      <td className="py-1.5 pr-4 text-on-surface">{formatZar(row.discountZar)}</td>
                                      <td className="py-1.5 pr-4 text-on-surface-variant">{row.redeemedBy || '—'}</td>
                                      <td className="py-1.5 pr-4 text-on-surface-variant">{formatDate(row.createdAt)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
