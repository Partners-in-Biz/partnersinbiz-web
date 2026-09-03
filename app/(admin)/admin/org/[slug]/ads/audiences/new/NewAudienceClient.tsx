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
      <section className="space-y-6">
        <header>
          <p className="eyebrow">Ads · Audiences</p>
          <h1 className="pib-page-title mt-2">New custom audience</h1>
          <p className="pib-page-sub">Choose a platform to start.</p>
        </header>
        <div className="flex gap-3">
          {(['meta', 'linkedin'] as Platform[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPlatform(p)}
              className="pib-card pib-card-hover px-6 py-3 text-sm font-medium text-[var(--color-pib-text)]"
            >
              {PLATFORM_LABELS[p]}
            </button>
          ))}
        </div>
      </section>
    )
  }

  // LinkedIn  -  full builder dispatched from LinkedinAudienceBuilders
  if (platform === 'linkedin') {
    return (
      <section className="space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <p className="eyebrow">Ads · Audiences</p>
            <h1 className="pib-page-title mt-2">New LinkedIn audience</h1>
          </div>
          <button className="btn-pib-ghost text-sm" onClick={() => setPlatform(null)}>
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

  // Meta  -  Step 2: Pick audience type
  if (!type) {
    return (
      <section className="space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <p className="eyebrow">Ads · Audiences</p>
            <h1 className="pib-page-title mt-2">New Meta audience</h1>
          </div>
          <button className="btn-pib-ghost text-sm" onClick={() => setPlatform(null)}>
            ← Pick different platform
          </button>
        </header>
        <p className="text-sm text-[var(--color-pib-text-muted)]">Pick a type to start.</p>
        <CustomAudienceTypePicker onSelect={setType} />
      </section>
    )
  }

  const props = { orgId, onComplete: handleComplete, onCancel: handleCancel }

  return (
    <section className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <p className="eyebrow">Ads · Audiences</p>
          <h1 className="pib-page-title mt-2">New {type.toLowerCase().replace('_', ' ')} audience</h1>
        </div>
        <button className="btn-pib-ghost text-sm" onClick={() => setType(null)}>← Pick different type</button>
      </header>
      {type === 'CUSTOMER_LIST' && <CustomerListBuilder {...props} />}
      {type === 'WEBSITE' && <WebsiteCABuilder {...props} />}
      {type === 'LOOKALIKE' && <LookalikeBuilder {...props} />}
      {type === 'APP' && <AppCABuilder {...props} />}
      {type === 'ENGAGEMENT' && <EngagementCABuilder {...props} />}
    </section>
  )
}
