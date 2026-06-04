import type { CSSProperties, ReactNode } from 'react'
import Link from 'next/link'
import { CampaignProgramCard } from '@/components/campaigns/CampaignProgramCard'

export type CampaignWorkspaceRecord = {
  id: string
  name?: string | null
  title?: string | null
  description?: string | null
  status?: string | null
  reviewState?: string | null
  objective?: string | null
  adAccountId?: string | null
  dailyBudget?: number | null
  campaignType?: string | null
  goal?: string | null
  audience?: string | null
  channels?: string[] | null
  launchWindow?: string | null
  budget?: string | null
  notes?: string | null
  channel?: string | null
  scheduledFor?: string | null
  sendStartedAt?: string | null
  sendCompletedAt?: string | null
  createdAt?: string | null
  updatedAt?: string | null
  kind?: string | null
  content?: {
    subject?: string | null
    preheader?: string | null
  } | null
  stats?: Record<string, unknown> | null
  ab?: {
    enabled?: boolean | null
  } | null
  [key: string]: unknown
}

type CampaignsWorkspaceHrefs = {
  content: (campaign: CampaignWorkspaceRecord) => string
  email: (campaign: CampaignWorkspaceRecord) => string
  broadcast: (broadcast: CampaignWorkspaceRecord) => string
  ad: (campaign: CampaignWorkspaceRecord) => string
}

type CampaignsWorkspaceSection = 'requests' | 'content' | 'email' | 'ads' | 'broadcasts'

type CampaignsWorkspaceProps = {
  surface: 'admin' | 'portal'
  eyebrow: string
  orgName?: string
  description: string
  contentCampaigns: CampaignWorkspaceRecord[]
  emailPrograms: CampaignWorkspaceRecord[]
  broadcasts: CampaignWorkspaceRecord[]
  adCampaigns: CampaignWorkspaceRecord[]
  requests: CampaignWorkspaceRecord[]
  hrefs: CampaignsWorkspaceHrefs
  actions?: ReactNode
  workflowPanel?: ReactNode
  requestComposer?: ReactNode
  contentMeta?: (campaign: CampaignWorkspaceRecord) => ReactNode
  visibleSections?: CampaignsWorkspaceSection[]
  brandStyle?: CSSProperties
}

const STATUS_PILL: Record<string, string> = {
  draft: 'bg-gray-700/30 text-gray-300 border border-gray-600/30',
  scheduled: 'bg-blue-700/30 text-blue-200 border border-blue-600/30',
  sending: 'bg-violet-700/30 text-violet-200 border border-violet-600/30',
  active: 'bg-emerald-700/30 text-emerald-200 border border-emerald-600/30',
  sent: 'bg-emerald-700/30 text-emerald-200 border border-emerald-600/30',
  in_review: 'bg-amber-700/30 text-amber-200 border border-amber-600/30',
  approved: 'bg-emerald-700/30 text-emerald-200 border border-emerald-600/30',
  shipping: 'bg-violet-700/30 text-violet-200 border border-violet-600/30',
  paused: 'bg-amber-700/30 text-amber-200 border border-amber-600/30',
  completed: 'bg-zinc-700/30 text-zinc-300 border border-zinc-600/30',
  failed: 'bg-red-700/30 text-red-200 border border-red-600/30',
  canceled: 'bg-zinc-700/30 text-zinc-400 border border-zinc-700',
  archived: 'bg-zinc-800 text-zinc-400 border border-zinc-700',
  DRAFT: 'bg-gray-700/30 text-gray-300 border border-gray-600/30',
  ACTIVE: 'bg-emerald-700/30 text-emerald-200 border border-emerald-600/30',
  PAUSED: 'bg-amber-700/30 text-amber-200 border border-amber-600/30',
  PENDING_REVIEW: 'bg-sky-700/30 text-sky-200 border border-sky-600/30',
  ARCHIVED: 'bg-zinc-800 text-zinc-400 border border-zinc-700',
}

function statusPill(status?: string | null): string {
  return STATUS_PILL[status ?? ''] ?? 'bg-zinc-800 text-zinc-300 border border-zinc-700'
}

function pct(num: number, denom: number): string {
  if (!denom) return '-'
  return `${((num / denom) * 100).toFixed(1)}%`
}

function numeric(value: unknown): number {
  const number = Number(value ?? 0)
  return Number.isFinite(number) ? number : 0
}

function formatDate(value: unknown): string {
  if (!value) return '-'
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? '-' : new Date(parsed).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
  }
  if (typeof value === 'object' && value !== null) {
    const timestamp = value as { toDate?: () => Date; seconds?: number; _seconds?: number }
    const date =
      timestamp.toDate?.() ??
      (typeof (timestamp.seconds ?? timestamp._seconds) === 'number'
        ? new Date((timestamp.seconds ?? timestamp._seconds)! * 1000)
        : null)
    return date ? date.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }) : '-'
  }
  return '-'
}

