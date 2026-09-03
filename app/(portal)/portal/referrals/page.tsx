'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { EmptyState, PageHeader } from '@/components/ui/AppFoundation'
import { StatCard } from '@/components/ui/StatCard'
import {
  Button,
  ButtonLink,
  Icon,
  Input,
  Notice,
  Panel,
  Skeleton,
  Status,
  Table,
  THead,
  TR,
  TH,
  TD,
} from '@/components/studio'
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

const STATUS_TONE: Record<ReferralStatus, 'warning' | 'success' | 'danger' | 'info' | undefined> = {
  pending: 'warning',
  approved: 'success',
  disputed: 'danger',
  paid: 'info',
}

function zar(amount: number): string {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(amount || 0)
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
      `I use Partners in Biz to run growth, content, and CRM for my business. Thought you would find it useful.\n\n` +
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
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-32 w-full" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-7xl space-y-4">
        <PageHeader eyebrow="Referrals" title="Refer and earn." description="Invite other businesses and earn account credit." />
        <Notice tone="danger">{error || 'No referral data available.'}</Notice>
      </div>
    )
  }

  const { stats, settings } = data

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <PageHeader
        eyebrow="Referrals"
        title="Refer and earn."
        description={`Invite other businesses to Partners in Biz. When they sign up and become a paying customer, you earn ${zar(settings.referrerCreditZar)} in account credit and they get ${zar(settings.referredCreditZar)} off.`}
      />

      {!settings.active ? (
        <Notice tone="info">
          The referral programme is currently paused. Your link still works and referrals will be recorded for when it reopens.
        </Notice>
      ) : null}

      <Panel className="space-y-4">
        <p className="sc-tiny">Your referral link</p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Input
            readOnly
            value={data.link}
            aria-label="Referral link"
            className="flex-1 font-mono text-sm"
            onFocus={(e) => e.currentTarget.select()}
          />
          <div className="flex gap-2">
            <Button type="button" onClick={copyLink} className="shrink-0">
              <Icon name={copied ? 'check' : 'content_copy'} />
              {copied ? 'Copied' : 'Copy link'}
            </Button>
            <ButtonLink href={shareMailto} variant="secondary" className="shrink-0">
              <Icon name="mail" />
              Share via email
            </ButtonLink>
          </div>
        </div>
        <p className="sc-body text-[0.875rem] text-[var(--sc-ink-soft)]">
          Referral code: <span className="font-mono text-[var(--sc-ink)]">{data.code}</span>
        </p>
      </Panel>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Invites signed up" value={String(stats.signedUp)} detail="Businesses that joined via your link." />
        <StatCard label="Converted" value={String(stats.converted)} detail="Signups that became paying customers." />
        <StatCard label="Credit earned" value={zar(stats.creditEarnedZar)} detail="Approved + paid referral credit." />
        <StatCard label="Credit paid out" value={zar(stats.creditPaidZar)} detail="Settled on EFT invoices." />
      </section>

      <Panel>
        <p className="sc-tiny">Your referrals</p>
        {data.referrals.length === 0 ? (
          <EmptyState
            className="mt-4"
            title="No referrals yet."
            description="Share your link above to get started."
          />
        ) : (
          <div className="mt-4 overflow-x-auto">
            <Table>
              <THead>
                <TR>
                  <TH>Business</TH>
                  <TH>Status</TH>
                  <TH>Credit</TH>
                  <TH>Date</TH>
                </TR>
              </THead>
              <tbody>
                {data.referrals.map((r) => (
                  <TR key={r.id}>
                    <TD className="text-[var(--sc-ink)]">{r.referredName}</TD>
                    <TD>
                      <Status tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Status>
                    </TD>
                    <TD className="st-num text-[var(--sc-ink-soft)]">{zar(r.creditZar)}</TD>
                    <TD className="text-[var(--sc-ink-soft)]">
                      {r.createdAtMs ? new Date(r.createdAtMs).toLocaleDateString('en-ZA') : '-'}
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Panel>

      <Panel>
        <p className="sc-tiny">How it works</p>
        <ol className="mt-4 space-y-4">
          {[
            { icon: 'share', title: 'Share your link', body: 'Send your unique referral link or code to other business owners.' },
            { icon: 'person_add', title: 'They sign up', body: 'When they create a Partners in Biz account using your link, the referral is recorded.' },
            {
              icon: 'verified',
              title: 'They become a customer',
              body: `Once they pay ${settings.minPaidInvoices} invoice${settings.minPaidInvoices === 1 ? '' : 's'}${settings.requireApproval ? ' and we approve the referral' : ''}, the credit qualifies.`,
            },
            { icon: 'savings', title: 'You earn credit', body: `You get ${zar(settings.referrerCreditZar)} applied to your next EFT invoice. No card, no payout fees. Pure account credit.` },
          ].map((step) => (
            <li key={step.title} className="flex gap-4">
              <Icon name={step.icon} className="mt-0.5 shrink-0 text-[var(--sc-ink-soft)]" />
              <div>
                <p className="sc-body text-[var(--sc-ink)]">{step.title}</p>
                <p className="sc-body text-[0.875rem] text-[var(--sc-ink-soft)]">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  )
}
