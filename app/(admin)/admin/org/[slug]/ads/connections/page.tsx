// app/(admin)/admin/org/[slug]/ads/connections/page.tsx
import { ConnectionsPanel } from '@/components/ads/ConnectionsPanel'
import { GoogleConnectionsPanel } from '@/components/ads/GoogleConnectionsPanel'
import { LinkedinConnectionsPanel } from '@/components/ads/LinkedinConnectionsPanel'
import { TiktokConnectionsPanel } from '@/components/ads/TiktokConnectionsPanel'
import { listConnections } from '@/lib/ads/connections/store'
import { resolveOrgIdBySlug } from '@/lib/organizations/resolve-by-slug'

interface Params {
  slug: string
}

export default async function ConnectionsPage({
  params,
}: {
  params: Promise<Params>
}) {
  const { slug } = await params
  const orgId = await resolveOrgIdBySlug(slug)
  if (!orgId) {
    return <div className="text-white/60">Org not found.</div>
  }
  const connections = await listConnections({ orgId })
  // Strip secrets before passing to the client components
  const safe = connections.map(({ accessTokenEnc, refreshTokenEnc, ...rest }) => rest as any)
  return (
    <div className="space-y-4">
      <ConnectionsPanel orgSlug={slug} orgId={orgId} connections={safe} />
      <GoogleConnectionsPanel orgSlug={slug} orgId={orgId} connections={safe} />
      <LinkedinConnectionsPanel orgSlug={slug} orgId={orgId} connections={safe} />
      <TiktokConnectionsPanel orgSlug={slug} orgId={orgId} connections={safe} />
    </div>
  )
}
