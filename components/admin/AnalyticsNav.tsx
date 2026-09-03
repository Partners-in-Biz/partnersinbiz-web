'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

const TAB_KEYS = [
  { label: 'Overview', key: 'overview' },
  { label: 'Realtime', key: 'realtime' },
  { label: 'Traffic', key: 'traffic' },
  { label: 'Audience', key: 'audience' },
  { label: 'Events', key: 'events' },
  { label: 'Custom Events', key: 'custom-events' },
  { label: 'Sessions', key: 'sessions' },
  { label: 'Users', key: 'users' },
  { label: 'Funnels', key: 'funnels' },
  { label: 'Conversions', key: 'conversions' },
  { label: 'Revenue', key: 'revenue' },
  { label: 'Attribution', key: 'attribution' },
  { label: 'Retention', key: 'retention' },
  { label: 'Heatmaps', key: 'heatmaps' },
  { label: 'UTM Builder', key: 'utm-builder' },
  { label: 'Reports', key: 'reports' },
  { label: 'Live', key: 'live' },
  { label: 'Install', key: 'settings' },
]

export function AnalyticsNav({ active, propertyId: selectedPropertyId, basePath = '/portal/analytics' }: { active: string; propertyId?: string; basePath?: string }) {
  const searchParams = useSearchParams()
  const propertyId = selectedPropertyId || searchParams?.get('propertyId')
  return (
    <nav
      className="flex flex-wrap gap-1 border-b border-[var(--color-card-border)] pb-2"
      data-module-accent="violet"
      aria-label="Analytics sections"
    >
      {TAB_KEYS.map(t => {
        const href = `${basePath}/${t.key}`
        return (
          <Link
            key={href}
            href={propertyId ? `${href}?propertyId=${encodeURIComponent(propertyId)}` : href}
            className={`px-2.5 py-1 text-xs font-medium transition-colors border-b-2 ${
              active === t.key
                ? 'border-[var(--sc-accent)] text-[var(--sc-ink)]'
                : 'border-transparent text-[var(--sc-ink-soft)] hover:text-[var(--sc-ink)]'
            }`}
          >
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
