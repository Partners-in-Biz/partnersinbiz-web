import { render, screen } from '@testing-library/react'
import { SeoSprintOverview, type SeoSprintOverviewStats } from '@/components/seo/SeoSprintOverview'

const sprint = {
  id: 'sprint-1',
  siteName: 'Lumen Speeds',
  siteUrl: 'https://lumenspeeds.com',
  currentDay: 34,
  currentPhase: 1,
  health: { signals: [] },
}

const stats: SeoSprintOverviewStats = {
  totalTasks: 10,
  doneTasks: 6,
  pct: 60,
  inFlightCount: 2,
  blockedCount: 0,
  wonThisWeek: 3,
  rankingKeywords: 5,
  topThree: 1,
  totalKeywords: 12,
  liveContent: 4,
  totalContent: 8,
  latestAudit: { score: 91, snapshotDay: 32 },
  recentWins: [],
  movers: [],
}

describe('SeoSprintOverview', () => {
  it('uses the admin sprint base path for client workspace SEO deep links', () => {
    render(
      <SeoSprintOverview
        sprints={[sprint]}
        singleSprintStats={stats}
        sprintBasePath="/admin/seo/sprints"
        emptyTitle="SEO Sprint"
        emptyDescription="Start SEO work for this client."
      />,
    )

    expect(screen.getByRole('heading', { name: 'Day 34 of 90' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /View today's plan/i })).toHaveAttribute(
      'href',
      '/admin/seo/sprints/sprint-1',
    )
    expect(screen.getByRole('link', { name: /All keywords/i })).toHaveAttribute(
      'href',
      '/admin/seo/sprints/sprint-1/keywords',
    )
    expect(screen.getByRole('link', { name: /Content/i })).toHaveAttribute(
      'href',
      '/admin/seo/sprints/sprint-1/content',
    )
  })
})
