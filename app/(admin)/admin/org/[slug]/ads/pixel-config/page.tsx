import { resolveOrgIdBySlug } from '@/lib/organizations/resolve-by-slug'
import { listPixelConfigs } from '@/lib/ads/pixel-configs/store'
import { PixelConfigPanel } from '@/components/ads/PixelConfigPanel'
import { LinkedinPixelConfigPanel } from '@/components/ads/LinkedinPixelConfigPanel'
import { TiktokPixelConfigPanel } from '@/components/ads/TiktokPixelConfigPanel'

interface Params { slug: string }

export default async function PixelConfigPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params
  const orgId = await resolveOrgIdBySlug(slug)
  if (!orgId) return <p className="pib-page-sub">Org not found.</p>
  const rawConfigs = await listPixelConfigs({ orgId })
  // Strip secrets before passing to client
  const configs = rawConfigs.map((c) => {
    const safe = { ...c, meta: c.meta ? { ...c.meta } : undefined }
    if (safe.meta) delete (safe.meta as Record<string, unknown>).capiTokenEnc
    return safe
  })

  // Find the first org-wide config (no propertyId) to surface as the LinkedIn + TikTok panels;
  // fall back to the first config if all have a propertyId.
  const orgWideConfig =
    rawConfigs.find((c) => !c.propertyId) ?? rawConfigs[0] ?? null

  return (
    <div className="space-y-8">
      <header>
        <p className="eyebrow">Ads · Pixel &amp; CAPI</p>
        <h1 className="pib-page-title mt-2">Pixel &amp; Conversions API</h1>
        <p className="pib-page-sub">Configure server-side and browser tracking for this client's ad accounts.</p>
      </header>
      <PixelConfigPanel orgId={orgId} orgSlug={slug} initialConfigs={configs} />

      {orgWideConfig && (
        <LinkedinPixelConfigPanel
          orgId={orgId}
          orgSlug={slug}
          configId={orgWideConfig.id}
          initial={{
            pixelId: orgWideConfig.linkedin?.pixelId,
            hasCapiToken: !!orgWideConfig.linkedin?.capiTokenEnc,
            testEventCode: orgWideConfig.linkedin?.testEventCode,
          }}
        />
      )}

      {orgWideConfig && (
        <TiktokPixelConfigPanel
          orgId={orgId}
          orgSlug={slug}
          configId={orgWideConfig.id}
          initial={{
            pixelCode: orgWideConfig.tiktok?.pixelId,
            hasCapiToken: !!orgWideConfig.tiktok?.capiTokenEnc,
            testEventCode: orgWideConfig.tiktok?.testEventCode,
          }}
        />
      )}
    </div>
  )
}
