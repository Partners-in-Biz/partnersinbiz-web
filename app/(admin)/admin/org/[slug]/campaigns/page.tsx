/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from 'next/link'
import { adminDb } from '@/lib/firebase/admin'
import { resolveOrgIdBySlug } from '@/lib/organizations/resolve-by-slug'
import { serializeForClient } from '@/lib/campaigns/serialize'
import { listCampaigns as listAdCampaigns } from '@/lib/ads/campaigns/store'
import { CampaignProgramCard } from '@/components/campaigns/CampaignProgramCard'
import { QuickEmailCampaignCreator } from './QuickEmailCampaignCreator'

export const dynamic = 'force-dynamic'

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
  ARCHIVED: 'bg-zinc-800 text-zinc-400 border border-zinc-700',
  DRAFT: 'bg-gray-700/30 text-gray-300 border border-gray-600/30',
  ACTIVE: 'bg-emerald-700/30 text-emerald-200 border border-emerald-600/30',
  PAUSED: 'bg-amber-700/30 text-amber-200 border border-amber-600/30',
  PENDING_REVIEW: 'bg-sky-700/30 text-sky-200 border border-sky-600/30',
}

function statusPill(status?: string): string {
  return STATUS_PILL[status ?? ''] ?? 'bg-zinc-800 text-zinc-300 border border-zinc-700'
}

function pct(num: number, denom: number): string {
  if (!denom) return '-'
  return `${((num / denom) * 100).toFixed(1)}%`
}

function formatDate(value: unknown): string {
  if (!value) return '-'
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? '-' : new Date(parsed).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
  }
  if (typeof value === 'object' && value !== null) {
    const ts = value as { toDate?: () => Date; seconds?: number; _seconds?: number }
    const date = ts.toDate?.() ?? (typeof (ts.seconds ?? ts._seconds) === 'number' ? new Date((ts.seconds ?? ts._seconds)! * 1000) : null)
    return date ? date.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }) : '-'
  }
  return '-'
}

function isContentCampaign(c: Record<string, unknown>): boolean {
  return Boolean(c.clientType || c.brandIdentity || c.research)
}

