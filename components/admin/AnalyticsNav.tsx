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
    <nav className="flex gap-1 border-b border-[var(--color-card-border)] pb-3 flex-wrap">
      {TAB_KEYS.map(t => {
        const href = `${basePath}/${t.key}`
        return (
          <Link
            key={href}
            href={propertyId ? `${href}?propertyId=${encodeURIComponent(propertyId)}` : href}
            className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
              active === t.key
                ? 'bg-amber-400/20 text-amber-400'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}>
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
