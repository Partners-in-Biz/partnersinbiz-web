'use client'
// app/(admin)/admin/org/[slug]/ads/audiences/AudiencesPlatformTabs.tsx
// Platform-level tab switcher: Meta | Google | LinkedIn.
// Renders audience builders client-side; Meta list is passed as RSC children.
// Sub-3a Phase 5 Batch 3 F | Phase 3 Batch 3 (LinkedIn tab added)

import { useState } from 'react'
import { GoogleAudienceBuilders } from './GoogleAudienceBuilders'
import { LinkedinAudienceBuilders } from './LinkedinAudienceBuilders'

type Platform = 'meta' | 'google' | 'linkedin'

interface Props {
  orgId: string
  orgSlug: string
  metaContent: React.ReactNode
}

export function AudiencesPlatformTabs({ orgId, orgSlug, metaContent }: Props) {
  const [platform, setPlatform] = useState<Platform>('meta')

  const PLATFORM_LABELS: Record<Platform, string> = {
    meta: 'Meta',
    google: 'Google',
    linkedin: 'LinkedIn',
  }

  return (
    <div className="space-y-6">
      {/* Platform tabs */}
      <div role="tablist" aria-label="Audience platform" className="pib-tabs pib-tabs-segmented">
        {(['meta', 'google', 'linkedin'] as Platform[]).map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={platform === p}
            onClick={() => setPlatform(p)}
            className={`pib-tab ${platform === p ? 'pib-tab-active' : ''}`}
          >
            {PLATFORM_LABELS[p]}
          </button>
        ))}
      </div>

      {/* Platform content */}
      {platform === 'meta' && metaContent}
      {platform === 'google' && (
        <div className="space-y-4">
          <div>
            <h2 className="pib-page-title text-lg">New Google audience</h2>
            <p className="pib-page-sub mt-1">
              Choose a Google audience type and configure it below.
            </p>
          </div>
          <GoogleAudienceBuilders orgId={orgId} orgSlug={orgSlug} />
        </div>
      )}
      {platform === 'linkedin' && (
        <div className="space-y-4">
          <div>
            <h2 className="pib-page-title text-lg">New LinkedIn audience</h2>
            <p className="pib-page-sub mt-1">
              Choose a LinkedIn audience type and configure it below.
            </p>
          </div>
          <LinkedinAudienceBuilders orgId={orgId} orgSlug={orgSlug} />
        </div>
      )}
    </div>
  )
}
