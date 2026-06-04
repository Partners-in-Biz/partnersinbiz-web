import { adminDb } from '@/lib/firebase/admin'
import type { SeoSprintOverviewStats } from '@/components/seo/SeoSprintOverview'

interface SeoTaskRecord {
  id: string
  status?: unknown
  title?: unknown
  completedAt?: unknown
}

interface SeoKeywordPosition {
  position: number
  pulledAt: string
}

interface SeoKeywordRecord {
  id: string
  status?: unknown
  keyword?: unknown
  positions?: unknown
}

interface SeoContentRecord {
  id: string
  status?: unknown
}

interface SeoAuditRecord {
  score?: unknown
  snapshotDay?: unknown
}

function timestampMillis(value: unknown) {
  if (!value || typeof value !== 'object') return 0

  const candidate = value as { toMillis?: unknown }
  if (typeof candidate.toMillis !== 'function') return 0

  return candidate.toMillis()
}

function numericValue(value: unknown) {
  return typeof value === 'number' ? value : 0
}

function isKeywordPosition(value: unknown): value is SeoKeywordPosition {
  if (!value || typeof value !== 'object') return false
  const position = value as Partial<SeoKeywordPosition>
  return typeof position.position === 'number' && typeof position.pulledAt === 'string'
}

export async function loadSeoOverviewStats(sprintId: string): Promise<SeoSprintOverviewStats> {
  const [tasksSnap, keywordsSnap, contentSnap, auditsSnap] = await Promise.all([
    adminDb.collection('seo_tasks').where('sprintId', '==', sprintId).where('deleted', '==', false).get(),
    adminDb.collection('seo_keywords').where('sprintId', '==', sprintId).where('deleted', '==', false).get(),
    adminDb.collection('seo_content').where('sprintId', '==', sprintId).where('deleted', '==', false).get(),
    adminDb.collection('seo_audits').where('sprintId', '==', sprintId).limit(20).get(),
  ])

  const tasks = tasksSnap.docs.map((doc): SeoTaskRecord => {
    const data = doc.data() as Omit<SeoTaskRecord, 'id'>
    return { ...data, id: doc.id }
  })
  const keywords = keywordsSnap.docs.map((doc): SeoKeywordRecord => {
    const data = doc.data() as Omit<SeoKeywordRecord, 'id'>
    return { ...data, id: doc.id }
  })
  const content = contentSnap.docs.map((doc): SeoContentRecord => {
    const data = doc.data() as Omit<SeoContentRecord, 'id'>
    return { ...data, id: doc.id }
  })
  const audits = auditsSnap.docs.map((doc): SeoAuditRecord => doc.data() as SeoAuditRecord)

  const totalTasks = tasks.length
  const doneTasks = tasks.filter((task) => task.status === 'done').length
  const inFlightTasks = tasks.filter((task) => task.status === 'in_progress')
  const blockedTasks = tasks.filter((task) => task.status === 'blocked')
  const recentWins = tasks
    .filter((task) => task.status === 'done')
    .sort((a, b) => timestampMillis(b.completedAt) - timestampMillis(a.completedAt))
    .slice(0, 5)
    .map((task) => ({ id: task.id, title: typeof task.title === 'string' ? task.title : '', completedAt: task.completedAt }))

  const week7DaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  const wonThisWeek = tasks.filter(
    (task) => task.status === 'done' && timestampMillis(task.completedAt) > week7DaysAgo,
  ).length

  const rankingKeywords = keywords.filter(
    (keyword) => keyword.status === 'ranking' || keyword.status === 'top_10' || keyword.status === 'top_3',
  ).length
  const topThree = keywords.filter((keyword) => keyword.status === 'top_3').length

  const movers = keywords
    .map((keyword) => {
      const positions = Array.isArray(keyword.positions)
        ? keyword.positions.filter(isKeywordPosition)
        : []
      if (positions.length < 2) return null
      const sorted = [...positions].sort(
        (a, b) => new Date(b.pulledAt).getTime() - new Date(a.pulledAt).getTime(),
      )
      const latest = sorted[0]
      const previous = sorted[1]
      const delta = previous.position - latest.position
      if (delta <= 0) return null
      return {
        keyword: typeof keyword.keyword === 'string' ? keyword.keyword : '',
        current: latest.position,
        delta,
        status: typeof keyword.status === 'string' ? keyword.status : undefined,
      }
    })
    .filter((mover): mover is NonNullable<typeof mover> => mover !== null)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 3)

  const liveContent = content.filter((item) => item.status === 'live').length
  const latestAudit = audits.sort(
    (a, b) => numericValue(b.snapshotDay) - numericValue(a.snapshotDay),
  )[0]

  return {
    totalTasks,
    doneTasks,
    pct: totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0,
    inFlightCount: inFlightTasks.length,
    blockedCount: blockedTasks.length,
    wonThisWeek,
    rankingKeywords,
    topThree,
    totalKeywords: keywords.length,
    liveContent,
    totalContent: content.length,
    latestAudit: latestAudit
      ? {
          score: typeof latestAudit.score === 'number' || typeof latestAudit.score === 'string'
            ? latestAudit.score
            : null,
          snapshotDay: typeof latestAudit.snapshotDay === 'number' ? latestAudit.snapshotDay : null,
        }
      : null,
    recentWins,
    movers,
  }
}