function isActiveProgram(program: CampaignWorkspaceRecord): boolean {
  return program.status === 'active' || program.status === 'sending' || program.status === 'ACTIVE'
}

function needsReview(program: CampaignWorkspaceRecord): boolean {
  return (
    program.status === 'in_review' ||
    program.status === 'draft' ||
    program.status === 'PENDING_REVIEW' ||
    program.reviewState === 'awaiting'
  )
}

function campaignTitle(record: CampaignWorkspaceRecord): string {
  return record.name ?? record.title ?? 'Untitled campaign'
}

const DEFAULT_SECTIONS: CampaignsWorkspaceSection[] = ['requests', 'content', 'email', 'ads', 'broadcasts']

export function CampaignsWorkspace({
  surface,
  eyebrow,
  orgName,
  description,
  contentCampaigns,
  emailPrograms,
  broadcasts,
  adCampaigns,
  requests,
  hrefs,
  actions,
  workflowPanel,
  requestComposer,
  contentMeta,
  visibleSections = DEFAULT_SECTIONS,
  brandStyle,
}: CampaignsWorkspaceProps) {
  const visible = new Set(visibleSections)
  const visibleContentCampaigns = visible.has('content') ? contentCampaigns : []
  const visibleEmailPrograms = visible.has('email') ? emailPrograms : []
  const visibleBroadcasts = visible.has('broadcasts') ? broadcasts : []
  const visibleAdCampaigns = visible.has('ads') ? adCampaigns : []
  const activeCount = [
    ...visibleContentCampaigns,
    ...visibleEmailPrograms,
    ...visibleBroadcasts,
    ...visibleAdCampaigns,
  ].filter(isActiveProgram).length
  const reviewCount = [...visibleContentCampaigns, ...visibleAdCampaigns].filter(needsReview).length
  const totalCount =
    visibleContentCampaigns.length + visibleEmailPrograms.length + visibleBroadcasts.length + visibleAdCampaigns.length

  return (
    <div className="space-y-10" style={brandStyle}>
      <header className="flex flex-col lg:flex-row lg:items-end justify-between gap-5">
        <div>
          <p className="eyebrow">{orgName ?? eyebrow}</p>
          <h1 className="font-headline text-3xl md:text-4xl font-semibold mt-2 tracking-tight">Campaigns</h1>
          <p className="text-sm text-[var(--color-pib-text-muted)] mt-2 max-w-2xl">{description}</p>
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </header>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile label="Active programs" value={String(activeCount)} icon="bolt" />
        <StatTile label="Needs review" value={String(reviewCount)} icon="rate_review" emphasis={reviewCount > 0} />
        {visible.has('requests') && (
          <StatTile label="Client requests" value={String(requests.length)} icon="assignment_add" />
        )}
        <StatTile label="Total campaigns" value={String(totalCount)} icon="hub" />
      </section>

      {workflowPanel}
      {requestComposer}

      {visible.has('requests') && <CampaignRequests requests={requests} />}

      {visible.has('content') && (
        <CampaignSection title="Content & Social" subhead="Campaign cockpit, social posts, blogs, and video assets.">
          {contentCampaigns.length === 0 ? (
            <EmptyState
              icon="palette"
              title="No content campaigns yet"
              body={surface === 'admin' ? 'Create one from the content engine workflow.' : 'Your team will let you know when content is ready to review.'}
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {contentCampaigns.map((campaign) => (
                <CampaignProgramCard
                  key={campaign.id}
                  campaign={campaign}
                  href={hrefs.content(campaign)}
                  meta={contentMeta?.(campaign)}
                />
              ))}
            </div>
          )}
        </CampaignSection>
      )}

      {visible.has('email') && (
        <CampaignSection title="Email Programs" subhead="Sequence-backed campaigns linked to CRM segments and contacts.">
          {emailPrograms.length === 0 ? (
            <EmptyState
              icon="forward_to_inbox"
              title="No email programs yet"
              body={surface === 'admin' ? 'Use quick create to start a draft email campaign.' : 'Speak to your account manager to get started.'}
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {emailPrograms.map((campaign) => (
                <EmailCampaignCard key={campaign.id} campaign={campaign} href={hrefs.email(campaign)} />
              ))}
            </div>
          )}
        </CampaignSection>
      )}

      {visible.has('ads') && (
        <CampaignSection title="Ad Campaigns" subhead="Paid campaign shells, review state, launch state, and platform sync.">
          {adCampaigns.length === 0 ? (
            <EmptyState
              icon="ads_click"
              title="No ad campaigns yet"
              body={surface === 'admin' ? 'Build the first ad campaign from the Ads area.' : 'Your paid campaign drafts will appear here for review.'}
            />
          ) : (
            <div className="pib-card-section">
              {adCampaigns.map((campaign) => (
                <AdCampaignRow key={campaign.id} campaign={campaign} href={hrefs.ad(campaign)} />
              ))}
            </div>
          )}
        </CampaignSection>
      )}

      {visible.has('broadcasts') && (
        <CampaignSection title="Broadcasts" subhead="One-off email and SMS sends.">
          {broadcasts.length === 0 ? (
            <EmptyState
              icon="send"
              title="No broadcasts yet"
              body={surface === 'admin' ? 'Create broadcasts from the broadcast workspace.' : 'One-off campaign sends will appear here.'}
            />
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
                {broadcasts.map((broadcast) => (
                  <BroadcastRow key={broadcast.id} broadcast={broadcast} href={hrefs.broadcast(broadcast)} />
                ))}
              </div>
            </div>
          )}
        </CampaignSection>
      )}
    </div>
  )
}

