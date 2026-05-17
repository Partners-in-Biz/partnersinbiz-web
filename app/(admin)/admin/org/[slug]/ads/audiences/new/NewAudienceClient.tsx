'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { AdCustomAudienceType, AdCustomAudience } from '@/lib/ads/types'
import { CustomAudienceTypePicker } from '@/components/ads/CustomAudienceTypePicker'
import { CustomerListBuilder } from '@/components/ads/audience-builders/CustomerListBuilder'
import { WebsiteCABuilder } from '@/components/ads/audience-builders/WebsiteCABuilder'
import { LookalikeBuilder } from '@/components/ads/audience-builders/LookalikeBuilder'
import { AppCABuilder } from '@/components/ads/audience-builders/AppCABuilder'
import { EngagementCABuilder } from '@/components/ads/audience-builders/EngagementCABuilder'
import { LinkedinAudienceBuilders } from '../LinkedinAudienceBuilders'

type Platform = 'meta' | 'linkedin'

const PLATFORM_LABELS: Record<Platform, string> = { meta: 'Meta', linkedin: 'LinkedIn' }

interface Props { orgId: string; orgSlug: string }

export function NewAudienceClient({ orgId, orgSlug }: Props) {
  const router = useRouter()
  const [platform, setPlatform] = useState<Platform | null>(null)
  const [type, setType] = useState<AdCustomAudienceType | null>(null)

  function handleComplete(ca: AdCustomAudience) {
    router.push(`/admin/org/${orgSlug}/ads/audiences/${ca.id}?created=1`)
  }
  function handleCancel() {
    router.push(`/admin/org/${orgSlug}/ads/audiences`)
  }
  function handleLinkedinCreated(audienceId: string) {
    router.push(`/admin/org/${orgSlug}/ads/audiences/${audienceId}?created=1`)
  }

  // Step 1: Pick platform
  if (!platform) {
    return (
      <section className="space-y-4">
        <header>
          <h1 className="text-2xl font-semibold">New custom audience</h1>
          <p className="text-sm text-white/60 mt-1">Choose a platform to start.</p>
        </header>
        <div className="flex gap-3">
          {(['meta', 'linkedin'] as Platform[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPlatform(p)}
              className="rounded-lg border border-white/10 bg-white/5 px-6 py-3 text-sm font-medium hover:border-[#F5A623]/40 hover:bg-white/10 transition-colors"
            >
              {PLATFORM_LABELS[p]}
            </button>
          ))}
        </div>
      </section>
    )
  }

  // LinkedIn — full builder dispatched from LinkedinAudienceBuilders
  if (platform === 'linkedin') {
    return (
      <section className="space-y-4">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">New LinkedIn audience</h1>
          <button className="text-sm text-white/40 underline" onClick={() => setPlatform(null)}>
            ← Pick different platform
          </button>
        </header>
        <LinkedinAudienceBuilders
          orgId={orgId}
          orgSlug={orgSlug}
          onCreated={handleLinkedinCreated}
          onCancel={handleCancel}
        />
      </section>
    )
  }

  // Meta — Step 2: Pick audience type
  if (!type) {
    return (
      <section className="space-y-4">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">New Meta audience</h1>
          <button className="text-sm text-white/40 underline" onClick={() => setPlatform(null)}>
            ← Pick different platform
          </button>
        </header>
        <p className="text-sm text-white/60">Pick a type to start.</p>
        <CustomAudienceTypePicker onSelect={setType} />
      </section>
    )
  }

  const props = { orgId, onComplete: handleComplete, onCancel: handleCancel }

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">New {type.toLowerCase().replace('_', ' ')} audience</h1>
        <button className="text-sm text-white/40 underline" onClick={() => setType(null)}>← Pick different type</button>
      </header>
      {type === 'CUSTOMER_LIST' && <CustomerListBuilder {...props} />}
      {type === 'WEBSITE' && <WebsiteCABuilder {...props} />}
      {type === 'LOOKALIKE' && <LookalikeBuilder {...props} />}
      {type === 'APP' && <AppCABuilder {...props} />}
      {type === 'ENGAGEMENT' && <EngagementCABuilder {...props} />}
    </section>
  )
}
