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
  // Strip secrets AND serialize Firestore Timestamps to plain values before
  // passing to the client components. Server Components can only hand plain
  // objects to Client Components — a raw Firestore Timestamp (a class instance)
  // throws "Only plain objects can be passed…" at render time, which is why
  // this page crashed once a connection (with createdAt/updatedAt/expiresAt
  // timestamps) existed. The connection panels don't read these fields.
  const toMillis = (t: unknown): number | null => {
    if (t && typeof (t as { toMillis?: () => number }).toMillis === 'function') {
      return (t as { toMillis: () => number }).toMillis()
    }
    const s = (t as { _seconds?: number })?._seconds
    return typeof s === 'number' ? s * 1000 : null
  }
  const safe = connections.map(
    ({ accessTokenEnc, refreshTokenEnc, createdAt, updatedAt, expiresAt, ...rest }) =>
      ({
        ...rest,
        createdAt: toMillis(createdAt),
        updatedAt: toMillis(updatedAt),
        expiresAt: toMillis(expiresAt),
      }) as any,
  )
  return (
    <div className="space-y-4">
      <ConnectionsPanel orgSlug={slug} orgId={orgId} connections={safe} />
      <GoogleConnectionsPanel orgSlug={slug} orgId={orgId} connections={safe} />
      <LinkedinConnectionsPanel orgSlug={slug} orgId={orgId} connections={safe} />
      <TiktokConnectionsPanel orgSlug={slug} orgId={orgId} connections={safe} />
    </div>
  )
}