function StatTile({
  label,
  value,
  icon,
  emphasis,
}: {
  label: string
  value: string
  icon: string
  emphasis?: boolean
}) {
  return (
    <div className="pib-stat-card">
      <div className="flex items-start justify-between">
        <p className="eyebrow !text-[10px]">{label}</p>
        <span className="material-symbols-outlined text-[18px] text-[var(--color-pib-text-muted)]">{icon}</span>
      </div>
      <p
        className={[
          'mt-3 font-display tracking-tight leading-none text-3xl md:text-4xl',
          emphasis ? 'text-[var(--color-pib-accent)]' : '',
        ].join(' ')}
      >
        {value}
      </p>
    </div>
  )
}

function CampaignSection({ title, subhead, children }: { title: string; subhead: string; children: ReactNode }) {
  return (
    <section className="space-y-5">
      <div className="flex items-end justify-between gap-4 flex-wrap border-b border-[var(--color-pib-line)] pb-4">
        <div>
          <p className="eyebrow">Campaign workspace</p>
          <h2 className="font-headline text-2xl md:text-3xl font-semibold tracking-tight mt-2">{title}</h2>
          <p className="text-sm text-[var(--color-pib-text-muted)] mt-1.5 max-w-2xl">{subhead}</p>
        </div>
      </div>
      {children}
    </section>
  )
}

function EmptyState({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div className="pib-card p-8 text-center">
      <span className="material-symbols-outlined text-4xl text-[var(--color-pib-text-muted)]">{icon}</span>
      <h3 className="font-headline text-lg font-semibold mt-3">{title}</h3>
      <p className="text-sm text-[var(--color-pib-text-muted)] mt-1.5 max-w-md mx-auto">{body}</p>
    </div>
  )
}

