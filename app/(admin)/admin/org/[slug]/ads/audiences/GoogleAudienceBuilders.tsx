'use client'
// app/(admin)/admin/org/[slug]/ads/audiences/GoogleAudienceBuilders.tsx
// Client-side tab switcher for the 6 Google audience builder subtypes.
// Sub-3a Phase 5 Batch 3 F

import { useState } from 'react'
import { CustomerMatchBuilder } from '@/components/ads/google/audience-builders/CustomerMatchBuilder'
import { RemarketingBuilder } from '@/components/ads/google/audience-builders/RemarketingBuilder'
import { CustomSegmentBuilder } from '@/components/ads/google/audience-builders/CustomSegmentBuilder'
import { AffinityPicker } from '@/components/ads/google/audience-builders/AffinityPicker'
import { InMarketPicker } from '@/components/ads/google/audience-builders/InMarketPicker'
import { DemographicsPicker } from '@/components/ads/google/audience-builders/DemographicsPicker'

type GoogleSubtype =
  | 'CUSTOMER_MATCH'
  | 'REMARKETING'
  | 'CUSTOM_SEGMENT'
  | 'AFFINITY'
  | 'IN_MARKET'
  | 'DETAILED_DEMOGRAPHICS'

const SUBTYPES: { value: GoogleSubtype; label: string }[] = [
  { value: 'CUSTOMER_MATCH', label: 'Customer Match' },
  { value: 'REMARKETING', label: 'Remarketing' },
  { value: 'CUSTOM_SEGMENT', label: 'Custom Segment' },
  { value: 'AFFINITY', label: 'Affinity' },
  { value: 'IN_MARKET', label: 'In-Market' },
  { value: 'DETAILED_DEMOGRAPHICS', label: 'Detailed Demographics' },
]

interface Props {
  orgId: string
  orgSlug: string
}

export function GoogleAudienceBuilders({ orgId, orgSlug }: Props) {
  const [subtype, setSubtype] = useState<GoogleSubtype>('CUSTOMER_MATCH')

  const sharedProps = { orgId, orgSlug }

  return (
    <div className="space-y-6">
      {/* Subtype tabs */}
      <div role="tablist" aria-label="Google audience subtype" className="pib-tabs">
        {SUBTYPES.map((t) => (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={subtype === t.value}
            onClick={() => setSubtype(t.value)}
            className={`pib-tab ${subtype === t.value ? 'pib-tab-active' : ''}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Active builder */}
      <div>
        {subtype === 'CUSTOMER_MATCH' && <CustomerMatchBuilder {...sharedProps} />}
        {subtype === 'REMARKETING' && <RemarketingBuilder {...sharedProps} />}
        {subtype === 'CUSTOM_SEGMENT' && <CustomSegmentBuilder {...sharedProps} />}
        {subtype === 'AFFINITY' && <AffinityPicker {...sharedProps} />}
        {subtype === 'IN_MARKET' && <InMarketPicker {...sharedProps} />}
        {subtype === 'DETAILED_DEMOGRAPHICS' && <DemographicsPicker {...sharedProps} />}
      </div>
    </div>
  )
}
