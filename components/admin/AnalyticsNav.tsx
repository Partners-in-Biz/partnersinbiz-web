'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

const TABS = [
  { label: 'Events', href: '/admin/analytics/events', key: 'events' },
  { label: 'Sessions', href: '/admin/analytics/sessions', key: 'sessions' },
  { label: 'Users', href: '/admin/analytics/users', key: 'users' },
  { label: 'Funnels', href: '/admin/analytics/funnels', key: 'funnels' },
  { label: 'Retention', href: '/admin/analytics/retention', key: 'retention' },
  { label: 'Live', href: '/admin/analytics/live', key: 'live' },
]

export function AnalyticsNav({ active, propertyId: selectedPropertyId }: { active: string; propertyId?: string }) {
  const searchParams = useSearchParams()
  const propertyId = selectedPropertyId || searchParams?.get('propertyId')
  return (
    <nav className="flex gap-1 border-b border-[var(--color-card-border)] pb-3 flex-wrap">
      {TABS.map(t => (
        <Link
          key={t.href}
          href={propertyId ? `${t.href}?propertyId=${encodeURIComponent(propertyId)}` : t.href}
          className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
            active === t.key
              ? 'bg-amber-400/20 text-amber-400'
              : 'text-on-surface-variant hover:text-on-surface'
          }`}>
          {t.label}
        </Link>
      ))}
    </nav>
  )
}
