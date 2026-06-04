import type { ReactNode } from 'react'
import Link from 'next/link'
import type { Ad, AdCampaign, AdSet } from '@/lib/ads/types'

type AdCampaignDetailWorkspaceProps = {
  surface: 'admin' | 'portal'
  campaign: AdCampaign
  adSets: AdSet[]
  ads: Ad[]
  backHref: string
  actions?: ReactNode
  reviewActions?: ReactNode
  insights?: ReactNode
  adSetHref?: (adSet: AdSet) => string
  adHref?: (ad: Ad) => string
}

function campaignMetaId(campaign: AdCampaign): string {
  const meta = campaign.providerData?.meta as { id?: string } | undefined
  return typeof meta?.id === 'string' ? meta.id : ''
}

function ReviewStatePanel({
  surface,
  campaign,
  reviewActions,
}: {
  surface: 'admin' | 'portal'
  campaign: AdCampaign
  reviewActions?: ReactNode
}) {
  if (!campaign.reviewState) return null

  const isPortal = surface === 'portal'
  const tone =
    campaign.reviewState === 'awaiting'
      ? 'border-amber-500/40 bg-amber-500/5'
      : campaign.reviewState === 'approved'
        ? 'border-emerald-600/40 bg-emerald-600/5'
        : 'border-red-600/40 bg-red-600/5'

  return (
    <div className={['rounded-lg border p-4', tone].join(' ')}>
      {campaign.reviewState === 'awaiting' && (
        <div className="flex items-start gap-3">
          <span className="material-symbols-outlined text-amber-300">campaign</span>
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-100">
              {isPortal ? 'Awaiting your approval' : 'Awaiting client review'}
            </p>
            <p className="mt-0.5 text-xs text-[var(--color-pib-text-muted)]">
              {isPortal
                ? "Partners in Biz drafted this campaign for you. It won't launch until you approve."
                : 'Submitted to the client portal for approval before launch.'}
            </p>
          </div>
        </div>
      )}

      {campaign.reviewState === 'approved' && (
        <p className="text-sm font-medium text-emerald-100">
          {isPortal
            ? 'You approved this campaign. Partners in Biz will launch it shortly.'
            : 'Approved by client - ready to launch'}
        </p>
      )}

      {campaign.reviewState === 'rejected' && (
        <div>
          <p className="text-sm font-medium text-red-100">
            {isPortal ? 'Rejected - sent back for changes' : 'Client requested changes'}
          </p>
          {campaign.rejectionReason && (
            <blockquote className="mt-2 border-l-2 border-red-500/40 pl-3 text-xs text-[var(--color-pib-text-muted)]">
              {campaign.rejectionReason}
            </blockquote>
          )}
        </div>
      )}

      {campaign.reviewState === 'awaiting' && reviewActions && (
        <div className="mt-3">{reviewActions}</div>
      )}
    </div>
  )
}

function MaybeLink({
  href,
  className,
  children,
}: {
  href?: string
  className?: string
  children: ReactNode
}) {
  if (!href) return <span className={className}>{children}</span>
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  )
}

export function AdCampaignDetailWorkspace({
  surface,
  campaign,
  adSets,
  ads,
  backHref,
  actions,
  reviewActions,
  insights,
  adSetHref,
  adHref,
}: AdCampaignDetailWorkspaceProps) {
  const metaId = campaignMetaId(campaign)

  return (
    <article className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link
            href={backHref}
            className="text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]"
          >
            ← Campaigns
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-[var(--color-pib-text)]">
            {campaign.name}
          </h1>
          <div className="mt-1 text-sm text-[var(--color-pib-text-muted)]">
            {campaign.objective.toLowerCase()} · {campaign.status.toLowerCase()} · {campaign.adAccountId}
            {metaId && (
              <>
                {' · Meta id '}
                <code className="text-[var(--color-pib-text-muted)]/70">{metaId}</code>
              </>
            )}
          </div>
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </header>

      <ReviewStatePanel surface={surface} campaign={campaign} reviewActions={reviewActions} />

      <section>
        <h2 className="eyebrow !text-[10px] mb-2">Ad sets · {adSets.length}</h2>
        {adSets.length === 0 ? (
          <div className="rounded border border-dashed border-[var(--color-pib-line)] p-4 text-sm text-[var(--color-pib-text-muted)]">
            No ad sets yet.
          </div>
        ) : (
          <ul className="divide-y divide-[var(--color-pib-line)] rounded border border-[var(--color-pib-line)]">
            {adSets.map((adSet) => {
              const setAds = ads.filter((ad) => ad.adSetId === adSet.id)
              return (
                <li key={adSet.id} className="px-4 py-3 text-sm">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <MaybeLink
                        href={adSetHref?.(adSet)}
                        className="font-medium text-[var(--color-pib-text)] hover:text-[var(--color-pib-accent)]"
                      >
                        {adSet.name}
                      </MaybeLink>
                      <div className="text-xs text-[var(--color-pib-text-muted)]">
                        {adSet.optimizationGoal.toLowerCase()} · {adSet.billingEvent.toLowerCase()}
                      </div>
                    </div>
                    <span className="text-xs uppercase tracking-wide text-[var(--color-pib-text-muted)]">
                      {adSet.status.toLowerCase()}
                    </span>
                  </div>
                  {setAds.length > 0 && (
                    <ul className="mt-2 ml-4 space-y-1 border-l border-[var(--color-pib-line)] pl-3">
                      {setAds.map((ad) => (
                        <li key={ad.id} className="flex items-center justify-between gap-4 text-xs">
                          <MaybeLink
                            href={adHref?.(ad)}
                            className="text-[var(--color-pib-text)] hover:text-[var(--color-pib-accent)]"
                          >
                            {ad.name}{' '}
                            <span className="text-[var(--color-pib-text-muted)]">
                              ({ad.format.toLowerCase()})
                            </span>
                          </MaybeLink>
                          <span className="text-[var(--color-pib-text-muted)]">{ad.status.toLowerCase()}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {insights && (
        <section>
          <h2 className="eyebrow !text-[10px] mb-2">Performance</h2>
          <div className="rounded border border-[var(--color-pib-line)] p-4">
            {insights}
          </div>
        </section>
      )}
    </article>
  )
}