export default async function CampaignsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const orgId = await resolveOrgIdBySlug(slug)
  if (!orgId) {
    return <div className="pib-card p-8 text-sm text-[var(--color-pib-text-muted)]">Organisation not found.</div>
  }

  const [orgSnap, campaignsSnap, broadcastsSnap, requestSnap, adCampaigns] = await Promise.all([
    adminDb.collection('organizations').doc(orgId).get(),
    adminDb.collection('campaigns').where('orgId', '==', orgId).where('deleted', '==', false).get(),
    adminDb.collection('broadcasts').where('orgId', '==', orgId).get(),
    adminDb.collection('campaign_requests').where('orgId', '==', orgId).where('deleted', '==', false).get(),
    listAdCampaigns({ orgId }),
  ])

  const orgName = (orgSnap.data()?.name as string | undefined) ?? 'Workspace'
  const campaigns = campaignsSnap.docs
    .map((doc) => serializeForClient({ id: doc.id, ...(doc.data() as Record<string, unknown>) }))
    .sort((a: any, b: any) => Date.parse(b.createdAt ?? '') - Date.parse(a.createdAt ?? ''))
  const broadcasts = broadcastsSnap.docs
    .map((doc) => serializeForClient({ id: doc.id, ...(doc.data() as Record<string, unknown>) }))
    .filter((item: any) => item.deleted !== true)
  const requests = requestSnap.docs
    .map((doc) => serializeForClient({ id: doc.id, ...(doc.data() as Record<string, unknown>) }))
    .sort((a: any, b: any) => Date.parse(b.createdAt ?? '') - Date.parse(a.createdAt ?? ''))

  const contentCampaigns = campaigns.filter((campaign: any) => isContentCampaign(campaign))
  const emailCampaigns = campaigns.filter((campaign: any) => !isContentCampaign(campaign))
  const activeCount =
    campaigns.filter((campaign: any) => campaign.status === 'active').length +
    broadcasts.filter((broadcast: any) => broadcast.status === 'sending').length +
    adCampaigns.filter((campaign) => campaign.status === 'ACTIVE').length
  const reviewCount =
    contentCampaigns.filter((campaign: any) => campaign.status === 'in_review' || campaign.status === 'draft').length +
    adCampaigns.filter((campaign) => campaign.status === 'PENDING_REVIEW').length

  return (
    <div className="space-y-10">
      <header className="flex flex-col lg:flex-row lg:items-end justify-between gap-5">
        <div>
          <p className="eyebrow">{orgName}</p>
          <h1 className="font-headline text-3xl md:text-4xl font-semibold mt-2 tracking-tight">Campaigns</h1>
          <p className="text-sm text-[var(--color-pib-text-muted)] mt-2 max-w-2xl">
            Content, email, broadcasts, ads, and client campaign requests in one workspace view.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/campaigns" className="pib-btn-secondary">
            <span className="material-symbols-outlined text-[18px]">palette</span>
            Content engine
          </Link>
          <Link href="/admin/broadcasts" className="pib-btn-secondary">
            <span className="material-symbols-outlined text-[18px]">mail</span>
            Broadcast
          </Link>
          <Link href={`/admin/org/${slug}/ads/campaigns/new`} className="pib-btn-primary">
            <span className="material-symbols-outlined text-[18px]">ads_click</span>
            Ad campaign
          </Link>
        </div>
      </header>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile label="Active" value={String(activeCount)} icon="bolt" />
        <StatTile label="Needs review" value={String(reviewCount)} icon="rate_review" />
        <StatTile label="Client requests" value={String(requests.length)} icon="assignment_add" />
        <StatTile label="Total campaigns" value={String(campaigns.length + broadcasts.length + adCampaigns.length)} icon="hub" />
      </section>

      <QuickEmailCampaignCreator orgId={orgId} slug={slug} />

      <CampaignRequests requests={requests} />

      <CampaignSection title="Content & Social" subhead="Campaign cockpit, social posts, blogs, and video assets.">
        {contentCampaigns.length === 0 ? (
          <EmptyState icon="palette" title="No content campaigns yet" body="Create one from the content engine workflow." />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {contentCampaigns.map((campaign: any) => (
              <CampaignProgramCard
                key={campaign.id}
                campaign={campaign}
                href={`/admin/org/${slug}/social/${campaign.id}`}
              />
            ))}
          </div>
        )}
      </CampaignSection>

      <CampaignSection title="Email Programs" subhead="Sequence-backed campaigns linked to CRM segments and contacts.">
        {emailCampaigns.length === 0 ? (
          <EmptyState icon="forward_to_inbox" title="No email programs yet" body="Use quick create above to start a draft email campaign." />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {emailCampaigns.map((campaign: any) => (
              <EmailCampaignCard key={campaign.id} campaign={campaign} slug={slug} />
            ))}
          </div>
        )}
      </CampaignSection>

      <CampaignSection title="Ad Campaigns" subhead="Paid campaign shells, review state, launch state, and platform sync.">
        {adCampaigns.length === 0 ? (
          <EmptyState icon="ads_click" title="No ad campaigns yet" body="Build the first ad campaign from the Ads area." />
        ) : (
          <div className="pib-card-section">
            {adCampaigns.map((campaign) => (
              <Link
                key={campaign.id}
                href={`/admin/org/${slug}/ads/campaigns/${campaign.id}`}
                className="grid grid-cols-1 md:grid-cols-12 gap-3 px-5 py-4 border-b last:border-b-0 border-[var(--color-pib-line)] hover:bg-[var(--color-pib-surface-2)] transition-colors"
              >
                <div className="md:col-span-6">
                  <p className="font-semibold">{campaign.name}</p>
                  <p className="text-xs text-[var(--color-pib-text-muted)] mt-1">
                    {campaign.objective} {campaign.adAccountId ? `- ${campaign.adAccountId}` : ''}
                  </p>
                </div>
                <div className="md:col-span-3">
                  <span className={`text-[10px] px-2 py-1 rounded uppercase tracking-wide ${statusPill(campaign.status)}`}>
                    {campaign.status.toLowerCase()}
                  </span>
                </div>
                <div className="md:col-span-3 text-sm text-[var(--color-pib-text-muted)] md:text-right">
                  {campaign.dailyBudget != null ? `${(campaign.dailyBudget / 100).toFixed(2)} daily` : 'Budget pending'}
                </div>
              </Link>
            ))}
          </div>
        )}
      </CampaignSection>

      <CampaignSection title="Broadcasts" subhead="One-off email and SMS sends.">
        {broadcasts.length === 0 ? (
          <EmptyState icon="send" title="No broadcasts yet" body="Create broadcasts from the broadcast workspace." />
        ) : (
          <div className="pib-card-section">
            {broadcasts.map((broadcast: any) => (
              <Link
                key={broadcast.id}
                href={`/admin/broadcasts/${broadcast.id}`}
                className="grid grid-cols-1 md:grid-cols-12 gap-3 px-5 py-4 border-b last:border-b-0 border-[var(--color-pib-line)] hover:bg-[var(--color-pib-surface-2)] transition-colors"
              >
                <div className="md:col-span-7">
                  <p className="font-semibold">{broadcast.content?.subject || broadcast.name || 'Untitled broadcast'}</p>
                  <p className="text-xs text-[var(--color-pib-text-muted)] mt-1">{broadcast.content?.preheader || broadcast.channel || 'email'}</p>
                </div>
                <div className="md:col-span-2">
                  <span className={`text-[10px] px-2 py-1 rounded uppercase tracking-wide ${statusPill(broadcast.status)}`}>
                    {broadcast.status ?? 'draft'}
                  </span>
                </div>
                <div className="md:col-span-3 text-sm text-[var(--color-pib-text-muted)] md:text-right">
                  {formatDate(broadcast.scheduledFor ?? broadcast.createdAt)}
                </div>
              </Link>
            ))}
          </div>
        )}
      </CampaignSection>
    </div>
  )
}

