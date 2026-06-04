import Link from 'next/link'

const PHASE_LABELS = ['Pre-launch', 'Foundation', 'Content', 'Authority', 'Compounding'] as const

export interface SeoSprintOverviewSprint {
  id: string
  siteName?: string
  siteUrl?: string
  currentDay?: number
  currentPhase?: number
  createdAt?: unknown
  health?: {
    signals?: unknown[]
  }
}

export interface SeoSprintOverviewStats {
  totalTasks: number
  doneTasks: number
  pct: number
  inFlightCount: number
  blockedCount: number
  wonThisWeek: number
  rankingKeywords: number
  topThree: number
  totalKeywords: number
  liveContent: number
  totalContent: number
  latestAudit?: {
    score?: number | string | null
    snapshotDay?: number | null
  } | null
  recentWins: Array<{
    id: string
    title?: string
    completedAt?: unknown
  }>
  movers: Array<{
    keyword: string
    current: number
    delta: number
    status?: string
  }>
}

interface SeoSprintOverviewProps {
  sprints: SeoSprintOverviewSprint[]
  singleSprintStats?: SeoSprintOverviewStats
  sprintBasePath: string
  sprintHref?: (sprint: SeoSprintOverviewSprint, childPath?: string) => string
  emptyTitle: string
  emptyDescription: string
  emptyAction?: {
    label: string
    href: string
  }
}

const EMPTY_STATS: SeoSprintOverviewStats = {
  totalTasks: 0,
  doneTasks: 0,
  pct: 0,
  inFlightCount: 0,
  blockedCount: 0,
  wonThisWeek: 0,
  rankingKeywords: 0,
  topThree: 0,
  totalKeywords: 0,
  liveContent: 0,
  totalContent: 0,
  latestAudit: null,
  recentWins: [],
  movers: [],
}

function phaseLabel(phase: number) {
  return PHASE_LABELS[phase] ?? PHASE_LABELS[0]
}

function sprintPath(basePath: string, sprintId: string, childPath = '') {
  return `${basePath}/${encodeURIComponent(sprintId)}${childPath}`
}

function formatCompletedAt(value: unknown) {
  if (!value) return ''

  let date: Date | null = null
  if (value instanceof Date) {
    date = value
  } else if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    date = Number.isNaN(parsed.getTime()) ? null : parsed
  } else if (typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    date = value.toDate()
  }

  if (!date) return ''
  return date.toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'short',
  })
}

