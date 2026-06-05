import { notFound, redirect } from 'next/navigation'
import { adminDb } from '@/lib/firebase/admin'
import { SeoSprintOverview, type SeoSprintOverviewSprint } from '@/components/seo/SeoSprintOverview'
import { loadSeoOverviewStats } from '@/lib/seo/overview'
import {
  resolvePortalSeoUser,
  scopedPortalHref,
  scopeFromSearchParams,
  type PortalSeoSearchParams,
} from './portalSeoScope'

export const dynamic = 'force-dynamic'

function sortSprints(sprints: SeoSprintOverviewSprint[]) {
  return [...sprints].sort((a, b) => {
    const aTime = typeof a.createdAt === 'object' && a.createdAt && 'toMillis' in a.createdAt && typeof a.createdAt.toMillis === 'function'
      ? a.createdAt.toMillis()
      : 0
    const bTime = typeof b.createdAt === 'object' && b.createdAt && 'toMillis' in b.createdAt && typeof b.createdAt.toMillis === 'function'
      ? b.createdAt.toMillis()
      : 0
    return bTime - aTime
  })
}

export default async function PortalSeoIndex({
  searchParams,
}: {
  searchParams?: Promise<PortalSeoSearchParams>
} = {}) {
  const params = await searchParams
  const scope = scopeFromSearchParams(params)
  const user = await resolvePortalSeoUser(scope.orgId)
  if (!user) redirect('/login')
  if (user.forbidden) notFound()
  if (!user.orgId) {
    return (
      <div className="pib-card p-10 text-center text-sm text-[var(--color-pib-text-muted)]">
        No organisation linked to this account.
      </div>
    )
  }

  const query = adminDb.collection('seo_sprints').where('orgId', '==', user.orgId).where('deleted', '==', false)
  const snap = await query.get()
  const sprints = sortSprints(snap.docs.map((doc): SeoSprintOverviewSprint => {
    const data = doc.data() as Partial<SeoSprintOverviewSprint>
    return { ...data, id: doc.id }
  }))
  const singleSprintStats = sprints.length === 1 ? await loadSeoOverviewStats(sprints[0].id) : undefined

  return (
    <SeoSprintOverview
      sprints={sprints}
      singleSprintStats={singleSprintStats}
      sprintBasePath="/portal/seo/sprints"
      sprintHref={(sprint, childPath = '') => scopedPortalHref(`/portal/seo/sprints/${sprint.id}${childPath}`, scope)}
      emptyTitle="SEO Sprint"
      emptyDescription="Your team is preparing your 90-day SEO sprint. Once it's set up you'll see your daily plan, keyword movements, content drafts, and progress here."
    />
  )
}
