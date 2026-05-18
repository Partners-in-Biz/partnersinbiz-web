'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { fmtTimestamp } from '@/components/admin/email/fmtTimestamp'
import type { MemberRef } from '@/lib/orgMembers/memberRef'

interface DealRecord {
  id?: string
  orgId?: string
  title?: string
  value?: number
  currency?: string
  pipelineId?: string
  stageId?: string
  probability?: number
  lostReason?: string
  contactId?: string
  companyId?: string
  companyName?: string
  expectedCloseDate?: unknown
  notes?: string
  ownerUid?: string
  ownerRef?: MemberRef
  lineItems?: Array<{
    name: string
    qty: number
    unitPrice: number
    discount?: number
    total: number
    currency: string
    productId?: string
  }>
  createdAt?: unknown
  updatedAt?: unknown
}

interface ActivityRecord {
  id: string
  type?: string
  summary?: string
  notes?: string
  createdAt?: unknown
  createdByRef?: MemberRef
}

const ACTIVITY_ICONS: Record<string, string> = {
  note: 'notes',
  email_sent: 'mail',
  email_received: 'inbox',
  sequence_enrolled: 'route',
  sequence_completed: 'route',
  contact_captured: 'add_circle',
  call: 'call',
  stage_change: 'swap_horiz',
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

function fmtValue(value: number | undefined, currency: string | undefined): string {
  if (value == null) return '—'
  try {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency: currency ?? 'ZAR',
      maximumFractionDigits: 0,
    }).format(value)
  } catch {
    return `${currency ?? 'ZAR'} ${value.toLocaleString()}`
  }
}