export function SeoSprintOverview({
  sprints,
  singleSprintStats,
  sprintBasePath,
  sprintHref,
  emptyTitle,
  emptyDescription,
  emptyAction,
}: SeoSprintOverviewProps) {
  const hrefForSprint = (sprint: SeoSprintOverviewSprint, childPath = '') =>
    sprintHref ? sprintHref(sprint, childPath) : sprintPath(sprintBasePath, sprint.id, childPath)

  if (sprints.length === 0) {
    return (
      <div className="pib-card p-12 text-center max-w-xl mx-auto">
        <span className="material-symbols-outlined text-[48px] text-[var(--color-pib-text-muted)] mb-3">
          trending_up
        </span>
        <h1 className="text-2xl font-semibold mb-3">{emptyTitle}</h1>
        <p className="text-sm text-[var(--color-pib-text-muted)]">
          {emptyDescription}
        </p>
        {emptyAction && (
          <Link href={emptyAction.href} className="pib-btn-primary mt-6 inline-flex text-sm">
            {emptyAction.label}
          </Link>
        )}
      </div>
    )
  }

  if (sprints.length > 1) {
    return (
      <div className="space-y-8">
        <header>
          <p className="eyebrow">SEO</p>
          <h1 className="font-headline text-3xl md:text-4xl font-semibold mt-2">SEO Sprints</h1>
          <p className="text-sm text-[var(--color-pib-text-muted)]">
            Track progress, performance, and impact over each 90-day plan.
          </p>
        </header>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sprints.map((sprint) => {
            const day = sprint.currentDay ?? 0
            const phase = sprint.currentPhase ?? 0
            const signals = sprint.health?.signals?.length ?? 0
            return (
              <Link
                key={sprint.id}
                href={hrefForSprint(sprint)}
                className="pib-card pib-card-hover p-5 space-y-2"
              >
                <div className="text-xs text-[var(--color-pib-text-muted)]">
                  {phase === 4 ? `Compounding - Day ${day}` : `Day ${day} of 90`} - {phaseLabel(phase)}
                </div>
                <h3 className="text-lg font-semibold">{sprint.siteName}</h3>
                <p className="text-xs text-[var(--color-pib-text-muted)] truncate">{sprint.siteUrl}</p>
                <p className="text-sm font-medium pt-2">
                  {signals === 0 ? 'All systems normal' : `${signals} attention items`}
                </p>
              </Link>
            )
          })}
        </div>
      </div>
    )
  }

  const sprint = sprints[0]
  const stats = singleSprintStats ?? EMPTY_STATS
  const day = sprint.currentDay ?? 0
  const phase = sprint.currentPhase ?? 0
  const overallPct = phase === 4 ? 100 : Math.round((day / 90) * 100)
  const signals = sprint.health?.signals ?? []

  return (
    <div className="space-y-8">
      <section className="pib-card p-8 space-y-5 overflow-hidden relative">
        <div className="absolute inset-x-0 top-0 h-1 bg-[var(--color-pib-accent)]" />
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="space-y-1">
            <p className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)]">
              SEO Sprint - {sprint.siteName}
            </p>
            <h1 className="text-3xl font-semibold">
              {phase === 4 ? `Phase 4 - Compounding - Day ${day}` : `Day ${day} of 90`}
            </h1>
            <p className="text-sm text-[var(--color-pib-text-muted)]">
              {phaseLabel(phase)} - {sprint.siteUrl}
            </p>
          </div>
          <div className="text-right">
            <div className="text-4xl font-semibold tabular-nums">{stats.pct}%</div>
            <div className="text-xs text-[var(--color-pib-text-muted)]">tasks complete</div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-[var(--color-pib-text-muted)]">
            <span>{stats.doneTasks} of {stats.totalTasks} tasks done</span>
            <span>{phase === 4 ? 'Beyond Day 90' : `${overallPct}% through 90 days`}</span>
          </div>
          <div className="w-full h-2 bg-[var(--color-pib-line)] rounded-full overflow-hidden">
            <div
              className="h-2 bg-[var(--color-pib-accent)] rounded-full transition-all"
              style={{ width: `${stats.pct}%` }}
            />
          </div>
        </div>
      </section>

      {signals.length > 0 && (
        <section className="pib-card p-5 border-amber-500/30 bg-amber-500/5 space-y-2">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-amber-500 text-[20px]">notifications_active</span>
            <h3 className="font-semibold text-sm">
              {signals.length} thing{signals.length === 1 ? '' : 's'} need attention
            </h3>
          </div>
          <p className="text-xs text-[var(--color-pib-text-muted)]">
            The autoresearch loop has flagged signals worth investigating. Your team is on it.
          </p>
        </section>
      )}

      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Won this week"
          value={String(stats.wonThisWeek)}
          sub={`${stats.inFlightCount} in flight`}
          icon="task_alt"
        />
        <StatCard
          label="Keywords ranking"
          value={`${stats.rankingKeywords}/${stats.totalKeywords}`}
          sub={`${stats.topThree} in top 3`}
          icon="emoji_events"
        />
        <StatCard
          label="Content live"
          value={`${stats.liveContent}/${stats.totalContent}`}
          sub="Posts published"
          icon="article"
        />
        <StatCard
          label="Latest audit"
          value={stats.latestAudit?.score != null ? `${stats.latestAudit.score}` : '-'}
          sub={stats.latestAudit?.snapshotDay != null ? `Day ${stats.latestAudit.snapshotDay}` : 'Pending'}
          icon="health_and_safety"
        />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="pib-card p-5 space-y-3 lg:col-span-1">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">today</span>
            Today&apos;s focus
          </h3>
          <div className="space-y-2 text-sm">
            <Row label="In flight" value={stats.inFlightCount} accent={stats.inFlightCount > 0} />
            <Row label="Blocked" value={stats.blockedCount} muted={stats.blockedCount === 0} />
            <Row label="Done this week" value={stats.wonThisWeek} accent={stats.wonThisWeek > 0} />
          </div>
          <Link
            href={hrefForSprint(sprint)}
            className="text-xs font-medium text-[var(--color-pib-accent-hover)] hover:underline inline-flex items-center gap-1 pt-1"
          >
            View today&apos;s plan
            <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
          </Link>
        </div>

        <div className="pib-card p-5 space-y-3 lg:col-span-1">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">trending_up</span>
            Top movers
          </h3>
          {stats.movers.length === 0 ? (
            <p className="text-xs text-[var(--color-pib-text-muted)]">
              No keyword movement yet. Rankings update daily after Search Console syncs.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {stats.movers.map((mover) => (
                <li key={mover.keyword} className="flex items-center justify-between">
                  <span className="truncate pr-2">{mover.keyword}</span>
                  <span className="text-xs font-medium text-green-500 shrink-0">
                    +{mover.delta} - #{mover.current}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link
            href={hrefForSprint(sprint, '/keywords')}
            className="text-xs font-medium text-[var(--color-pib-accent-hover)] hover:underline inline-flex items-center gap-1 pt-1"
          >
            All keywords
            <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
          </Link>
        </div>

        <div className="pib-card p-5 space-y-3 lg:col-span-1">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">check_circle</span>
            Recent wins
          </h3>
          {stats.recentWins.length === 0 ? (
            <p className="text-xs text-[var(--color-pib-text-muted)]">
              First wins will land here as tasks complete.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {stats.recentWins.map((task) => (
                <li key={task.id} className="flex items-start justify-between gap-3">
                  <span className="text-xs leading-relaxed">{task.title}</span>
                  <span className="text-[10px] text-[var(--color-pib-text-muted)] shrink-0 pt-0.5">
                    {formatCompletedAt(task.completedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <DeepLink href={hrefForSprint(sprint)} icon="today" label="Today's plan" />
        <DeepLink href={hrefForSprint(sprint, '/keywords')} icon="key" label="Keywords" />
        <DeepLink href={hrefForSprint(sprint, '/content')} icon="article" label="Content" />
        <DeepLink href={hrefForSprint(sprint, '/audits')} icon="health_and_safety" label="Audits" />
        <DeepLink href={hrefForSprint(sprint, '/pages')} icon="description" label="Pages" />
        <DeepLink href={hrefForSprint(sprint, '/blog')} icon="rss_feed" label="Blog drafts" />
        <DeepLink href={hrefForSprint(sprint, '/performance')} icon="speed" label="Performance" />
      </section>
    </div>
  )
}

function StatCard({ label, value, sub, icon }: { label: string; value: string; sub: string; icon: string }) {
  return (
    <div className="pib-stat-card space-y-1">
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)]">{label}</p>
        <span className="material-symbols-outlined text-[16px] text-[var(--color-pib-text-muted)] opacity-70">
          {icon}
        </span>
      </div>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-[11px] text-[var(--color-pib-text-muted)]">{sub}</p>
    </div>
  )
}

function Row({
  label,
  value,
  accent,
  muted,
}: {
  label: string
  value: number
  accent?: boolean
  muted?: boolean
}) {
  return (
    <div className="flex items-center justify-between">
      <span className={muted ? 'text-[var(--color-pib-text-muted)]' : ''}>{label}</span>
      <span
        className={[
          'tabular-nums font-medium',
          accent ? 'text-[var(--color-pib-accent-hover)]' : '',
          muted ? 'text-[var(--color-pib-text-muted)]' : '',
        ].join(' ')}
      >
        {value}
      </span>
    </div>
  )
}

function DeepLink({ href, icon, label }: { href: string; icon: string; label: string }) {
  return (
    <Link
      href={href}
      className="pib-card pib-card-hover p-3 flex items-center gap-2 transition-colors"
    >
      <span className="material-symbols-outlined text-[18px] text-[var(--color-pib-text-muted)]">{icon}</span>
      <span className="text-sm font-medium">{label}</span>
    </Link>
  )
}