function StatTile({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="pib-stat-card">
      <div className="flex items-start justify-between">
        <p className="eyebrow !text-[10px]">{label}</p>
        <span className="material-symbols-outlined text-[18px] text-[var(--color-pib-text-muted)]">{icon}</span>
      </div>
      <p className="mt-3 font-display tracking-tight leading-none text-3xl md:text-4xl">{value}</p>
    </div>
  )
}

function CampaignSection({ title, subhead, children }: { title: string; subhead: string; children: React.ReactNode }) {
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

function CampaignRequests({ requests }: { requests: any[] }) {
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
                  {request.campaignType}
                </span>
                <h3 className="font-headline text-lg font-semibold mt-3">{request.title}</h3>
              </div>
              <span className={`text-[10px] px-2 py-1 rounded uppercase tracking-wide ${statusPill(request.status)}`}>
                {request.status ?? 'new'}
              </span>
            </div>
            <p className="text-sm text-[var(--color-pib-text-muted)] mt-3">{request.goal}</p>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4 text-xs">
              <BriefItem label="Audience" value={request.audience} />
              <BriefItem label="Channels" value={(request.channels ?? []).join(', ')} />
              <BriefItem label="Launch" value={request.launchWindow} />
              <BriefItem label="Budget" value={request.budget} />
            </dl>
            {request.notes && <p className="text-xs text-[var(--color-pib-text-muted)] mt-4 border-t border-[var(--color-pib-line)] pt-3">{request.notes}</p>}
          </div>
        ))}
      </div>
    </section>
  )
}

function BriefItem({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <dt className="eyebrow !text-[9px]">{label}</dt>
      <dd className="mt-1 text-[var(--color-pib-text)]">{value || '-'}</dd>
    </div>
  )
}

function EmailCampaignCard({ campaign, slug }: { campaign: any; slug: string }) {
  const stats = campaign.stats ?? {}
  return (
    <Link href={`/admin/org/${slug}/campaigns/${campaign.id}`} className="pib-card pib-card-hover block !p-5">
      <div className="flex items-start justify-between gap-3">
        <span className={`text-[10px] px-2 py-1 rounded uppercase tracking-wide ${statusPill(campaign.status)}`}>
          {campaign.status ?? 'draft'}
        </span>
        <span className="material-symbols-outlined text-[18px] text-[var(--color-pib-text-muted)]">forward_to_inbox</span>
      </div>
      <h3 className="font-headline text-lg font-semibold mt-4 leading-tight">{campaign.name ?? 'Untitled campaign'}</h3>
      <p className="text-xs text-[var(--color-pib-text-muted)] mt-2">{campaign.description || 'Sequence-driven email program'}</p>
      <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-[var(--color-pib-line)] text-xs">
        <MiniStat label="Audience" value={String(stats.enrolled ?? 0)} />
        <MiniStat label="Open" value={pct(Number(stats.opened ?? 0), Number(stats.sent ?? stats.delivered ?? 0))} />
        <MiniStat label="Click" value={pct(Number(stats.clicked ?? 0), Number(stats.sent ?? stats.delivered ?? 0))} />
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
