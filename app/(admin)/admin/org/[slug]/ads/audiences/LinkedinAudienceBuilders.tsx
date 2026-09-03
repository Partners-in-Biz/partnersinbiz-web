'use client'
// app/(admin)/admin/org/[slug]/ads/audiences/LinkedinAudienceBuilders.tsx
// Client-side subtype picker + builder dispatcher for LinkedIn audiences.
// Phase 3 Batch 3

import { useState } from 'react'
import { LinkedinContactListBuilder } from '@/components/ads/linkedin/audience-builders/ContactListBuilder'
import { LinkedinWebsiteAudienceBuilder } from '@/components/ads/linkedin/audience-builders/WebsiteAudienceBuilder'
import { LinkedinLookalikeAudienceBuilder } from '@/components/ads/linkedin/audience-builders/LookalikeAudienceBuilder'
import { LinkedinEngagementAudienceBuilder } from '@/components/ads/linkedin/audience-builders/EngagementAudienceBuilder'
import { LinkedinAppAudienceInfoCard } from '@/components/ads/linkedin/audience-builders/AppAudienceInfoCard'

type Subtype = 'CUSTOMER_LIST' | 'WEBSITE' | 'LOOKALIKE' | 'ENGAGEMENT' | 'APP'

interface SubtypeTile {
  value: Subtype
  label: string
  description: string
}

const SUBTYPES: SubtypeTile[] = [
  {
    value: 'CUSTOMER_LIST',
    label: 'Customer List',
    description: 'Upload a CSV of contacts to target on LinkedIn.',
  },
  {
    value: 'WEBSITE',
    label: 'Website',
    description: 'Retarget visitors based on Insight Tag URL rules.',
  },
  {
    value: 'LOOKALIKE',
    label: 'Lookalike',
    description: 'Expand reach to LinkedIn members similar to an existing segment.',
  },
  {
    value: 'ENGAGEMENT',
    label: 'Engagement',
    description: 'Target visitors, followers, or video viewers of the client company page.',
  },
  {
    value: 'APP',
    label: 'App',
    description: 'LinkedIn does not support native app audiences  -  see workaround.',
  },
]

interface Props {
  orgId: string
  orgSlug: string
  onCreated?: (audienceId: string) => void
  onCancel?: () => void
}

export function LinkedinAudienceBuilders(props: Props) {
  const [subtype, setSubtype] = useState<Subtype | null>(null)

  if (!subtype) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-[var(--color-pib-text-muted)]">Choose a LinkedIn audience type to create.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {SUBTYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setSubtype(t.value)}
              className="pib-card pib-card-hover text-left group"
            >
              <p className="text-sm font-medium text-[var(--color-pib-text)] group-hover:text-[var(--st-danger)] transition-colors">
                {t.label}
              </p>
              <p className="text-xs text-[var(--color-pib-text-muted)] mt-1">{t.description}</p>
            </button>
          ))}
        </div>
        {props.onCancel && (
          <div className="pt-2">
            <button
              type="button"
              className="btn-pib-ghost text-sm"
              onClick={props.onCancel}
            >
              ← Back
            </button>
          </div>
        )}
      </div>
    )
  }

  const builderProps = { ...props, onCancel: () => setSubtype(null) }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="btn-pib-ghost text-sm"
          onClick={() => setSubtype(null)}
        >
          ← All types
        </button>
        <span className="text-sm font-medium text-[var(--color-pib-text)]">
          {SUBTYPES.find((t) => t.value === subtype)?.label}
        </span>
      </div>

      {subtype === 'CUSTOMER_LIST' && <LinkedinContactListBuilder {...builderProps} />}
      {subtype === 'WEBSITE' && <LinkedinWebsiteAudienceBuilder {...builderProps} />}
      {subtype === 'LOOKALIKE' && <LinkedinLookalikeAudienceBuilder {...builderProps} />}
      {subtype === 'ENGAGEMENT' && <LinkedinEngagementAudienceBuilder {...builderProps} />}
      {subtype === 'APP' && (
        <LinkedinAppAudienceInfoCard
          onSwitchToCustomerList={() => setSubtype('CUSTOMER_LIST')}
          onCancel={() => setSubtype(null)}
        />
      )}
    </div>
  )
}
