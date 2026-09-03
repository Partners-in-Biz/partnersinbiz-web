'use client'

import type { ReactNode } from 'react'
import type { MobileAppRecord } from '@/lib/mobile-apps/types'
import { EmptyState } from '@/components/ui/AppFoundation'
import { HudChip } from '@/components/ui/HudChip'

import { Icon } from '@/components/studio'

type MobileAppListMetricMode = 'portal' | 'admin'

interface MobileAppListProps {
  apps: MobileAppRecord[]
  emptyTitle: string
  emptyDescription: string
  metricMode?: MobileAppListMetricMode
  showListingDetails?: boolean
  showReleaseNotes?: boolean
  renderActions?: (app: MobileAppRecord) => ReactNode
  renderEmptyAction?: () => ReactNode
  renderFooter?: (app: MobileAppRecord) => ReactNode
}

function textValue(value: unknown, fallback = '-'): string {
  if (value === null || value === undefined || value === '') return fallback
  return String(value)
}

function accessLabel(app: MobileAppRecord): string {
  return textValue(app.access?.accessStatus, 'unknown').replace(/_/g, ' ')
}

function ratingLabel(app: MobileAppRecord, mode: MobileAppListMetricMode): string {
  const rating = app.analyticsSnapshot?.averageRating
  const reviews = app.analyticsSnapshot?.reviewCount
  if (mode === 'admin') {
    return `${rating ?? '-'}${reviews ? ` (${reviews})` : ''}`
  }
  return rating ? `${rating}` : '-'
}

function thirdMetric(app: MobileAppRecord, mode: MobileAppListMetricMode) {
  if (mode === 'admin') {
    return { label: 'Access', value: accessLabel(app), className: 'capitalize' }
  }
  return {
    label: 'Reviews',
    value: app.analyticsSnapshot?.reviewCount ? `${app.analyticsSnapshot.reviewCount}` : '-',
  }
}

function MobileAppMetric({
  className,
  label,
  value,
}: {
  className?: string
  label: string
  value: string
}) {
  return (
    <div className="rounded-md border border-[var(--color-pib-line)] bg-white/[0.02] p-2">
      <p className="text-[10px] text-[var(--color-pib-text-muted)]">{label}</p>
      <p className={['mt-0.5 text-sm font-medium tabular-nums', className ?? ''].join(' ')}>{value}</p>
    </div>
  )
}

export function MobileAppList({
  apps,
  emptyTitle,
  emptyDescription,
  metricMode = 'portal',
  showListingDetails = false,
  showReleaseNotes = false,
  renderActions,
  renderEmptyAction,
  renderFooter,
}: MobileAppListProps) {
  if (apps.length === 0) {
    return (
      <EmptyState
        icon="smartphone"
        title={emptyTitle}
        description={emptyDescription}
        action={renderEmptyAction ? renderEmptyAction() : undefined}
      />
    )
  }

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {apps.map((app) => {
        const metric = thirdMetric(app, metricMode)
        return (
          <article
            key={app.id ?? `${app.orgId}-${app.name}-${app.platform}`}
            className="pib-card space-y-3 p-4"
            data-module-accent="cyan"
          >
            <div className="flex gap-3">
              {app.assets?.iconUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={app.assets.iconUrl} alt="" className="h-12 w-12 rounded-md object-cover" />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-md bg-[var(--color-pib-cyan-soft)] text-[#5EEAD4]">
                  <Icon name="apps" className="text-[20px]" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <h2 className="text-base font-medium">{app.name}</h2>
                  <HudChip tone="live" className="uppercase">{app.platform}</HudChip>
                  <HudChip className="capitalize">{app.status}</HudChip>
                </div>
                <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">
                  {app.listing?.subtitle || app.listing?.shortDescription || 'Listing details are being prepared.'}
                </p>
              </div>
            </div>

            {renderActions ? <div className="flex flex-wrap gap-2">{renderActions(app)}</div> : null}

            <div className="grid grid-cols-3 gap-3 text-sm">
              <MobileAppMetric label="Version" value={app.releaseManagement?.currentVersion || '-'} />
              <MobileAppMetric label="Rating" value={ratingLabel(app, metricMode)} />
              <MobileAppMetric label={metric.label} value={metric.value} className={metric.className} />
            </div>

            {showListingDetails && app.listing?.longDescription ? (
              <section>
                <p className="eyebrow !text-[10px]">Store listing</p>
                <p className="mt-2 line-clamp-6 whitespace-pre-line text-sm text-[var(--color-pib-text-muted)]">
                  {app.listing.longDescription}
                </p>
              </section>
            ) : null}

            {showReleaseNotes && app.releaseManagement?.releaseNotes ? (
              <section>
                <p className="eyebrow !text-[10px]">Release notes</p>
                <p className="mt-2 whitespace-pre-line text-sm text-[var(--color-pib-text-muted)]">
                  {app.releaseManagement.releaseNotes}
                </p>
              </section>
            ) : null}

            {renderFooter ? renderFooter(app) : null}
          </article>
        )
      })}
    </div>
  )
}
