// app/(admin)/admin/org/[slug]/ads/merchant-center/page.tsx
// Sub-3a Phase 4 Batch 2 Agent D.

import { resolveOrgIdBySlug } from '@/lib/organizations/resolve-by-slug'
import { MerchantCenterPanel } from '@/components/ads/google/MerchantCenterPanel'

interface Params { slug: string }

export default async function MerchantCenterPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params
  const orgId = await resolveOrgIdBySlug(slug)
  if (!orgId) return <p className="pib-page-sub">Org not found.</p>
  return (
    <div className="space-y-8">
      <header>
        <p className="eyebrow">Ads · Merchant Center</p>
        <h1 className="pib-page-title mt-2">Google Merchant Center</h1>
        <p className="pib-page-sub">
          Connect the client Merchant Center account to enable Google Shopping campaigns. Admin setup only; campaign spend remains approval-gated.
        </p>
      </header>
      <MerchantCenterPanel orgSlug={slug} orgId={orgId} />
    </div>
  )
}