export default function DealDetailPage() {
  const { id } = useParams<{ id: string }>()

  const [deal, setDeal] = useState<DealRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>('')

  const [pipelineName, setPipelineName] = useState<string>('')
  const [stageName, setStageName] = useState<string>('')
  const [contactName, setContactName] = useState<string>('')

  const [activities, setActivities] = useState<ActivityRecord[]>([])
  const [activitiesLoading, setActivitiesLoading] = useState(true)

  // Step 1: fetch deal
  useEffect(() => {
    if (!id) return
    let cancelled = false
    fetch(`/api/v1/crm/deals/${id}`)
      .then(r => r.json())
      .then(async (body) => {
        if (cancelled) return
        const d: DealRecord | null = body.data?.deal ?? body.deal ?? body.data ?? null
        if (!d) {
          setError('Deal not found')
          setLoading(false)
          return
        }
        setDeal(d)
        setLoading(false)

        // Step 2: parallel secondary fetches
        const secondaryFetches: Promise<void>[] = []

        if (d.pipelineId) {
          secondaryFetches.push(
            fetch(`/api/v1/crm/pipelines/${d.pipelineId}`)
              .then(r => r.json())
              .then(pb => {
                if (cancelled) return
                const pipeline = pb.data ?? pb
                setPipelineName(pipeline?.name ?? d.pipelineId ?? '')
                if (d.stageId && Array.isArray(pipeline?.stages)) {
                  const stage = (pipeline.stages as Array<{ id: string; label: string }>).find(s => s.id === d.stageId)
                  setStageName(stage?.label ?? d.stageId ?? '')
                }
              })
              .catch(() => {}),
          )
        }

        if (d.contactId) {
          secondaryFetches.push(
            fetch(`/api/v1/crm/contacts/${d.contactId}`)
              .then(r => r.json())
              .then(cb => {
                if (cancelled) return
                const contact = cb.data ?? cb
                setContactName(contact?.name ?? '')
              })
              .catch(() => {}),
          )
          secondaryFetches.push(
            fetch(`/api/v1/crm/activities?contactId=${encodeURIComponent(d.contactId)}&limit=20`)
              .then(r => r.json())
              .then(ab => {
                if (cancelled) return
                setActivities(ab.data?.activities ?? ab.data ?? [])
                setActivitiesLoading(false)
              })
              .catch(() => {
                if (!cancelled) setActivitiesLoading(false)
              }),
          )
        } else {
          setActivitiesLoading(false)
        }

        await Promise.all(secondaryFetches)
      })
      .catch(() => {
        if (!cancelled) {
          setError('Failed to load deal')
          setLoading(false)
          setActivitiesLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [id])

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="space-y-4">
            <Skeleton className="h-24" />
            <Skeleton className="h-48" />
          </div>
          <div className="lg:col-span-2 space-y-4">
            <Skeleton className="h-48" />
            <Skeleton className="h-64" />
          </div>
        </div>
      </div>
    )
  }

  if (error || !deal) {
    return (
      <div className="bento-card !p-8 text-center space-y-3">
        <span className="material-symbols-outlined text-4xl text-[var(--color-pib-text-muted)] block">
          monetization_on
        </span>
        <p className="text-[var(--color-pib-text-muted)]">{error || 'Deal not found'}</p>
        <Link href="/portal/deals" className="text-sm text-[var(--color-pib-accent)] hover:underline">
          ← Back to Deals
        </Link>
      </div>
    )
  }

  const prob = deal.probability ?? 50
  const lineItemTotal = (deal.lineItems ?? []).reduce((sum, li) => sum + li.qty * li.unitPrice, 0)

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        href="/portal/deals"
        className="inline-flex items-center gap-1 text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors"
      >
        <span className="material-symbols-outlined text-[14px]">arrow_back</span>
        Deals
      </Link>

      {/* Title + chips */}
      <div className="space-y-3">
        <h1 className="font-display text-2xl font-bold text-[var(--color-pib-text)]">{deal.title ?? '—'}</h1>
        <div className="flex items-center gap-2 flex-wrap">
          {deal.value != null && (
            <span className="text-sm font-mono text-[var(--color-pib-text)]">
              {fmtValue(deal.value, deal.currency)}
            </span>
          )}
          <span
            className="text-[10px] font-label uppercase tracking-wide px-2 py-0.5 rounded-full"
            style={{
              background: prob >= 70 ? '#4ade8020' : prob >= 40 ? '#facc1520' : '#f8717120',
              color: prob >= 70 ? '#4ade80' : prob >= 40 ? '#facc15' : '#f87171',
            }}
          >
            {prob}%
          </span>
          {stageName && (
            <span
              className="text-[10px] font-label uppercase tracking-wide px-2 py-0.5 rounded-full"
              style={{ background: 'var(--color-pib-surface)', color: 'var(--color-pib-text-muted)' }}
            >
              {stageName}
            </span>
          )}
        </div>

        {deal.lostReason && (
          <div
            className="rounded-[var(--radius-card)] px-4 py-2 text-sm"
            style={{ background: '#ef444415', color: '#f87171', border: '1px solid #ef444430' }}
          >
            Lost: {deal.lostReason}
          </div>
        )}
      </div>

      {/* 2-col layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left col */}
        <section className="lg:col-span-1">
          <div className="bento-card !p-5 space-y-4 text-sm">
            <p className="eyebrow !text-[10px]">Details</p>
            {pipelineName && (
              <div>
                <p className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">Pipeline</p>
                <p className="text-[var(--color-pib-text)] mt-0.5">{pipelineName}</p>
              </div>
            )}
            {deal.contactId && (
              <div>
                <p className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">Contact</p>
                <Link
                  href={`/portal/contacts/${deal.contactId}`}
                  className="text-[var(--color-pib-accent)] hover:underline mt-0.5 inline-block"
                >
                  {contactName || deal.contactId}
                </Link>
              </div>
            )}
            {deal.companyId && (
              <div>
                <p className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">Company</p>
                <Link
                  href={`/portal/companies/${deal.companyId}`}
                  className="text-[var(--color-pib-accent)] hover:underline mt-0.5 inline-block"
                >
                  {deal.companyName || deal.companyId}
                </Link>
              </div>
            )}
            <div>
              <p className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">Owner</p>
              <p className="text-[var(--color-pib-text)] mt-0.5">
                {deal.ownerRef?.displayName ?? deal.ownerUid ?? '—'}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">Close date</p>
              <p className="text-[var(--color-pib-text-muted)] mt-0.5 font-mono text-xs">
                {deal.expectedCloseDate ? fmtTimestamp(deal.expectedCloseDate) : '—'}
              </p>
            </div>
            {deal.notes && (
              <div>
                <p className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">Notes</p>
                <p className="text-[var(--color-pib-text)] mt-0.5 whitespace-pre-wrap">{deal.notes}</p>
              </div>
            )}
          </div>
        </section>

        {/* Right col */}
        <section className="lg:col-span-2 space-y-6">
          {/* Line items */}
          {(deal.lineItems?.length ?? 0) > 0 && (
            <div className="bento-card !p-0 overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[var(--color-pib-line)] bg-white/[0.02]">
                <p className="eyebrow !text-[10px]">Line items</p>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b" style={{ borderColor: 'var(--color-pib-line)' }}>
                    {['Item', 'Qty', 'Unit price', 'Total'].map(h => (
                      <th
                        key={h}
                        className="text-left text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)] px-4 py-2.5"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(deal.lineItems ?? []).map((li, i) => (
                    <tr
                      key={i}
                      className="border-b last:border-0"
                      style={{ borderColor: 'var(--color-pib-line)' }}
                    >
                      <td className="px-4 py-3 text-[var(--color-pib-text)]">{li.name}</td>
                      <td className="px-4 py-3 font-mono text-[var(--color-pib-text-muted)]">{li.qty}</td>
                      <td className="px-4 py-3 font-mono text-[var(--color-pib-text-muted)]">
                        {fmtValue(li.unitPrice, li.currency || deal.currency)}
                      </td>
                      <td className="px-4 py-3 font-mono text-[var(--color-pib-text)]">
                        {fmtValue(li.qty * li.unitPrice, li.currency || deal.currency)}
                      </td>
                    </tr>
                  ))}
                  <tr style={{ background: 'var(--color-pib-surface)' }}>
                    <td colSpan={3} className="px-4 py-3 text-xs font-bold text-[var(--color-pib-text-muted)] uppercase tracking-widest">
                      Total
                    </td>
                    <td className="px-4 py-3 font-mono font-bold text-[var(--color-pib-text)]">
                      {fmtValue(lineItemTotal, deal.currency)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Activity */}
          <div className="pib-card-section">
            <div className="px-5 py-3.5 border-b border-[var(--color-pib-line)] bg-white/[0.02] flex items-center justify-between">
              <p className="eyebrow !text-[10px]">Activity</p>
              <span className="text-[11px] text-[var(--color-pib-text-muted)] font-mono">
                {activitiesLoading ? '…' : `${activities.length} record${activities.length === 1 ? '' : 's'}`}
              </span>
            </div>

            {activitiesLoading ? (
              <div className="p-5 space-y-2">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="pib-skeleton h-10" />
                ))}
              </div>
            ) : activities.length === 0 ? (
              <div className="p-10 text-center">
                <span className="material-symbols-outlined text-3xl text-[var(--color-pib-text-muted)] block">
                  history
                </span>
                <p className="text-sm text-[var(--color-pib-text-muted)] mt-2">No activity yet.</p>
              </div>
            ) : (
              <div className="px-5 pb-4">
                {activities.map(a => (
                  <div key={a.id} className="flex gap-3 py-3 border-b border-[var(--color-pib-line)] last:border-0">
                    <div className="shrink-0 w-8 h-8 rounded-full bg-[var(--color-pib-surface)] border border-[var(--color-pib-line)] flex items-center justify-center">
                      <span className="material-symbols-outlined text-[14px] text-[var(--color-pib-text-muted)]">
                        {ACTIVITY_ICONS[String(a.type ?? '')] ?? 'circle'}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[var(--color-pib-text)]">{a.summary ?? a.notes ?? a.type}</p>
                      <p className="text-xs text-[var(--color-pib-text-muted)] mt-0.5">
                        {a.createdByRef?.displayName ?? 'System'} · {fmtTimestamp(a.createdAt)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
