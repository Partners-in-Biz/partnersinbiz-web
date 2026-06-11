import type { ReactNode } from 'react'
import Link from 'next/link'
import type { AdCampaign } from '@/lib/ads/types'
import { adPlatformLabel, type AdConnectionSummary } from '@/lib/ads/provider-display'

type AdCampaignsWorkspaceProps = {
  surface: 'admin' | 'portal'
  campaigns: AdCampaign[]
  campaignHref: (campaign: AdCampaign) => string
  connectionSummaries?: Partial<Record<AdCampaign['platform'], AdConnectionSummary>>
  title?: string
  description?: string
  actions?: ReactNode
  bulkReviewAction?: ReactNode
  emptyTitle?: string
  emptyBody?: string
  emptyAction?: ReactNode
}

const STATUS_STYLE: Record<string, string> = {
  DRAFT: 'bg-zinc-700/30 text-zinc-300 border border-zinc-600/30',
  PENDING_REVIEW: 'bg-sky-700/30 text-sky-200 border border-sky-600/30',
  ACTIVE: 'bg-emerald-700/30 text-emerald-200 border border-emerald-600/30',
  PAUSED: 'bg-amber-700/30 text-amber-200 border border-amber-600/30',
  ARCHIVED: 'bg-zinc-800 text-zinc-400 border border-zinc-700',
  DELETED: 'bg-red-700/30 text-red-200 border border-red-600/30',
}

function currency(cents?: number | null): string | null {
  if (typeof cents !== 'number') return null
  return `R ${(cents / 100).toLocaleString('en-ZA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function statusStyle(status: string): string {
  return STATUS_STYLE[status] ?? STATUS_STYLE.DRAFT
}

function CampaignRow({
  campaign,
  href,
  highlight,
  connectionSummary,
}: {
  campaign: AdCampaign
  href: string
  highlight?: boolean
  connectionSummary?: AdConnectionSummary
}) {
  const budget =
    currency(campaign.dailyBudget) ?? currency(campaign.lifetimeBudget)
  const budgetLabel = campaign.dailyBudget != null
    ? `${budget} daily`
    : campaign.lifetimeBudget != null
      ? `${budget} lifetime`
      : null

  const providerLabel = connectionSummary?.providerLabel ?? adPlatformLabel(campaign.platform)
  const accountStatus = connectionSummary?.accountStatus
  const accountStatusLabel = accountStatus === 'ready'
    ? 'Connected account'
    : accountStatus === 'account_not_selected'
      ? 'Account not selected'
      : accountStatus === 'not_connected'
        ? 'No matching connection'
        : null
  const accountLabel = connectionSummary?.accountLabel ?? campaign.adAccountId

  return (
    <li
      className={[
        'rounded-lg border p-4 transition-colors',
        highlight
          ? 'border-amber-500/40 bg-amber-500/5 hover:bg-amber-500/10'
          : 'border-[var(--color-pib-line)] bg-white/[0.02] hover:bg-white/[0.04]',
      ].join(' ')}
    >
      <Link href={href} className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="font-medium text-[var(--color-pib-text)] truncate">
            {campaign.name}
          </div>
          <div className="mt-0.5 text-xs text-[var(--color-pib-text-muted)]">
            {campaign.objective.toLowerCase()} · {providerLabel} · {accountLabel}
            {accountStatusLabel ? ` · ${accountStatusLabel}` : ''}
            {budgetLabel ? ` · ${budgetLabel}` : ''}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {highlight && (
            <span className="rounded-full border border-amber-500/40 bg-amber-500/20 px-2 py-0.5 text-[10px] uppercase tracking-wide text-amber-200">
              Review needed
            </span>
          )}
          <span
            className={[
              'rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide',
              statusStyle(campaign.status),
            ].join(' ')}
          >
            {campaign.status.toLowerCase()}
          </span>
        </div>
      </Link>
    </li>
  )
}

export function AdCampaignsWorkspace({
  surface,
  campaigns,
  campaignHref,
  connectionSummaries,
  title = 'Campaigns',
  description,
  actions,
  bulkReviewAction,
  emptyTitle = 'No campaigns yet.',
  emptyBody,
  emptyAction,
}: AdCampaignsWorkspaceProps) {
  const awaiting = campaigns.filter((campaign) => campaign.reviewState === 'awaiting')
  const other = campaigns.filter((campaign) => campaign.reviewState !== 'awaiting')

  return (
    <section className="space-y-6">
      {(title || description || actions) && (
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            {title && (
              <h2 className={surface === 'admin' ? 'text-2xl font-semibold text-[var(--color-pib-text)]' : 'eyebrow !text-[10px]'}>
                {title}
              </h2>
            )}
            {description && (
              <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">
                {description}
              </p>
            )}
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </header>
      )}

      {campaigns.length === 0 ? (
        <div className="pib-card p-8 text-center">
          <p className="text-sm font-medium text-[var(--color-pib-text)]">{emptyTitle}</p>
          {emptyBody && (
            <p className="mx-auto mt-2 max-w-xl text-sm text-[var(--color-pib-text-muted)]">
              {emptyBody}
            </p>
          )}
          {emptyAction && <div className="mt-4">{emptyAction}</div>}
        </div>
      ) : (
        <div className="space-y-6">
          {awaiting.length > 0 && (
            <section>
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="eyebrow !text-[10px]">Awaiting review · {awaiting.length}</h3>
                {bulkReviewAction}
              </div>
              <ul className="space-y-2">
                {awaiting.map((campaign) => (
                  <CampaignRow
                    key={campaign.id}
                    campaign={campaign}
                    href={campaignHref(campaign)}
                    connectionSummary={connectionSummaries?.[campaign.platform]}
                    highlight
                  />
                ))}
              </ul>
            </section>
          )}

          {other.length > 0 && (
            <section>
              <h3 className="eyebrow !text-[10px] mb-2">Campaigns · {other.length}</h3>
              <ul className="space-y-2">
                {other.map((campaign) => (
                  <CampaignRow
                    key={campaign.id}
                    campaign={campaign}
                    href={campaignHref(campaign)}
                    connectionSummary={connectionSummaries?.[campaign.platform]}
                  />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </section>
  )
}
