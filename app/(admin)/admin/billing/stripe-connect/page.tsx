'use client'

export const dynamic = 'force-dynamic'

/**
 * US-306 (ADAPTED) — Partner payout settings.
 *
 * The original story shipped a "Stripe Connect" partner-payout onboarding flow.
 * Partners in Biz does NOT use Stripe (EFT-first / PayPal-second), so there is
 * no Stripe Connect onboarding. The route is kept (/admin/billing/stripe-connect)
 * but the content is fully adapted: partner commissions are paid via EFT or
 * PayPal transfer — manual, tracked here — and this page configures the payout
 * policy and shows who is owed.
 */

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { formatZar } from '@/lib/billing/format'
import type { PayoutSettings, PayoutDetails } from '@/lib/billing/types'

interface PartnerView {
  partnerId: string
  companyName: string
  contactName: string
  email: string
  payoutMethod: 'eft' | 'paypal' | null
  payoutDetails: PayoutDetails | null
  commissionPercent: number | null
  referralsCount: number
  totalCommissionZar: number
}

interface OwedView {
  partnerId: string
  companyName: string
  payoutMethod: 'eft' | 'paypal' | null
  owedZar: number
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

function methodLabel(method: 'eft' | 'paypal' | null): string {
  if (method === 'eft') return 'EFT'
  if (method === 'paypal') return 'PayPal'
  return '—'
}

function MethodBadge({ method }: { method: 'eft' | 'paypal' | null }) {
  if (!method) return <span className="text-on-surface-variant">—</span>
  const style =
    method === 'eft'
      ? { bg: 'rgba(59,130,246,0.12)', color: '#60a5fa' }
      : { bg: 'rgba(34,197,94,0.12)', color: '#4ade80' }
  return (
    <span
      className="text-xs font-label px-2.5 py-1 rounded-full"
      style={{ background: style.bg, color: style.color }}
    >
      {methodLabel(method)}
    </span>
  )
}

function payoutDetailText(method: 'eft' | 'paypal' | null, details: PayoutDetails | null): string {
  if (!details) return '—'
  if (method === 'paypal') return details.paypalEmail || '—'
  if (method === 'eft') {
    const parts = [
      details.bankName,
      details.accountHolder,
      details.accountNumber ? `acct ${details.accountNumber}` : null,
      details.branchCode ? `branch ${details.branchCode}` : null,
    ].filter(Boolean)
    return parts.length ? parts.join(' · ') : '—'
  }
  return '—'
}

export default function PartnerPayoutSettingsPage() {
  const [settings, setSettings] = useState<PayoutSettings | null>(null)
  const [form, setForm] = useState<PayoutSettings | null>(null)
  const [partners, setPartners] = useState<PartnerView[]>([])
  const [owed, setOwed] = useState<OwedView[]>([])
  const [loading, setLoading] = useState(true)
  const [topError, setTopError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setTopError(null)
    try {
      const res = await fetch('/api/v1/admin/billing/payout-settings')
      const body = await res.json()
      if (!res.ok) {
        setTopError(body?.error ?? 'Failed to load payout settings')
        setPartners([])
        setOwed([])
        return
      }
      const data = body.data ?? {}
      setSettings(data.settings ?? null)
      setForm(data.settings ?? null)
      setPartners(data.partners ?? [])
      setOwed(data.owed ?? [])
    } catch (err) {
      setTopError(err instanceof Error ? err.message : 'Failed to load payout settings')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  function patch(p: Partial<PayoutSettings>) {
    setForm((prev) => (prev ? { ...prev, ...p } : prev))
  }

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault()
    if (!form) return
    setSaveError(null)
    setNotice(null)
    setSaving(true)
    try {
      const res = await fetch('/api/v1/admin/billing/payout-settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          defaultCommissionPercent: Number(form.defaultCommissionPercent),
          minPayoutZar: Number(form.minPayoutZar),
          payoutSchedule: form.payoutSchedule,
          payoutFromNote: form.payoutFromNote ?? '',
        }),
      })
      const body = await res.json()
      if (!res.ok) {
        setSaveError(body?.error ?? 'Failed to save payout settings')
        return
      }
      const next = body.data?.settings ?? form
      setSettings(next)
      setForm(next)
      setNotice('Payout settings saved.')
      await load()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save payout settings')
    } finally {
      setSaving(false)
    }
  }

  const totalOwed = owed.reduce((sum, o) => sum + (Number(o.owedZar) || 0), 0)

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">
            Billing / Partner payouts
          </p>
          <h1 className="text-2xl font-headline font-bold text-on-surface">Partner Payouts</h1>
          <p className="text-sm text-on-surface-variant mt-0.5">
            Configure how partner commissions are paid out and review who is owed.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 self-start md:self-auto">
          <Link href="/admin/settings" className="pib-btn-ghost text-sm font-label">
            Back to settings
          </Link>
        </div>
      </div>

      {/* EFT/PayPal adaptation banner (replaces Stripe Connect onboarding) */}
      <div
        className="pib-card p-5 border"
        style={{ borderColor: 'var(--color-accent-v2)', background: 'rgba(255,255,255,0.02)' }}
      >
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">
          No Stripe Connect
        </p>
        <h2 className="text-base font-headline font-bold text-on-surface mb-1">
          Commissions are paid by EFT or PayPal transfer
        </h2>
        <p className="text-sm text-on-surface-variant">
          Partners in Biz does not use Stripe Connect. Partner commissions are settled
          manually via EFT (South African bank transfer) or PayPal, using each partner&apos;s
          chosen payout method and details captured on their application. Every payout is
          tracked in-platform — there is no third-party onboarding to complete. Set your
          payout policy below, then settle the partners listed as owed once each transfer
          is done.
        </p>
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

      {/* Payout settings form */}
      <div className="pib-card p-5">
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">
          Payout policy
        </p>
        <h2 className="text-lg font-headline font-bold text-on-surface mb-4">Payout Settings</h2>
        {loading || !form ? (
          <Skeleton className="h-48 rounded-xl" />
        ) : (
          <form onSubmit={saveSettings} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <label className="block">
                <span className="text-xs font-label uppercase tracking-wide text-on-surface-variant">
                  Default commission (%)
                </span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={form.defaultCommissionPercent}
                  onChange={(e) => patch({ defaultCommissionPercent: Number(e.target.value) })}
                  className="pib-input w-full mt-1"
                />
                <span className="text-[11px] text-on-surface-variant mt-1 block">
                  Applied to new partner approvals.
                </span>
              </label>
              <label className="block">
                <span className="text-xs font-label uppercase tracking-wide text-on-surface-variant">
                  Minimum payout (ZAR)
                </span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.minPayoutZar}
                  onChange={(e) => patch({ minPayoutZar: Number(e.target.value) })}
                  className="pib-input w-full mt-1"
                />
                <span className="text-[11px] text-on-surface-variant mt-1 block">
                  Partners below this aren&apos;t paid out this cycle.
                </span>
              </label>
              <label className="block">
                <span className="text-xs font-label uppercase tracking-wide text-on-surface-variant">
                  Payout schedule
                </span>
                <select
                  value={form.payoutSchedule}
                  onChange={(e) =>
                    patch({ payoutSchedule: e.target.value as PayoutSettings['payoutSchedule'] })
                  }
                  className="pib-input w-full mt-1"
                >
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="on_request">On request</option>
                </select>
              </label>
            </div>
            <label className="block">
              <span className="text-xs font-label uppercase tracking-wide text-on-surface-variant">
                Payout-from note (shown to your team)
              </span>
              <textarea
                value={form.payoutFromNote ?? ''}
                onChange={(e) => patch({ payoutFromNote: e.target.value })}
                placeholder="e.g. Pay from PiB FNB Business account · ref: PARTNER-COMMISSION"
                className="pib-input w-full mt-1"
                rows={2}
              />
              <span className="text-[11px] text-on-surface-variant mt-1 block">
                The platform owner&apos;s banking note your team uses when sending transfers.
              </span>
            </label>
            {saveError && <p className="text-xs text-red-400">{saveError}</p>}
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="pib-btn-primary text-sm font-label disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save settings'}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Payouts owed */}
      <div className="pib-card p-5">
        <div className="flex items-end justify-between gap-4 mb-4">
          <div>
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">
              Eligible this cycle
            </p>
            <h2 className="text-lg font-headline font-bold text-on-surface">Payouts Owed</h2>
            <p className="text-sm text-on-surface-variant mt-0.5">
              Approved partners with lifetime commission at or above the minimum payout
              {settings ? ` (${formatZar(settings.minPayoutZar)})` : ''}.
            </p>
          </div>
          {!loading && (
            <div className="text-right">
              <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
                Total owed
              </p>
              <p className="text-2xl font-headline font-bold text-on-surface">
                {formatZar(totalOwed)}
              </p>
            </div>
          )}
        </div>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 rounded-xl" />
            <Skeleton className="h-12 rounded-xl" />
          </div>
        ) : owed.length === 0 ? (
          <div className="text-center text-sm text-on-surface-variant py-6">
            No partners are eligible for payout this cycle.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-on-surface/10 text-left">
                  <th className="px-4 py-3 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Company</th>
                  <th className="px-4 py-3 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Method</th>
                  <th className="px-4 py-3 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Payout details</th>
                  <th className="px-4 py-3 text-[10px] font-label uppercase tracking-widest text-on-surface-variant text-right">Amount owed</th>
                </tr>
              </thead>
              <tbody>
                {owed.map((o) => {
                  const partner = partners.find((p) => p.partnerId === o.partnerId)
                  return (
                    <tr key={o.partnerId} className="border-b border-on-surface/5 last:border-0">
                      <td className="px-4 py-3 text-on-surface">{o.companyName}</td>
                      <td className="px-4 py-3"><MethodBadge method={o.payoutMethod} /></td>
                      <td className="px-4 py-3 text-on-surface-variant">
                        {payoutDetailText(o.payoutMethod, partner?.payoutDetails ?? null)}
                      </td>
                      <td className="px-4 py-3 text-on-surface text-right font-medium">
                        {formatZar(o.owedZar)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* All approved partners */}
      <div className="pib-card p-5">
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">
          Partner programme
        </p>
        <h2 className="text-lg font-headline font-bold text-on-surface mb-4">All Approved Partners</h2>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 rounded-xl" />
            <Skeleton className="h-12 rounded-xl" />
            <Skeleton className="h-12 rounded-xl" />
          </div>
        ) : partners.length === 0 ? (
          <div className="text-center text-sm text-on-surface-variant py-6">
            No approved partners yet. Approve applications in the partner programme to see them
            here.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-on-surface/10 text-left">
                  <th className="px-4 py-3 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Company</th>
                  <th className="px-4 py-3 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Contact</th>
                  <th className="px-4 py-3 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Method</th>
                  <th className="px-4 py-3 text-[10px] font-label uppercase tracking-widest text-on-surface-variant text-right">Commission %</th>
                  <th className="px-4 py-3 text-[10px] font-label uppercase tracking-widest text-on-surface-variant text-right">Referrals</th>
                  <th className="px-4 py-3 text-[10px] font-label uppercase tracking-widest text-on-surface-variant text-right">Lifetime commission</th>
                </tr>
              </thead>
              <tbody>
                {partners.map((p) => (
                  <tr key={p.partnerId} className="border-b border-on-surface/5 last:border-0">
                    <td className="px-4 py-3 text-on-surface">{p.companyName}</td>
                    <td className="px-4 py-3 text-on-surface-variant">
                      {p.contactName || p.email || '—'}
                    </td>
                    <td className="px-4 py-3"><MethodBadge method={p.payoutMethod} /></td>
                    <td className="px-4 py-3 text-on-surface-variant text-right">
                      {p.commissionPercent != null ? `${p.commissionPercent}%` : '—'}
                    </td>
                    <td className="px-4 py-3 text-on-surface-variant text-right">{p.referralsCount}</td>
                    <td className="px-4 py-3 text-on-surface text-right font-medium">
                      {formatZar(p.totalCommissionZar)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
