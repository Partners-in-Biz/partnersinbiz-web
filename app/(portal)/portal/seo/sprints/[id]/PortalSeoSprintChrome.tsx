'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { scopedPortalPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'
import { CompanyWorkRecordControls } from '@/components/crm/CompanyWorkRecordControls'

const TABS = [
  { key: 'progress', label: 'Progress', icon: 'stacked_line_chart', href: '' },
  { key: 'performance', label: 'Performance', icon: 'speed', href: '/performance' },
  { key: 'pages', label: 'Pages', icon: 'description', href: '/pages' },
  { key: 'blog', label: 'Blog', icon: 'rss_feed', href: '/blog' },
  { key: 'keywords', label: 'Keywords', icon: 'key', href: '/keywords' },
  { key: 'content', label: 'Content', icon: 'article', href: '/content' },
  { key: 'audits', label: 'Audits', icon: 'health_and_safety', href: '/audits' },
] as const

const PHASE_LABELS = ['Pre-launch', 'Foundation', 'Content', 'Authority', 'Compounding'] as const

type PortalSeoSprintChromeSprint = {
  siteName?: string
  siteUrl?: string
  currentDay?: number
  currentPhase?: number
  companyId?: string
  clientVisibility?: 'shared' | 'private'
}

type PortalSeoSprintChromeProps = {
  id: string
  sprint: PortalSeoSprintChromeSprint
  /** owner = the viewer's org owns the sprint; projected = shared in via a partner link. */
  accessMode?: 'owner' | 'projected'
  tasksCount: number
  doneTasks: number
  rankingKeywords: number
  keywordsCount: number
  liveContent: number
  contentCount: number
  children: ReactNode
}

export function PortalSeoSprintChrome({
  id,
  sprint,
  accessMode = 'owner',
  tasksCount,
  doneTasks,
  rankingKeywords,
  keywordsCount,
  liveContent,
  contentCount,
  children,
}: PortalSeoSprintChromeProps) {
  const searchParams = useSearchParams()
  const scope = scopeFromSearchParams(searchParams)
  const day = Number(sprint.currentDay ?? 0)
  const phase = Number(sprint.currentPhase ?? 0)
  const progress = tasksCount > 0 ? Math.round((doneTasks / tasksCount) * 100) : 0
  const seoHref = (path: string) => scopedPortalPath(path, scope)

  return (
    <div className="space-y-4" data-module-accent="green">
      <header className="pib-card !p-0 overflow-hidden">
        <div className="h-0.5 bg-[var(--color-pib-accent)]" />
        <div className="p-4 md:p-5">
          <Link
            href={seoHref('/portal/seo')}
            className="text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] inline-flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-[14px]" aria-hidden="true">arrow_back</span>
            All sprints
          </Link>
          <div className="mt-3 grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4 lg:items-end">
            <div>
              <p className="eyebrow">SEO sprint</p>
              <h1 className="pib-page-title mt-1">
                {sprint.siteName}
              </h1>
              <p className="text-sm text-[var(--color-pib-text-muted)] mt-1 break-all">{sprint.siteUrl}</p>
              <p className="text-sm font-medium mt-2">
                {phase === 4 ? `Compounding - Day ${day}` : `Day ${day} of 90`} - {PHASE_LABELS[phase] ?? 'Active sprint'}
              </p>
              {accessMode === 'projected' ? (
                <span className="mt-2 inline-flex items-center rounded-full bg-[var(--color-accent-v2)]/15 px-2.5 py-1 text-[11px] text-[var(--color-pib-text-muted)]">
                  Shared with you by a partner organisation — view, comment and approve only
                </span>
              ) : sprint.companyId ? (
                <CompanyWorkRecordControls
                  className="mt-2"
                  companyId={sprint.companyId}
                  clientVisibility={sprint.clientVisibility}
                  module="seo"
                  recordId={id}
                  orgId={scope.orgId}
                />
              ) : null}
            </div>
            <div className="grid grid-cols-3 gap-2 min-w-[240px]">
              <MiniStat label="Tasks" value={`${doneTasks}/${tasksCount}`} />
              <MiniStat label="Keywords" value={`${rankingKeywords}/${keywordsCount}`} />
              <MiniStat label="Live posts" value={`${liveContent}/${contentCount}`} />
            </div>
          </div>
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-[var(--color-pib-text-muted)] mb-1.5">
              <span>{progress}% task progress</span>
              <span>{tasksCount} total tasks</span>
            </div>
            <div className="h-1.5 rounded-full bg-[var(--color-pib-line)] overflow-hidden">
              <div className="h-full rounded-full bg-[var(--color-pib-accent)]" style={{ width: `${progress}%` }} />
            </div>
          </div>
        </div>
      </header>

      <nav className="pib-card !p-1.5 flex gap-1 overflow-x-auto">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            href={seoHref(`/portal/seo/sprints/${id}${tab.href}`)}
            className="px-2.5 py-1.5 rounded-md text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-[var(--color-pib-surface-2)] whitespace-nowrap inline-flex items-center gap-1.5 transition-colors"
          >
            <span className="material-symbols-outlined text-[15px]">{tab.icon}</span>
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
    <div className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] p-2.5">
      <p className="eyebrow !text-[9px]">{label}</p>
      <p className="text-lg font-semibold tabular-nums mt-0.5">{value}</p>
    </div>
  )
}
