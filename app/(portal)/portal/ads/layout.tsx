'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { scopedPortalPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

export default function PortalAdsLayout({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams()
  const scope = scopeFromSearchParams(searchParams)

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <Link
            href={scopedPortalPath('/portal/marketing', scope)}
            className="text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]"
          >
            ← Marketing
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-[var(--color-pib-text)]">Ads</h1>
          <p className="text-sm text-[var(--color-pib-text-muted)]">
            Your multi-platform ad campaigns and any drafts awaiting your review.
          </p>
        </div>
        <Link
          href={scopedPortalPath('/portal/ads/activity', scope)}
          className="shrink-0 mt-1 text-xs text-[var(--color-pib-accent)] hover:text-[var(--color-pib-accent-hover)]"
        >
          Activity →
        </Link>
      </header>
      {children}
    </div>
  )
}
