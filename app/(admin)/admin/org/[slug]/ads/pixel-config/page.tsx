import { resolveOrgIdBySlug } from '@/lib/organizations/resolve-by-slug'
import { listPixelConfigs } from '@/lib/ads/pixel-configs/store'
import { PixelConfigPanel } from '@/components/ads/PixelConfigPanel'
import { LinkedinPixelConfigPanel } from '@/components/ads/LinkedinPixelConfigPanel'

interface Params { slug: string }

export default async function PixelConfigPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params
  const orgId = await resolveOrgIdBySlug(slug)
  if (!orgId) return <div className="text-white/60">Org not found.</div>
  const rawConfigs = await listPixelConfigs({ orgId })
  // Strip secrets before passing to client
  const configs = rawConfigs.map((c) => {
    const safe = { ...c, meta: c.meta ? { ...c.meta } : undefined }
    if (safe.meta) delete (safe.meta as Record<string, unknown>).capiTokenEnc
    return safe
  })

  // Find the first org-wide config (no propertyId) to surface as the LinkedIn panel;
  // fall back to the first config if all have a propertyId.
  const linkedinSourceConfig =
    rawConfigs.find((c) => !c.propertyId) ?? rawConfigs[0] ?? null

  return (
    <div className="space-y-8">
      <PixelConfigPanel orgId={orgId} orgSlug={slug} initialConfigs={configs} />

      {linkedinSourceConfig && (
        <LinkedinPixelConfigPanel
          orgId={orgId}
          orgSlug={slug}
          configId={linkedinSourceConfig.id}
          initial={{
            pixelId: linkedinSourceConfig.linkedin?.pixelId,
            hasCapiToken: !!linkedinSourceConfig.linkedin?.capiTokenEnc,
            testEventCode: linkedinSourceConfig.linkedin?.testEventCode,
          }}
        />
      )}
    </div>
  )
}
