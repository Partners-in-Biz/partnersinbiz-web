'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { scopedApiPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

type ReferralStatus = 'pending' | 'approved' | 'disputed' | 'paid'

type ReferralRow = {
  id: string
  referredName: string
  status: ReferralStatus
  creditZar: number
  createdAtMs: number | null
}

type ReferralsResponse = {
  code: string
  link: string
  stats: {
    sent: number
    signedUp: number
    converted: number
    creditEarnedZar: number
    creditPendingZar: number
    creditPaidZar: number
  }
  referrals: ReferralRow[]
  settings: {
    referrerCreditZar: number
    referredCreditZar: number
    requireApproval: boolean
    minPaidInvoices: number
    active: boolean
  }
}

const STATUS_LABEL: Record<ReferralStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  disputed: 'Disputed',
  paid: 'Paid',
}

function zar(amount: number): string {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(amount || 0)
}

function StatCard({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="pib-card p-5">
      <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">{label}</p>
      <p className="mt-3 text-2xl font-semibold text-[var(--color-pib-text)]">{value}</p>
      <p className="mt-2 text-xs text-[var(--color-pib-text-muted)]">{helper}</p>
    </div>
  )
}

export default function PortalReferralsPage() {
  const searchParams = useSearchParams()
  const endpoint = scopedApiPath('/api/v1/portal/referrals', scopeFromSearchParams(searchParams))
  const [data, setData] = useState<ReferralsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    fetch(endpoint)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body?.error ?? 'Failed to load referrals')
        return (body.data ?? body) as ReferralsResponse
      })
      .then((body) => {
        if (alive) setData(body)
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : 'Failed to load referrals')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [endpoint])

  const shareMailto = useMemo(() => {
    if (!data) return '#'
    const subject = encodeURIComponent('Try Partners in Biz')
    const body = encodeURIComponent(
      `I use Partners in Biz to run growth, content, and CRM for my business — thought you'd find it useful.\n\n` +
        `Sign up with my referral link and we both get account credit:\n${data.link}\n\n` +
        `Referral code: ${data.code}`,
    )
    return `mailto:?subject=${subject}&body=${body}`
  }, [data])

  async function copyLink() {
    if (!data) return
    try {
      await navigator.clipboard.writeText(data.link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      setCopied(false)
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="h-6 w-48 rounded bg-[var(--color-pib-surface-soft)]" />
        <div className="pib-card h-32 animate-pulse" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="pib-card h-28 animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-7xl">
        <div className="pib-card p-6">
          <p className="text-sm text-red-400">{error || 'No referral data available.'}</p>
        </div>
      </div>
    )
  }

  const { stats, settings } = data

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="pib-card p-6">
        <p className="eyebrow">Referrals</p>
        <h1 className="pib-page-title mt-2">Refer &amp; earn</h1>
        <p className="mt-3 max-w-3xl text-sm text-[var(--color-pib-text-muted)]">
          Invite other businesses to Partners in Biz. When they sign up and become a paying customer, you earn{' '}
          <strong className="text-[var(--color-pib-text)]">{zar(settings.referrerCreditZar)}</strong> in account credit and they get{' '}
          <strong className="text-[var(--color-pib-text)]">{zar(settings.referredCreditZar)}</strong> off.
        </p>
        {!settings.active && (
          <p className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
            The referral programme is currently paused. Your link still works and referrals will be recorded for when it reopens.
          </p>
        )}
      </header>

      {/* Link + code */}
      <section className="pib-card space-y-4 p-6">
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Your referral link</p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            readOnly
            value={data.link}
            aria-label="Referral link"
            className="pib-input flex-1 font-mono text-sm"
            onFocus={(e) => e.currentTarget.select()}
          />
          <div className="flex gap-2">
            <button type="button" onClick={copyLink} className="pib-btn-primary shrink-0">
              <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
                {copied ? 'check' : 'content_copy'}
              </span>
              {copied ? 'Copied' : 'Copy link'}
            </button>
            <a href={shareMailto} className="pib-btn-secondary shrink-0">
              <span className="material-symbols-outlined text-[16px]" aria-hidden="true">mail</span>
              Share via email
            </a>
          </div>
        </div>
        <p className="text-xs text-[var(--color-pib-text-muted)]">
          Referral code: <span className="font-mono font-semibold text-[var(--color-pib-text)]">{data.code}</span>
        </p>
      </section>

      {/* Stats */}
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Invites signed up" value={String(stats.signedUp)} helper="Businesses that joined via your link." />
        <StatCard label="Converted" value={String(stats.converted)} helper="Signups that became paying customers." />
        <StatCard label="Credit earned" value={zar(stats.creditEarnedZar)} helper="Approved + paid referral credit." />
        <StatCard label="Credit paid out" value={zar(stats.creditPaidZar)} helper="Settled on EFT invoices." />
      </section>

      {/* Referral list */}
      <section className="pib-card p-6">
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Your referrals</p>
        {data.referrals.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--color-pib-text-muted)]">
            No referrals yet. Share your link above to get started.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-pib-line)] text-left text-xs text-[var(--color-pib-text-muted)]">
                  <th className="pb-2 pr-4 font-medium">Business</th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  <th className="pb-2 pr-4 font-medium">Credit</th>
                  <th className="pb-2 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {data.referrals.map((r) => (
                  <tr key={r.id} className="border-b border-[var(--color-pib-line)]/50">
                    <td className="py-3 pr-4 font-medium text-[var(--color-pib-text)]">{r.referredName}</td>
                    <td className="py-3 pr-4">
                      <span className="pib-pill text-[11px]">{STATUS_LABEL[r.status]}</span>
                    </td>
                    <td className="py-3 pr-4 text-[var(--color-pib-text-muted)]">{zar(r.creditZar)}</td>
                    <td className="py-3 text-[var(--color-pib-text-muted)]">
                      {r.createdAtMs ? new Date(r.createdAtMs).toLocaleDateString('en-ZA') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* How it works */}
      <section className="pib-card p-6">
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">How it works</p>
        <ol className="mt-4 space-y-4">
          {[
            { icon: 'share', title: 'Share your link', body: 'Send your unique referral link or code to other business owners.' },
            { icon: 'person_add', title: 'They sign up', body: 'When they create a Partners in Biz account using your link, the referral is recorded.' },
            {
              icon: 'verified',
              title: 'They become a customer',
              body: `Once they pay ${settings.minPaidInvoices} invoice${settings.minPaidInvoices === 1 ? '' : 's'}${settings.requireApproval ? ' and we approve the referral' : ''}, the credit qualifies.`,
            },
            { icon: 'savings', title: 'You earn credit', body: `You get ${zar(settings.referrerCreditZar)} applied to your next EFT invoice. No card, no payout fees — pure account credit.` },
          ].map((step, i) => (
            <li key={i} className="flex gap-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-pib-surface-soft)] text-[var(--color-pib-accent)]">
                <span className="material-symbols-outlined text-[18px]" aria-hidden="true">{step.icon}</span>
              </span>
              <div>
                <p className="text-sm font-semibold text-[var(--color-pib-text)]">{step.title}</p>
                <p className="text-xs text-[var(--color-pib-text-muted)]">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
