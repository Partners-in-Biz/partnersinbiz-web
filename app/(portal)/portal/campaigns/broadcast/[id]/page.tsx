import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import type { CSSProperties } from 'react'
import { adminDb } from '@/lib/firebase/admin'
import { getBrandKitForOrg } from '@/lib/brand-kit/store'
import type { Broadcast, BroadcastStatus } from '@/lib/broadcasts/types'
import type { EmailDomain } from '@/lib/email/domains'
import type { Segment } from '@/lib/crm/segments'
import {
  resolvePortalCampaignUser,
  scopedPortalHref,
  scopeFromSearchParams,
  type PortalCampaignSearchParams,
} from '../../portalCampaignScope'

export const dynamic = 'force-dynamic'

type TimestampLike = { _seconds?: number; seconds?: number; toDate?: () => Date } | null | undefined

const STATUS_PILL: Record<BroadcastStatus, string> = {
  draft: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/25',
  scheduled: 'bg-sky-500/15 text-sky-300 border-sky-500/25',
  sending: 'bg-violet-500/15 text-violet-300 border-violet-500/25 animate-pulse',
  sent: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
  paused: 'bg-amber-500/15 text-amber-300 border-amber-500/25',
  failed: 'bg-rose-500/15 text-rose-300 border-rose-500/25',
  canceled: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
}

const STATUS_LABEL: Record<BroadcastStatus, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  sending: 'Sending',
  sent: 'Sent',
  paused: 'Paused',
  failed: 'Failed',
  canceled: 'Canceled',
}

const AB_STATUS_PILL: Record<string, string> = {
  inactive: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/25',
  testing: 'bg-violet-500/15 text-violet-300 border-violet-500/25 animate-pulse',
  'winner-pending': 'bg-amber-500/15 text-amber-300 border-amber-500/25',
  'winner-sent': 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
  complete: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
}

const AB_STATUS_LABEL: Record<string, string> = {
  inactive: 'Inactive',
  testing: 'Testing',
  'winner-pending': 'Winner pending',
  'winner-sent': 'Winner sent',
  complete: 'Complete',
}

const DOMAIN_STATUS_PILL: Record<string, string> = {
  verified: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
  pending: 'bg-amber-500/15 text-amber-300 border-amber-500/25',
  not_started: 'bg-amber-500/15 text-amber-300 border-amber-500/25',
  failed: 'bg-rose-500/15 text-rose-300 border-rose-500/25',
  temporary_failure: 'bg-rose-500/15 text-rose-300 border-rose-500/25',
}

function pct(num: number, denom: number): string {
  if (!denom) return '—'
  return ((num / denom) * 100).toFixed(1) + '%'
}

function tsToDate(ts: TimestampLike): Date | null {
  if (!ts) return null
  if (typeof ts.toDate === 'function') return ts.toDate()
  const seconds = ts._seconds ?? ts.seconds
  if (typeof seconds === 'number') return new Date(seconds * 1000)
  return null
}

function fmtDate(ts: TimestampLike): string {
  const d = tsToDate(ts)
  if (!d) return ''
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
}

function fmtTime(ts: TimestampLike): string {
  const d = tsToDate(ts)
  if (!d) return ''
  return d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })
}

async function loadBroadcast(id: string): Promise<Broadcast | null> {
  const snap = await adminDb.collection('broadcasts').doc(id).get()
  if (!snap.exists) return null
  const data = snap.data()
  if (!data || data.deleted) return null
  return { id: snap.id, ...data } as Broadcast
}

async function loadDomain(id: string): Promise<EmailDomain | null> {
  if (!id) return null
  try {
    const snap = await adminDb.collection('email_domains').doc(id).get()
    if (!snap.exists) return null
    return { id: snap.id, ...snap.data() } as EmailDomain
  } catch {
    return null
  }
}

async function loadSegment(id: string): Promise<Segment | null> {
  if (!id) return null
  try {
    const snap = await adminDb.collection('segments').doc(id).get()
    if (!snap.exists) return null
    return { id: snap.id, ...snap.data() } as Segment
  } catch {
    return null
  }
}

