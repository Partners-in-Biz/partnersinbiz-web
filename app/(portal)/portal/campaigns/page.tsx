import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { getBrandKitForOrg } from '@/lib/brand-kit/store'
import { serializeForClient } from '@/lib/campaigns/serialize'
import { CampaignProgramCard } from '@/components/campaigns/CampaignProgramCard'
import { CampaignRequestPanel } from './CampaignRequestPanel'
import type { Sequence } from '@/lib/sequences/types'

export const dynamic = 'force-dynamic'

const STATUS_PILL: Record<string, string> = {
  draft: 'bg-gray-700/30 text-gray-300 border border-gray-600/30',
  scheduled: 'bg-blue-700/30 text-blue-200 border border-blue-600/30',
  sending: 'bg-violet-700/30 text-violet-200 border border-violet-600/30 animate-pulse',
  active: 'bg-emerald-700/30 text-emerald-200 border border-emerald-600/30',
  sent: 'bg-emerald-700/30 text-emerald-200 border border-emerald-600/30',
  in_review: 'bg-amber-700/30 text-amber-200 border border-amber-600/30',
  approved: 'bg-emerald-700/30 text-emerald-200 border border-emerald-600/30',
  shipping: 'bg-violet-700/30 text-violet-200 border border-violet-600/30',
  paused: 'bg-amber-700/30 text-amber-200 border border-amber-600/30',
  completed: 'bg-zinc-700/30 text-zinc-300 border border-zinc-600/30',
  failed: 'bg-red-700/30 text-red-200 border border-red-600/30',
  canceled: 'bg-zinc-700/30 text-zinc-300 border border-zinc-600/30',
  archived: 'bg-zinc-800 text-zinc-400 border border-zinc-700',
}