function CampaignRequests({ requests }: { requests: CampaignWorkspaceRecord[] }) {
  if (requests.length === 0) {
    return (
      <section className="pib-card p-6 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p className="eyebrow">Client requests</p>
          <h2 className="font-headline text-xl font-semibold mt-2">No campaign requests waiting</h2>
        </div>
        <span className="material-symbols-outlined text-[24px] text-[var(--color-pib-text-muted)]">task_alt</span>
      </section>
    )
  }

  return (
    <section className="space-y-4">
      <div>
        <p className="eyebrow">Client requests</p>
        <h2 className="font-headline text-2xl font-semibold mt-2">Campaign briefs to turn into work</h2>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {requests.map((request) => (
          <div key={request.id} className="pib-card p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="text-[10px] px-2 py-1 rounded uppercase tracking-wide bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-accent)]">
                  {request.campaignType ?? 'campaign'}
                </span>
                <h3 className="font-headline text-lg font-semibold mt-3">{request.title ?? request.name ?? 'Campaign request'}</h3>
              </div>
              <span className={`text-[10px] px-2 py-1 rounded uppercase tracking-wide ${statusPill(request.status)}`}>
                {request.status ?? 'new'}
              </span>
            </div>
            {request.goal && <p className="text-sm text-[var(--color-pib-text-muted)] mt-3">{request.goal}</p>}
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4 text-xs">
              <BriefItem label="Audience" value={request.audience} />
              <BriefItem label="Channels" value={Array.isArray(request.channels) ? request.channels.join(', ') : undefined} />
              <BriefItem label="Launch" value={request.launchWindow} />
              <BriefItem label="Budget" value={request.budget} />
            </dl>
            {request.notes && (
              <p className="text-xs text-[var(--color-pib-text-muted)] mt-4 border-t border-[var(--color-pib-line)] pt-3">
                {request.notes}
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

function BriefItem({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt className="eyebrow !text-[9px]">{label}</dt>
      <dd className="mt-1 text-[var(--color-pib-text)]">{value || '-'}</dd>
    </div>
  )
}

function EmailCampaignCard({ campaign, href }: { campaign: CampaignWorkspaceRecord; href: string }) {
  const stats = campaign.stats ?? {}
  const enrolled = numeric(stats.enrolled)
  const opened = numeric(stats.opened)
  const clicked = numeric(stats.clicked)
  const delivered = numeric(stats.delivered ?? stats.sent)

  return (
    <Link href={href} className="pib-card pib-card-hover block !p-5">
      <div className="flex items-start justify-between gap-3">
        <span className={`text-[10px] px-2 py-1 rounded uppercase tracking-wide ${statusPill(campaign.status)}`}>
          {campaign.status ?? 'draft'}
        </span>
        <span className="material-symbols-outlined text-[18px] text-[var(--color-pib-text-muted)]">forward_to_inbox</span>
      </div>
      <h3 className="font-headline text-lg font-semibold mt-4 leading-tight">{campaignTitle(campaign)}</h3>
      <p className="text-xs text-[var(--color-pib-text-muted)] mt-2">{campaign.description || 'Sequence-driven email program'}</p>
      <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-[var(--color-pib-line)] text-xs">
        <MiniStat label="Audience" value={String(enrolled)} />
        <MiniStat label="Open" value={pct(opened, delivered)} />
        <MiniStat label="Click" value={pct(clicked, delivered)} />
      </div>
      <p className="text-[11px] text-[var(--color-pib-text-muted)] mt-3">
        Last activity: {formatDate(campaign.updatedAt ?? campaign.createdAt)}
      </p>
    </Link>
  )
}

function AdCampaignRow({ campaign, href }: { campaign: CampaignWorkspaceRecord; href: string }) {
  const objective = typeof campaign.objective === 'string' ? campaign.objective : 'objective pending'
  const adAccount = typeof campaign.adAccountId === 'string' ? campaign.adAccountId : ''
  const dailyBudget = typeof campaign.dailyBudget === 'number' ? campaign.dailyBudget : null

  return (
    <Link
      href={href}
      className="grid grid-cols-1 md:grid-cols-12 gap-3 px-5 py-4 border-b last:border-b-0 border-[var(--color-pib-line)] hover:bg-[var(--color-pib-surface-2)] transition-colors"
    >
      <div className="md:col-span-6">
        <p className="font-semibold">{campaignTitle(campaign)}</p>
        <p className="text-xs text-[var(--color-pib-text-muted)] mt-1">
          {objective} {adAccount ? `- ${adAccount}` : ''}
        </p>
      </div>
      <div className="md:col-span-3">
        <span className={`text-[10px] px-2 py-1 rounded uppercase tracking-wide ${statusPill(campaign.status)}`}>
          {(campaign.status ?? 'draft').toLowerCase()}
        </span>
      </div>
      <div className="md:col-span-3 text-sm text-[var(--color-pib-text-muted)] md:text-right">
        {dailyBudget != null ? `R ${(dailyBudget / 100).toFixed(2)} daily` : 'Budget pending'}
      </div>
    </Link>
  )
}

function BroadcastRow({ broadcast, href }: { broadcast: CampaignWorkspaceRecord; href: string }) {
  const stats = broadcast.stats ?? {}
  const audience = numeric(stats.audienceSize ?? stats.queued)
  const opened = numeric(stats.opened)
  const clicked = numeric(stats.clicked)
  const delivered = numeric(stats.delivered ?? stats.sent)
  const channel = broadcast.channel === 'sms' ? 'sms' : 'email'
  const subject = broadcast.content?.subject || broadcast.name || 'Untitled broadcast'
  const sentAt = broadcast.sendCompletedAt ?? broadcast.sendStartedAt ?? broadcast.scheduledFor ?? broadcast.createdAt
  const abEnabled = Boolean(broadcast.ab?.enabled)

  return (
    <Link
      href={href}
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
          {broadcast.content?.preheader && (
            <p className="text-xs text-[var(--color-pib-text-muted)] mt-0.5 truncate">{broadcast.content.preheader}</p>
          )}
        </div>
      </div>

      <div className="md:col-span-2">
        <span className={`text-[10px] px-2 py-1 rounded uppercase tracking-wide ${statusPill(broadcast.status)}`}>
          {broadcast.status ?? 'draft'}
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

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="eyebrow !text-[9px]">{label}</p>
      <p className="font-medium text-sm tabular-nums mt-0.5">{value}</p>
    </div>
  )
}