export default async function PortalBroadcastPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams?: Promise<PortalCampaignSearchParams>
}) {
  const resolvedSearchParams = await searchParams
  const scope = scopeFromSearchParams(resolvedSearchParams)
  const user = await resolvePortalCampaignUser(scope.orgId)
  if (!user) redirect('/login')
  if (user.forbidden) notFound()

  const { id } = await params
  const broadcast = await loadBroadcast(id)
  if (!broadcast) notFound()
  if (broadcast.orgId !== user.orgId) notFound()

  const channel = broadcast.channel === 'sms' ? 'sms' : 'email'
  const status = (broadcast.status ?? 'draft') as BroadcastStatus
  const stats = broadcast.stats ?? {
    audienceSize: 0,
    queued: 0,
    sent: 0,
    delivered: 0,
    opened: 0,
    clicked: 0,
    bounced: 0,
    unsubscribed: 0,
    failed: 0,
  }

  const [brand, domain, segment] = await Promise.all([
    getBrandKitForOrg(broadcast.orgId),
    channel === 'email' ? loadDomain(broadcast.fromDomainId) : Promise.resolve(null),
    loadSegment(broadcast.audience?.segmentId ?? ''),
  ])

  const brandStyle: CSSProperties = {
    ['--brand-primary' as string]: brand.primaryColor,
    ['--brand-accent' as string]: brand.accentColor,
  }

  const subject = broadcast.content?.subject ?? ''
  const preheader = broadcast.content?.preheader ?? ''
  const bodyHtml = broadcast.content?.bodyHtml ?? ''
  const bodyText = broadcast.content?.bodyText ?? ''
  const templateId = broadcast.content?.templateId ?? ''

  const fromAddress = domain
    ? `${broadcast.fromLocal || 'hello'}@${domain.name}`
    : `${broadcast.fromLocal || 'hello'}@partnersinbiz.online`

  const audience = broadcast.audience ?? {
    segmentId: '',
    contactIds: [],
    tags: [],
    excludeUnsubscribed: true,
    excludeBouncedAt: true,
  }

  const ab = broadcast.ab
  const showAb = !!ab?.enabled && (ab?.variants?.length ?? 0) > 0
  const showLocalDelivery = !!broadcast.audienceLocalDelivery
  const topicId = broadcast.topicId ?? ''
  const showTopic = topicId && topicId !== 'newsletter'
  const showSmartFeatures = showLocalDelivery || showTopic

  const scheduledFor = tsToDate(broadcast.scheduledFor)
  const sentCompleted = tsToDate(broadcast.sendCompletedAt)

  return (
    <div className="space-y-8 pb-12" style={brandStyle}>
      {/* Hero */}
      <div className="space-y-4">
        <Link
          href={scopedPortalHref('/portal/campaigns', scope)}
          className="inline-flex items-center gap-1 text-sm text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors"
        >
          <span className="material-symbols-outlined text-base">arrow_back</span>
          Campaigns
        </Link>

        <div className="space-y-3">
          <p className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">
            Broadcast · {channel === 'sms' ? 'SMS' : 'Email'}
          </p>
          <div className="flex items-start gap-4 flex-wrap">
            <h1 className="font-headline text-3xl md:text-4xl tracking-tight text-[var(--color-pib-text)] flex-1 min-w-[260px]">
              {broadcast.name || 'Untitled broadcast'}
            </h1>
            <span
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-label tracking-wide ${
                STATUS_PILL[status] ?? STATUS_PILL.draft
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-current" />
              {STATUS_LABEL[status] ?? status}
            </span>
          </div>
          <p className="text-sm text-[var(--color-pib-text-muted)] max-w-2xl">
            {broadcast.description?.trim() || 'One-off send'}
          </p>
          {status === 'scheduled' && scheduledFor && (
            <p className="text-xs text-[var(--color-pib-text-muted)] font-label">
              Sends {fmtDate(broadcast.scheduledFor)} at {fmtTime(broadcast.scheduledFor)}
            </p>
          )}
          {status === 'sent' && sentCompleted && (
            <p className="text-xs text-[var(--color-pib-text-muted)] font-label">
              Sent on {fmtDate(broadcast.sendCompletedAt)}
            </p>
          )}
        </div>
      </div>

      {/* Top stat tiles */}
      <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {(channel === 'sms'
          ? [
              { label: 'Audience size', value: stats.audienceSize.toLocaleString() },
              { label: 'Sent', value: stats.sent.toLocaleString() },
              { label: 'Delivered', value: stats.delivered.toLocaleString() },
              { label: 'Failed', value: stats.failed.toLocaleString() },
              {
                label: 'Bounced',
                value: `${stats.bounced.toLocaleString()} · ${pct(stats.bounced, stats.sent)}`,
              },
            ]
          : [
              { label: 'Audience size', value: stats.audienceSize.toLocaleString() },
              { label: 'Sent', value: stats.sent.toLocaleString() },
              { label: 'Open rate', value: pct(stats.opened, stats.delivered) },
              { label: 'Click rate', value: pct(stats.clicked, stats.delivered) },
              {
                label: 'Bounced',
                value: `${stats.bounced.toLocaleString()} · ${pct(stats.bounced, stats.sent)}`,
              },
            ]
        ).map((tile) => (
          <div key={tile.label} className="pib-stat-card">
            <p className="font-label text-[10px] uppercase tracking-[0.15em] text-[var(--color-pib-text-muted)]">
              {tile.label}
            </p>
            <p className="font-headline text-2xl mt-2 tabular-nums text-[var(--color-pib-text)]">
              {tile.value}
            </p>
          </div>
        ))}
      </section>

      {/* Subject & Preview (email) */}
      {channel === 'email' && (
        <section className="pib-card space-y-4">
          <div className="flex items-baseline justify-between gap-4 flex-wrap">
            <p className="font-label text-[10px] uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">
              Subject &amp; preview
            </p>
            <Link
              href={`/api/v1/broadcasts/${broadcast.id}/preview`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-[var(--brand-accent,var(--color-pib-accent))] hover:underline inline-flex items-center gap-1"
            >
              Open preview
              <span className="material-symbols-outlined text-sm">open_in_new</span>
            </Link>
          </div>
          <div className="space-y-2">
            <h2 className="font-headline text-xl text-[var(--color-pib-text)]">
              {subject || <span className="text-[var(--color-pib-text-muted)] italic">No subject</span>}
            </h2>
            {preheader && (
              <p className="italic text-sm text-[var(--color-pib-text-muted)]">{preheader}</p>
            )}
          </div>
          {templateId ? (
            <div className="rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] p-4 text-xs text-[var(--color-pib-text-muted)] font-mono break-all">
              Rendered from template {templateId}
            </div>
          ) : bodyHtml ? (
            <iframe
              title="Email preview"
              srcDoc={bodyHtml}
              className="w-full h-[280px] rounded-xl border border-[var(--color-pib-line)] bg-white overflow-auto"
              sandbox=""
            />
          ) : (
            <div className="rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] p-4 text-xs text-[var(--color-pib-text-muted)] italic">
              No body content yet.
            </div>
          )}
        </section>
      )}

      {/* SMS body */}
      {channel === 'sms' && (
        <section className="pib-card space-y-3">
          <div className="flex items-baseline justify-between gap-2">
            <p className="font-label text-[10px] uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">
              SMS body
            </p>
            <p className="text-xs font-mono tabular-nums text-[var(--color-pib-text-muted)]">
              {bodyText.length} chars
            </p>
          </div>
          <div className="rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] p-4 font-mono text-sm whitespace-pre-wrap text-[var(--color-pib-text)]">
            {bodyText || (
              <span className="text-[var(--color-pib-text-muted)] italic font-sans">No SMS body yet.</span>
            )}
          </div>
        </section>
      )}

      {/* Audience */}
      <section className="pib-card space-y-4">
        <p className="font-label text-[10px] uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">
          Audience
        </p>
        <div className="space-y-2">
          {audience.segmentId ? (
            <p className="font-headline text-lg text-[var(--color-pib-text)]">
              From segment:{' '}
              <span className="text-[var(--brand-accent,var(--color-pib-accent))]">
                {segment?.name ?? audience.segmentId}
              </span>
            </p>
          ) : audience.contactIds && audience.contactIds.length > 0 ? (
            <p className="font-headline text-lg text-[var(--color-pib-text)]">
              {audience.contactIds.length.toLocaleString()} contact
              {audience.contactIds.length === 1 ? '' : 's'}{' '}
              <span className="text-[var(--color-pib-text-muted)] text-sm">(manual list)</span>
            </p>
          ) : audience.tags && audience.tags.length > 0 ? (
            <p className="font-headline text-lg text-[var(--color-pib-text)]">
              Anyone tagged:{' '}
              <span className="text-[var(--brand-accent,var(--color-pib-accent))]">
                {audience.tags.join(', ')}
              </span>
            </p>
          ) : (
            <p className="text-sm text-[var(--color-pib-text-muted)] italic">
              No audience configured.
            </p>
          )}
        </div>
        {(audience.excludeUnsubscribed || audience.excludeBouncedAt) && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="font-label text-[10px] uppercase tracking-[0.15em] text-[var(--color-pib-text-muted)]">
              Excluded:
            </span>
            {audience.excludeUnsubscribed && (
              <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] px-2.5 py-0.5 text-[11px] text-[var(--color-pib-text-muted)]">
                Unsubscribed
              </span>
            )}
            {audience.excludeBouncedAt && (
              <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] px-2.5 py-0.5 text-[11px] text-[var(--color-pib-text-muted)]">
                Recently bounced
              </span>
            )}
          </div>
        )}
      </section>

      {/* Sender & Deliverability — email only */}
      {channel === 'email' && (
        <section className="pib-card space-y-4">
          <p className="font-label text-[10px] uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">
            Sender &amp; deliverability
          </p>
          <p className="font-mono text-base md:text-lg text-[var(--color-pib-text)] break-all">
            From:{' '}
            <span className="text-[var(--color-pib-text)]">{broadcast.fromName || 'Unnamed'}</span>{' '}
            <span className="text-[var(--color-pib-text-muted)]">&lt;{fromAddress}&gt;</span>
          </p>
          {broadcast.replyTo && (
            <p className="text-sm font-mono text-[var(--color-pib-text-muted)] break-all">
              Reply-to: {broadcast.replyTo}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {domain ? (
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-label ${
                  DOMAIN_STATUS_PILL[domain.status] ?? DOMAIN_STATUS_PILL.pending
                }`}
              >
                <span className="material-symbols-outlined text-sm">
                  {domain.status === 'verified' ? 'verified' : 'warning'}
                </span>
                {domain.name} ·{' '}
                {domain.status === 'verified' ? 'Verified' : domain.status.replace('_', ' ')}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] px-2.5 py-1 text-xs text-[var(--color-pib-text-muted)] font-label">
                Sending via shared partnersinbiz.online
              </span>
            )}
            {domain?.status === 'verified' && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-300 font-label">
                <span className="material-symbols-outlined text-sm">shield</span>
                SPF · DKIM · DMARC verified
              </span>
            )}
          </div>
        </section>
      )}

      {/* A/B Test */}
      {showAb && ab && (
        <section className="pib-card space-y-5">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <p className="font-label text-[10px] uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">
              A/B test
            </p>
            <div className="flex items-center gap-2">
              {ab.autoPromote && (
                <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] px-2.5 py-0.5 text-[11px] text-[var(--color-pib-text-muted)] font-label">
                  <span className="material-symbols-outlined text-xs">auto_awesome</span>
                  Auto-promotes winner
                </span>
              )}
              <span
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-label ${
                  AB_STATUS_PILL[ab.status] ?? AB_STATUS_PILL.inactive
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-current" />
                {AB_STATUS_LABEL[ab.status] ?? ab.status}
              </span>
            </div>
          </div>
          <p className="text-sm text-[var(--color-pib-text-muted)]">
            {ab.mode === 'winner-only'
              ? `Testing on ${ab.testCohortPercent}% of audience for ${ab.testDurationMinutes} min, deciding by ${ab.winnerMetric}.`
              : `Split test across ${ab.variants.length} variants, deciding by ${ab.winnerMetric}.`}
          </p>
          <div className="overflow-x-auto rounded-xl border border-[var(--color-pib-line)]">
            <table className="w-full text-sm">
              <thead className="bg-white/[0.02]">
                <tr className="text-left">
                  <th className="font-label text-[10px] uppercase tracking-[0.15em] text-[var(--color-pib-text-muted)] px-4 py-3">
                    Variant
                  </th>
                  <th className="font-label text-[10px] uppercase tracking-[0.15em] text-[var(--color-pib-text-muted)] px-4 py-3 text-right">
                    Sent
                  </th>
                  <th className="font-label text-[10px] uppercase tracking-[0.15em] text-[var(--color-pib-text-muted)] px-4 py-3 text-right">
                    Opened
                  </th>
                  <th className="font-label text-[10px] uppercase tracking-[0.15em] text-[var(--color-pib-text-muted)] px-4 py-3 text-right">
                    Open rate
                  </th>
                  <th className="font-label text-[10px] uppercase tracking-[0.15em] text-[var(--color-pib-text-muted)] px-4 py-3 text-right">
                    Clicked
                  </th>
                  <th className="font-label text-[10px] uppercase tracking-[0.15em] text-[var(--color-pib-text-muted)] px-4 py-3 text-right">
                    Click rate
                  </th>
                  <th className="font-label text-[10px] uppercase tracking-[0.15em] text-[var(--color-pib-text-muted)] px-4 py-3">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-pib-line)]">
                {ab.variants.map((v) => {
                  const isWinner = ab.winnerVariantId === v.id
                  return (
                    <tr key={v.id} className={isWinner ? 'bg-emerald-500/5' : ''}>
                      <td className="px-4 py-3">
                        <p className="font-headline text-sm text-[var(--color-pib-text)]">
                          {v.label}
                        </p>
                        <p className="text-[10px] uppercase tracking-wider text-[var(--color-pib-text-muted)] mt-0.5">
                          {v.id} · {v.weight}%
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--color-pib-text)]">
                        {v.sent.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--color-pib-text-muted)]">
                        {v.opened.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--color-pib-text-muted)]">
                        {pct(v.opened, v.delivered)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--color-pib-text-muted)]">
                        {v.clicked.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--color-pib-text-muted)]">
                        {pct(v.clicked, v.delivered)}
                      </td>
                      <td className="px-4 py-3">
                        {isWinner ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-300 font-label">
                            <span className="material-symbols-outlined text-xs">star</span>
                            Winner
                          </span>
                        ) : (
                          <span className="text-xs text-[var(--color-pib-text-muted)]">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Smart features */}
      {showSmartFeatures && (
        <section className="pib-card space-y-3">
          <p className="font-label text-[10px] uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">
            Smart features
          </p>
          <div className="space-y-2">
            {showLocalDelivery && (
              <p className="text-sm text-[var(--color-pib-text)] flex items-center gap-2">
                <span className="material-symbols-outlined text-base text-[var(--brand-accent,var(--color-pib-accent))]">
                  schedule
                </span>
                Sends at recipients&apos; local time
                <span className="text-[var(--color-pib-text-muted)]">
                  (window: {broadcast.localDeliveryWindowHours ?? 24}h)
                </span>
              </p>
            )}
            {showTopic && (
              <p className="text-sm text-[var(--color-pib-text)] flex items-center gap-2">
                <span className="material-symbols-outlined text-base text-[var(--brand-accent,var(--color-pib-accent))]">
                  label
                </span>
                Topic:{' '}
                <span className="font-mono text-[var(--color-pib-text-muted)]">{topicId}</span>
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