function pct(num: number, denom: number): string {
  if (!denom) return '—'
  return ((num / denom) * 100).toFixed(1) + '%'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isContentCampaign(c: any): boolean {
  return Boolean(c.clientType || c.brandIdentity || c.research)
}

function formatDate(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
}

function statusPill(status: string | undefined): string {
  return STATUS_PILL[status ?? ''] ?? 'bg-zinc-800 text-zinc-300 border border-zinc-700'
}

async function currentUser(): Promise<{ uid: string; orgId?: string } | null> {
  const cookieStore = await cookies()
  const cookieName = process.env.SESSION_COOKIE_NAME ?? '__session'
  const session = cookieStore.get(cookieName)?.value
  if (!session) return null
  try {
    const decoded = await adminAuth.verifySessionCookie(session, true)
    const userDoc = await adminDb.collection('users').doc(decoded.uid).get()
    return { uid: decoded.uid, orgId: userDoc.data()?.orgId }
  } catch {
    return null
  }
}

export default async function PortalCampaignsIndex() {
  const user = await currentUser()
  if (!user) redirect('/login')
  if (!user.orgId) {
    return (
      <div className="pib-card p-10 text-center text-sm text-[var(--color-pib-text-muted)]">
        No organisation linked to this account.
      </div>
    )
  }

  const [campaignsSnap, broadcastsSnap, brandKit] = await Promise.all([
    adminDb
      .collection('campaigns')
      .where('orgId', '==', user.orgId)
      .where('deleted', '==', false)
      .get(),
    adminDb
      .collection('broadcasts')
      .where('orgId', '==', user.orgId)
      .get(),
    getBrandKitForOrg(user.orgId),
  ])

  const [sequencesSnap, enrollmentsSnap, emailsSnap] = await Promise.all([
    adminDb
      .collection('sequences')
      .where('orgId', '==', user.orgId)
      .get(),
    adminDb
      .collection('sequence_enrollments')
      .where('orgId', '==', user.orgId)
      .get(),
    adminDb
      .collection('emails')
      .where('orgId', '==', user.orgId)
      .limit(1000)
      .get(),
  ])

  const allCampaigns = campaignsSnap.docs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((d) => serializeForClient({ id: d.id, ...(d.data() as any) }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .sort((a: any, b: any) => {
      const at = a.createdAt ? new Date(a.createdAt).getTime() : 0
      const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0
      return bt - at
    })

  const allBroadcasts = broadcastsSnap.docs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((d) => serializeForClient({ id: d.id, ...(d.data() as any) }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((b: any) => b.deleted !== true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .sort((a: any, b: any) => {
      const at = a.createdAt ? new Date(a.createdAt).getTime() : 0
      const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0
      return bt - at
    })

  const contentCampaigns = allCampaigns.filter(isContentCampaign)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const emailCampaigns = allCampaigns.filter((c: any) => !isContentCampaign(c))
  const campaignSequenceIds = new Set(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    emailCampaigns.map((c: any) => c.sequenceId).filter(Boolean)
  )

  const sequenceStats = new Map<
    string,
    { enrolled: number; sent: number; delivered: number; opened: number; clicked: number }
  >()
  for (const doc of enrollmentsSnap.docs) {
    const data = doc.data()
    const sequenceId = typeof data.sequenceId === 'string' ? data.sequenceId : ''
    if (!sequenceId) continue
    const stats = sequenceStats.get(sequenceId) ?? {
      enrolled: 0,
      sent: 0,
      delivered: 0,
      opened: 0,
      clicked: 0,
    }
    stats.enrolled += 1
    sequenceStats.set(sequenceId, stats)
  }
  for (const doc of emailsSnap.docs) {
    const data = doc.data()
    const sequenceId = typeof data.sequenceId === 'string' ? data.sequenceId : ''
    if (!sequenceId) continue
    const status = typeof data.status === 'string' ? data.status : ''
    const stats = sequenceStats.get(sequenceId) ?? {
      enrolled: 0,
      sent: 0,
      delivered: 0,
      opened: 0,
      clicked: 0,
    }
    if (status === 'sent' || status === 'opened' || status === 'clicked' || data.sentAt) stats.sent += 1
    if ((status === 'sent' || status === 'opened' || status === 'clicked') && !data.bouncedAt) stats.delivered += 1
    if (status === 'opened' || status === 'clicked' || data.openedAt) stats.opened += 1
    if (status === 'clicked' || data.clickedAt) stats.clicked += 1
    sequenceStats.set(sequenceId, stats)
  }

  const sequencePrograms = sequencesSnap.docs
    .map((d) => serializeForClient({ ...(d.data() as Sequence), id: d.id }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((s: any) => s.deleted !== true && !campaignSequenceIds.has(s.id))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((s: any) => ({
      ...s,
      kind: 'sequence',
      stats: sequenceStats.get(s.id) ?? {
        enrolled: 0,
        sent: 0,
        delivered: 0,
        opened: 0,
        clicked: 0,
      },
    }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .sort((a: any, b: any) => {
      const at = a.updatedAt ? new Date(a.updatedAt).getTime() : 0
      const bt = b.updatedAt ? new Date(b.updatedAt).getTime() : 0
      return bt - at
    })

  const emailPrograms = [
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...emailCampaigns.map((c: any) => ({ ...c, kind: 'campaign' })),
    ...sequencePrograms,
  ]

  // Stats row
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const totalActive = allCampaigns.filter((c: any) => c.status === 'active').length
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    + allBroadcasts.filter((b: any) => b.status === 'sending').length
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    + sequencePrograms.filter((s: any) => s.status === 'active').length

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const awaitingReview = contentCampaigns.filter((c: any) =>
    c.status === 'in_review' || c.status === 'draft'
  ).length

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const broadcastsSent = allBroadcasts.filter((b: any) => b.status === 'sent').length

  let openSum = 0
  let openCount = 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;[...emailPrograms, ...allBroadcasts].forEach((x: any) => {
    const s = x.stats ?? {}
    const delivered = Number(s.delivered ?? 0)
    const opened = Number(s.opened ?? 0)
    if (delivered > 0) {
      openSum += (opened / delivered) * 100
      openCount += 1
    }
  })
  const avgOpen = openCount > 0 ? `${(openSum / openCount).toFixed(1)}%` : '—'

  const wrapperStyle = {
    ['--brand-primary' as string]: brandKit.primaryColor,
    ['--brand-secondary' as string]: brandKit.secondaryColor,
    ['--brand-accent' as string]: brandKit.accentColor,
  } as React.CSSProperties

  return (
    <div className="space-y-12" style={wrapperStyle}>
      {/* Header */}
      <header>
        <p className="eyebrow">Client portal</p>
        <h1 className="font-headline text-3xl md:text-4xl font-semibold mt-2 tracking-tight">Campaigns</h1>
        <p className="text-sm text-[var(--color-pib-text-muted)] mt-2 max-w-2xl">
          All your marketing programs — content, email, and broadcasts — in one place.
        </p>
      </header>

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile label="Active programs" value={String(totalActive)} icon="bolt" />
        <StatTile label="Awaiting your review" value={String(awaitingReview)} icon="rate_review" emphasis={awaitingReview > 0} />
        <StatTile label="Broadcasts sent" value={String(broadcastsSent)} icon="send" />
        <StatTile label="Avg open rate" value={avgOpen} icon="drafts" />
      </div>

      <CampaignRequestPanel />

      {/* Section 1: Content & Social */}
      <section className="space-y-5">
        <SectionHeader
          eyebrow="Section 01"
          title="Content & Social"
          subhead="Blogs, videos, and social posts crafted for your brand."
        />

        {contentCampaigns.length === 0 ? (
          <EmptyState
            icon="palette"
            title="No content campaigns yet."
            body="Your team will let you know when content is ready to review."
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {contentCampaigns.map((c: any) => (
              <CampaignProgramCard key={c.id} campaign={c} href={`/portal/campaigns/${c.id}`} />
            ))}
          </div>
        )}
      </section>

      {/* Section 2: Email — featured */}
      <section className="space-y-8">
        <SectionHeader
          eyebrow="Section 02"
          title="Email"
          subhead="Ongoing email programs and one-off broadcasts."
          featured
        />

        {/* 2a: Email Campaigns */}
        <div className="space-y-4">
          <div className="flex items-baseline justify-between">
            <h3 className="font-headline text-lg font-semibold tracking-tight">
              Programs <span className="text-[var(--color-pib-text-muted)] font-normal">· {emailPrograms.length}</span>
            </h3>
            <p className="text-xs text-[var(--color-pib-text-muted)]">Sequence-driven, ongoing</p>
          </div>

          {emailPrograms.length === 0 ? (
            <div className="pib-card p-6 text-sm text-[var(--color-pib-text-muted)] text-center">
              No ongoing email programs yet.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {emailPrograms.map((c: any) => (
                <EmailCampaignCard key={c.id} c={c} />
              ))}
            </div>
          )}
        </div>

        {/* 2b: Broadcasts */}
        <div className="space-y-4">
          <div className="flex items-baseline justify-between">
            <h3 className="font-headline text-lg font-semibold tracking-tight">
              Broadcasts <span className="text-[var(--color-pib-text-muted)] font-normal">· {allBroadcasts.length}</span>
            </h3>
            <p className="text-xs text-[var(--color-pib-text-muted)]">One-off blasts</p>
          </div>

          {allBroadcasts.length === 0 && emailPrograms.length === 0 ? (
            <EmptyState
              icon="mail"
              title="No email programs yet."
              body="Speak to your account manager to get started."
            />
          ) : allBroadcasts.length === 0 ? (
            <div className="pib-card p-6 text-sm text-[var(--color-pib-text-muted)] text-center">
              No broadcasts sent yet.
            </div>
          ) : (
            <div className="pib-card-section">
              <div className="hidden md:grid grid-cols-12 gap-4 px-5 py-3 border-b border-[var(--color-pib-line)] bg-white/[0.02]">
                <p className="col-span-5 eyebrow !text-[10px]">Subject</p>
                <p className="col-span-2 eyebrow !text-[10px]">Status</p>
                <p className="col-span-2 eyebrow !text-[10px]">Sent</p>
                <p className="col-span-1 eyebrow !text-[10px] text-right">Audience</p>
                <p className="col-span-1 eyebrow !text-[10px] text-right">Open</p>
                <p className="col-span-1 eyebrow !text-[10px] text-right">Click</p>
              </div>
              <div className="divide-y divide-[var(--color-pib-line)]">
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {allBroadcasts.map((b: any) => (
                  <BroadcastRow key={b.id} b={b} />
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Section 3: What's tracked */}
      <section className="space-y-4">
        <SectionHeader
          eyebrow="Section 03"
          title="What's tracked"
          subhead="The platform handles the technical heavy-lifting so your team can focus on the message."
        />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FeatureCallout
            icon="science"
            title="A/B testing"
            body="Auto-promotes the winning variant by open rate, click rate, or conversion."
          />
          <FeatureCallout
            icon="verified_user"
            title="Deliverability"
            body="SPF, DKIM, and DMARC verified per domain. Reputation monitored continuously."
          />
          <FeatureCallout
            icon="auto_awesome"
            title="AI-assisted copy"
            body="Subject lines, preheaders, and bodies drafted in your brand voice."
          />
        </div>
      </section>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────── */
/* Sub-components                                                  */
/* ────────────────────────────────────────────────────────────── */

function StatTile({
  label,
  value,
  icon,
  emphasis,
}: {
  label: string
  value: string
  icon?: string
  emphasis?: boolean
}) {
  return (
    <div className="pib-stat-card">
      <div className="flex items-start justify-between">
        <p className="eyebrow !text-[10px]">{label}</p>
        {icon && (
          <span className="material-symbols-outlined text-[18px] text-[var(--color-pib-text-muted)]">
            {icon}
          </span>
        )}
      </div>
      <p
        className={[
          'mt-3 font-display tracking-tight leading-none text-3xl md:text-4xl',
          emphasis ? 'text-[var(--color-pib-accent)]' : 'text-[var(--color-pib-text)]',
        ].join(' ')}
      >
        {value}
      </p>
    </div>
  )
}

function SectionHeader({
  eyebrow,
  title,
  subhead,
  featured,
}: {
  eyebrow: string
  title: string
  subhead: string
  featured?: boolean
}) {
  return (
    <div className="flex items-end justify-between gap-4 flex-wrap border-b border-[var(--color-pib-line)] pb-4">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2
          className={[
            'font-headline tracking-tight mt-2',
            featured ? 'text-3xl md:text-4xl font-semibold' : 'text-2xl md:text-3xl font-semibold',
          ].join(' ')}
        >
          {title}
        </h2>
        <p className="text-sm text-[var(--color-pib-text-muted)] mt-1.5 max-w-2xl">{subhead}</p>
      </div>
    </div>
  )
}

function EmptyState({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div className="pib-card p-10 text-center">
      <span className="material-symbols-outlined text-4xl text-[var(--color-pib-text-muted)]">
        {icon}
      </span>
      <h3 className="font-headline text-lg font-semibold mt-3">{title}</h3>
      <p className="text-sm text-[var(--color-pib-text-muted)] mt-1.5 max-w-md mx-auto">{body}</p>
    </div>
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function EmailCampaignCard({ c }: { c: any }) {
  const stats = c.stats ?? {}
  const enrolled = Number(stats.enrolled ?? 0)
  const opened = Number(stats.opened ?? 0)
  const clicked = Number(stats.clicked ?? 0)
  const delivered = Number(stats.delivered ?? 0)

  return (
    <Link
      href={c.kind === 'sequence' ? `/portal/settings/sequences/${c.id}/edit` : `/portal/campaigns/email/${c.id}`}
      className="pib-card pib-card-hover block !p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <span className={`text-[10px] px-2 py-1 rounded uppercase tracking-wide ${statusPill(c.status)}`}>
          {c.status ?? 'draft'}
        </span>
        <span className="material-symbols-outlined text-[16px] text-[var(--color-pib-text-muted)]">
          forward_to_inbox
        </span>
      </div>
      <h4 className="font-semibold text-[var(--color-pib-text)] mt-3 leading-tight line-clamp-2">
        {c.name ?? 'Untitled campaign'}
      </h4>
      <p className="text-[11px] text-[var(--color-pib-text-muted)] mt-1">→ Sequence-driven</p>

      <div className="mt-4 pt-4 border-t border-[var(--color-pib-line)] grid grid-cols-3 gap-2 text-xs">
        <MiniStat label="Enrolled" value={String(enrolled)} />
        <MiniStat label="Open" value={pct(opened, delivered)} />
        <MiniStat label="Click" value={pct(clicked, delivered)} />
      </div>

      <p className="text-[11px] text-[var(--color-pib-text-muted)] mt-3">
        Last activity: {formatDate(c.updatedAt ?? c.createdAt)}
      </p>
    </Link>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="eyebrow !text-[9px]">{label}</p>
      <p className="font-medium text-sm tabular-nums mt-0.5 text-[var(--color-pib-text)]">{value}</p>
    </div>
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function BroadcastRow({ b }: { b: any }) {
  const stats = b.stats ?? {}
  const audience = Number(stats.audienceSize ?? stats.queued ?? 0)
  const opened = Number(stats.opened ?? 0)
  const clicked = Number(stats.clicked ?? 0)
  const delivered = Number(stats.delivered ?? stats.sent ?? 0)
  const channel = (b.channel ?? 'email') as 'email' | 'sms'
  const subject = b.content?.subject || b.name || 'Untitled broadcast'
  const sentAt = b.sendCompletedAt ?? b.sendStartedAt ?? b.scheduledFor ?? b.createdAt
  const abEnabled = Boolean(b.ab?.enabled)

  return (
    <Link
      href={`/portal/campaigns/broadcast/${b.id}`}
      className="grid grid-cols-2 md:grid-cols-12 gap-3 md:gap-4 items-center px-5 py-4 hover:bg-[var(--color-pib-surface-2)] transition-colors"
    >
      <div className="col-span-2 md:col-span-5 min-w-0 flex items-center gap-3">
        <span className="material-symbols-outlined text-[18px] text-[var(--color-pib-text-muted)] shrink-0">
          {channel === 'sms' ? 'sms' : 'mail'}
        </span>
        <div className="min-w-0">
          <p className="font-semibold text-[var(--color-pib-text)] truncate flex items-center gap-2">
            {subject}
            {abEnabled && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-accent)] uppercase tracking-wide font-bold shrink-0">
                A/B
              </span>
            )}
          </p>
          {b.content?.preheader && (
            <p className="text-xs text-[var(--color-pib-text-muted)] mt-0.5 truncate">
              {b.content.preheader}
            </p>
          )}
        </div>
      </div>

      <div className="md:col-span-2">
        <span className={`text-[10px] px-2 py-1 rounded uppercase tracking-wide ${statusPill(b.status)}`}>
          {b.status ?? 'draft'}
        </span>
      </div>

      <div className="md:col-span-2">
        <p className="text-xs text-[var(--color-pib-text-muted)] whitespace-nowrap">
          <span className="md:hidden eyebrow !text-[10px] mr-2">Sent</span>
          {formatDate(sentAt)}
        </p>
      </div>

      <div className="md:col-span-1 text-right">
        <p className="text-sm tabular-nums">
          <span className="md:hidden eyebrow !text-[10px] mr-2">Audience</span>
          {audience.toLocaleString('en-ZA')}
        </p>
      </div>
      <div className="md:col-span-1 text-right">
        <p className="text-sm tabular-nums text-[var(--color-pib-text-muted)]">
          <span className="md:hidden eyebrow !text-[10px] mr-2">Open</span>
          {pct(opened, delivered)}
        </p>
      </div>
      <div className="md:col-span-1 text-right">
        <p className="text-sm tabular-nums text-[var(--color-pib-text-muted)]">
          <span className="md:hidden eyebrow !text-[10px] mr-2">Click</span>
          {pct(clicked, delivered)}
        </p>
      </div>
    </Link>
  )
}

function FeatureCallout({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div className="pib-card !p-5">
      <span
        className="material-symbols-outlined text-[22px]"
        style={{ color: 'var(--brand-accent, var(--color-pib-accent))' }}
      >
        {icon}
      </span>
      <h4 className="font-headline font-semibold text-base mt-3">{title}</h4>
      <p className="text-xs text-[var(--color-pib-text-muted)] mt-1.5 leading-relaxed">{body}</p>
    </div>
  )
}
