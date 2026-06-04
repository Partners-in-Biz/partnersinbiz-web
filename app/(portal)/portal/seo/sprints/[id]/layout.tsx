import { adminDb } from '@/lib/firebase/admin'
import { notFound, redirect } from 'next/navigation'
import { resolvePortalSeoUser } from '../../portalSeoScope'
import { PortalSeoSprintChrome } from './PortalSeoSprintChrome'

export const dynamic = 'force-dynamic'

type SeoSprintRecord = {
  orgId?: string
  siteName?: string
  siteUrl?: string
  currentDay?: number | string
  currentPhase?: number | string
}

type StatusRecord = {
  status?: string
}

function safeNumber(value: unknown): number {
  const number = Number(value ?? 0)
  return Number.isFinite(number) ? number : 0
}

export default async function PortalSprintLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const sprintSnap = await adminDb.collection('seo_sprints').doc(id).get()
  if (!sprintSnap.exists) notFound()
  const sprint = sprintSnap.data() as SeoSprintRecord
  if (!sprint.orgId) notFound()

  const user = await resolvePortalSeoUser(sprint.orgId)
  if (!user) redirect('/login')
  if (user.forbidden) notFound()

  const [tasksSnap, keywordsSnap, contentSnap] = await Promise.all([
    adminDb.collection('seo_tasks').where('sprintId', '==', id).where('deleted', '==', false).get(),
    adminDb.collection('seo_keywords').where('sprintId', '==', id).where('deleted', '==', false).get(),
    adminDb.collection('seo_content').where('sprintId', '==', id).where('deleted', '==', false).get(),
  ])

  const tasks = tasksSnap.docs.map((doc) => doc.data() as StatusRecord)
  const keywords = keywordsSnap.docs.map((doc) => doc.data() as StatusRecord)
  const content = contentSnap.docs.map((doc) => doc.data() as StatusRecord)

  const doneTasks = tasks.filter((task) => task.status === 'done').length
  const rankingKeywords = keywords.filter(
    (keyword) => typeof keyword.status === 'string' && ['ranking', 'top_10', 'top_3'].includes(keyword.status),
  ).length
  const liveContent = content.filter((item) => item.status === 'live').length

  return (
    <PortalSeoSprintChrome
      id={id}
      sprint={{
        siteName: sprint.siteName,
        siteUrl: sprint.siteUrl,
        currentDay: safeNumber(sprint.currentDay),
        currentPhase: safeNumber(sprint.currentPhase),
      }}
      tasksCount={tasks.length}
      doneTasks={doneTasks}
      rankingKeywords={rankingKeywords}
      keywordsCount={keywords.length}
      liveContent={liveContent}
      contentCount={content.length}
    >
      {children}
    </PortalSeoSprintChrome>
  )
}
