import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { SeoSprintOverview, type SeoSprintOverviewSprint } from '@/components/seo/SeoSprintOverview'
import { loadSeoOverviewStats } from '@/lib/seo/overview'

export const dynamic = 'force-dynamic'

async function currentUser(): Promise<{ uid: string; orgId?: string } | null> {
  const cookieStore = await cookies()
  const cookieName = process.env.SESSION_COOKIE_NAME ?? '__session'
  const session = cookieStore.get(cookieName)?.value
  if (!session) return null

  try {
    const decoded = await adminAuth.verifySessionCookie(session, true)
    const userDoc = await adminDb.collection('users').doc(decoded.uid).get()
    return { uid: decoded.uid, orgId: userDoc.data()?.orgId }
  } catch {
    return null
  }
}

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

export default async function PortalSeoIndex() {
  const user = await currentUser()
  if (!user) redirect('/login')

  let query = adminDb.collection('seo_sprints').where('deleted', '==', false)
  if (user.orgId) query = query.where('orgId', '==', user.orgId)

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
      emptyTitle="SEO Sprint"
      emptyDescription="Your team is preparing your 90-day SEO sprint. Once it's set up you'll see your daily plan, keyword movements, content drafts, and progress here."
    />
  )
}
