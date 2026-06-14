'use client'
// app/(admin)/admin/org/[slug]/ads/campaigns/new/NewCampaignClient.tsx
// Platform picker + conditional wizard mount.
// Sub-3a Phase 2 Batch 4 — additive edit, Meta path unchanged.
// Sub-3a Phase 3 Batch 2 Agent D — extended to 3-way picker (+ Google Display).
// Sub-3a Phase 4 Batch 2 Agent D — extended to 4-way picker (+ Google Shopping).
// Sub-3b Phase 2 Batch 3C — extended to 5-way picker (+ LinkedIn).
// Sub-3c Phase 2 Batch 3B — extended to 6-way picker (+ TikTok).

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CampaignBuilder } from '@/components/ads/CampaignBuilder'
import { SearchCampaignBuilder } from '@/components/ads/google/SearchCampaignBuilder'
import { DisplayCampaignBuilder } from '@/components/ads/google/DisplayCampaignBuilder'
import { ShoppingCampaignBuilder } from '@/components/ads/google/ShoppingCampaignBuilder'
import { LinkedinCampaignBuilder } from '@/components/ads/LinkedinCampaignBuilder'
import { TiktokCampaignBuilder } from '@/components/ads/TiktokCampaignBuilder'

type Platform = 'meta' | 'google-search' | 'google-display' | 'google-shopping' | 'linkedin' | 'tiktok'

const PLATFORM_OPTIONS: { value: Platform; label: string; description?: string }[] = [
  { value: 'meta', label: 'Meta (Facebook / Instagram)' },
  { value: 'google-search', label: 'Google Search' },
  { value: 'google-display', label: 'Google Display' },
  { value: 'google-shopping', label: 'Google Shopping', description: 'Shopping ads from the client Merchant Center product feed.' },
  { value: 'linkedin', label: 'LinkedIn', description: 'Sponsored Content, Text Ads, and Message Ads on LinkedIn.' },
  { value: 'tiktok', label: 'TikTok', description: 'In-Feed Ads, TopView, and Spark Ads on TikTok.' },
]

interface Props {
  orgId: string
  orgSlug: string
  currency: string
}

export function NewCampaignClient({ orgId, orgSlug, currency }: Props) {
  const router = useRouter()
  const [platform, setPlatform] = useState<Platform>('meta')

  return (
    <div>
      {/* Platform picker */}
      <div className="mb-8 flex items-center gap-6">
        <span className="text-sm font-medium text-white/60">Platform:</span>
        <div className="flex gap-3">
          {PLATFORM_OPTIONS.map((p) => (
            <label
              key={p.value}
              className={`flex items-center gap-2 rounded border px-4 py-2 text-sm cursor-pointer transition-colors ${
                platform === p.value
                  ? 'border-[#F5A623] bg-[#F5A623]/5 text-[#F5A623]'
                  : 'border-white/10 text-white/60 hover:bg-white/5'
              }`}
            >
              <input
                type="radio"
                name="platform"
                value={p.value}
                checked={platform === p.value}
                onChange={() => setPlatform(p.value)}
                className="sr-only"
                aria-label={p.label}
              />
              {p.label}
            </label>
          ))}
        </div>
      </div>

      {platform === 'meta' && (
        <CampaignBuilder
          orgId={orgId}
          orgSlug={orgSlug}
          currency={currency}
          onComplete={(r) => {
            router.push(`/admin/org/${orgSlug}/ads/campaigns/${r.campaignId}?created=1`)
          }}
          onCancel={() => router.push(`/admin/org/${orgSlug}/ads/campaigns`)}
        />
      )}

      {platform === 'google-search' && (
        <SearchCampaignBuilder
          orgId={orgId}
          orgSlug={orgSlug}
          onCancel={() => router.push(`/admin/org/${orgSlug}/ads/campaigns`)}
        />
      )}

      {platform === 'google-display' && (
        <DisplayCampaignBuilder
          orgId={orgId}
          orgSlug={orgSlug}
          onCancel={() => router.push(`/admin/org/${orgSlug}/ads/campaigns`)}
        />
      )}

      {platform === 'google-shopping' && (
        <ShoppingCampaignBuilder
          orgId={orgId}
          orgSlug={orgSlug}
          onCancel={() => router.push(`/admin/org/${orgSlug}/ads/campaigns`)}
        />
      )}

      {platform === 'linkedin' && (
        <LinkedinCampaignBuilder
          orgId={orgId}
          orgSlug={orgSlug}
          currency={currency}
          onComplete={(r) => {
            router.push(`/admin/org/${orgSlug}/ads/campaigns/${r.campaignId}?created=1`)
          }}
          onCancel={() => router.push(`/admin/org/${orgSlug}/ads/campaigns`)}
        />
      )}

      {platform === 'tiktok' && (
        <TiktokCampaignBuilder
          orgId={orgId}
          orgSlug={orgSlug}
          currency={currency}
          onComplete={(r) => {
            router.push(`/admin/org/${orgSlug}/ads/campaigns/${r.campaignId}?created=1`)
          }}
          onCancel={() => router.push(`/admin/org/${orgSlug}/ads/campaigns`)}
        />
      )}
    </div>
  )
}
