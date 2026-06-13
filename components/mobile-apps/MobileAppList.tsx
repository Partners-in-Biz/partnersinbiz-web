'use client'

import type { ReactNode } from 'react'
import type { MobileAppRecord } from '@/lib/mobile-apps/types'

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
    <div className="rounded-2xl border border-[var(--color-pib-line)] bg-white/[0.02] p-3">
      <p className="text-[11px] text-[var(--color-pib-text-muted)]">{label}</p>
      <p className={['mt-1 font-semibold', className ?? ''].join(' ')}>{value}</p>
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
  renderFooter,
}: MobileAppListProps) {
  if (apps.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-[var(--color-pib-line)] bg-[var(--color-pib-card)] p-10 text-center">
        <span className="material-symbols-outlined text-4xl text-[var(--color-pib-accent)]">smartphone</span>
        <h2 className="mt-3 font-headline text-xl font-bold">{emptyTitle}</h2>
        <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">{emptyDescription}</p>
      </div>
    )
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {apps.map((app) => {
        const metric = thirdMetric(app, metricMode)
        return (
          <article
            key={app.id ?? `${app.orgId}-${app.name}-${app.platform}`}
            className="rounded-3xl border border-[var(--color-pib-line)] bg-[var(--color-pib-card)] p-5 space-y-5"
          >
            <div className="flex gap-4">
              {app.assets?.iconUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={app.assets.iconUrl} alt="" className="h-16 w-16 rounded-2xl object-cover" />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/[0.04]">
                  <span className="material-symbols-outlined">apps</span>
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-headline text-xl font-bold">{app.name}</h2>
                  <span className="pill pill-accent uppercase">{app.platform}</span>
                  <span className="pill capitalize">{app.status}</span>
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
