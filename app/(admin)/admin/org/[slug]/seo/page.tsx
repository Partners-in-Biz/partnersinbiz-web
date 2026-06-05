import { notFound } from 'next/navigation'
import { adminDb } from '@/lib/firebase/admin'
import { SeoSprintOverview, type SeoSprintOverviewSprint } from '@/components/seo/SeoSprintOverview'
import { loadSeoOverviewStats } from '@/lib/seo/overview'

export const dynamic = 'force-dynamic'

function timestampValue(value: unknown) {
  if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') {
    return value.toMillis()
  }
  return 0
}

export default async function OrgSeoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  const orgSnap = await adminDb.collection('organizations').where('slug', '==', slug).limit(1).get()
  if (orgSnap.empty) notFound()

  const orgDoc = orgSnap.docs[0]
  const orgId = orgDoc.id
  const org = orgDoc.data()

  const sprintsSnap = await adminDb
    .collection('seo_sprints')
    .where('orgId', '==', orgId)
    .where('deleted', '==', false)
    .get()

  const sprints = sprintsSnap.docs
    .map((doc): SeoSprintOverviewSprint => {
      const data = doc.data() as Partial<SeoSprintOverviewSprint>
      return { ...data, id: doc.id }
    })
    .sort((a, b) => timestampValue(b.createdAt) - timestampValue(a.createdAt))
  const singleSprintStats = sprints.length === 1 ? await loadSeoOverviewStats(sprints[0].id) : undefined
  const orgName = typeof org.name === 'string' && org.name ? org.name : slug

  return (
    <SeoSprintOverview
      sprints={sprints}
      singleSprintStats={singleSprintStats}
      sprintBasePath="/admin/seo/sprints"
      emptyTitle="SEO Sprint"
      emptyDescription={`Start a 90-day structured SEO sprint for ${orgName}. It will seed daily work, surface keyword movement, and keep progress visible in the client workspace.`}
      emptyAction={{
        label: 'Create SEO sprint',
        href: `/admin/seo/sprints/new?orgId=${encodeURIComponent(orgId)}&clientId=${encodeURIComponent(orgId)}&siteName=${encodeURIComponent(orgName)}`,
      }}
    />
  )
}
