import Link from 'next/link'
import { adminDb } from '@/lib/firebase/admin'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

const TABS = [
  { key: 'progress', label: 'Progress', icon: 'stacked_line_chart', href: '' },
  { key: 'performance', label: 'Performance', icon: 'speed', href: '/performance' },
  { key: 'pages', label: 'Pages', icon: 'description', href: '/pages' },
  { key: 'blog', label: 'Blog', icon: 'rss_feed', href: '/blog' },
  { key: 'keywords', label: 'Keywords', icon: 'key', href: '/keywords' },
  { key: 'content', label: 'Content', icon: 'article', href: '/content' },
  { key: 'audits', label: 'Audits', icon: 'health_and_safety', href: '/audits' },
]

const PHASE_LABELS = ['Pre-launch', 'Foundation', 'Content', 'Authority', 'Compounding']

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sprint = sprintSnap.data() as any

  const [tasksSnap, keywordsSnap, contentSnap] = await Promise.all([
    adminDb.collection('seo_tasks').where('sprintId', '==', id).where('deleted', '==', false).get(),
    adminDb.collection('seo_keywords').where('sprintId', '==', id).where('deleted', '==', false).get(),
    adminDb.collection('seo_content').where('sprintId', '==', id).where('deleted', '==', false).get(),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tasks = tasksSnap.docs.map((doc) => doc.data() as any)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const keywords = keywordsSnap.docs.map((doc) => doc.data() as any)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content = contentSnap.docs.map((doc) => doc.data() as any)

  const day = Number(sprint.currentDay ?? 0)
  const phase = Number(sprint.currentPhase ?? 0)
  const doneTasks = tasks.filter((task) => task.status === 'done').length
  const progress = tasks.length > 0 ? Math.round((doneTasks / tasks.length) * 100) : 0
  const rankingKeywords = keywords.filter((keyword) => ['ranking', 'top_10', 'top_3'].includes(keyword.status)).length
  const liveContent = content.filter((item) => item.status === 'live').length

  return (
    <div className="space-y-8">
      <header className="pib-card !p-0 overflow-hidden">
        <div className="h-1 bg-[var(--color-pib-accent)]" />
        <div className="p-6 md:p-7">
          <Link
            href="/portal/seo"
            className="text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] inline-flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-[14px]">arrow_back</span>
            All sprints
          </Link>
          <div className="mt-5 grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-6 lg:items-end">
            <div>
              <p className="eyebrow">SEO sprint</p>
              <h1 className="font-headline text-3xl md:text-4xl font-semibold mt-2 tracking-tight">{sprint.siteName}</h1>
              <p className="text-sm text-[var(--color-pib-text-muted)] mt-2 break-all">{sprint.siteUrl}</p>
              <p className="text-sm font-medium mt-3">
                {phase === 4 ? `Compounding - Day ${day}` : `Day ${day} of 90`} - {PHASE_LABELS[phase] ?? 'Active sprint'}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3 min-w-[280px]">
              <MiniStat label="Tasks" value={`${doneTasks}/${tasks.length}`} />
              <MiniStat label="Keywords" value={`${rankingKeywords}/${keywords.length}`} />
              <MiniStat label="Live posts" value={`${liveContent}/${content.length}`} />
            </div>
          </div>
          <div className="mt-6">
            <div className="flex items-center justify-between text-xs text-[var(--color-pib-text-muted)] mb-2">
              <span>{progress}% task progress</span>
              <span>{tasks.length} total tasks</span>
            </div>
            <div className="h-2 rounded-full bg-[var(--color-pib-line)] overflow-hidden">
              <div className="h-full rounded-full bg-[var(--color-pib-accent)]" style={{ width: `${progress}%` }} />
            </div>
          </div>
        </div>
      </header>

      <nav className="pib-card !p-2 flex gap-1 overflow-x-auto">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            href={`/portal/seo/sprints/${id}${tab.href}`}
            className="px-3 py-2 rounded-md text-sm text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-[var(--color-pib-surface-2)] whitespace-nowrap inline-flex items-center gap-2 transition-colors"
          >
            <span className="material-symbols-outlined text-[17px]">{tab.icon}</span>
            {tab.label}
          </Link>
        ))}
      </nav>

      {children}
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] p-3">
      <p className="eyebrow !text-[9px]">{label}</p>
      <p className="font-display text-xl tabular-nums mt-1">{value}</p>
    </div>
  )
}
