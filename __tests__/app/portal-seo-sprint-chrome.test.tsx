import { render, screen } from '@testing-library/react'
import { PortalSeoSprintChrome } from '@/app/(portal)/portal/seo/sprints/[id]/PortalSeoSprintChrome'

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('orgId=lumen-org&orgSlug=lumen-speeds'),
}))

describe('PortalSeoSprintChrome', () => {
  it('keeps company scope on all sprint navigation links', () => {
    render(
      <PortalSeoSprintChrome
        id="lumen-sprint"
        sprint={{
          siteName: 'Lumen',
          siteUrl: 'https://lumenspeeds.com',
          currentDay: 12,
          currentPhase: 1,
        }}
        tasksCount={4}
        doneTasks={2}
        rankingKeywords={1}
        keywordsCount={3}
        liveContent={1}
        contentCount={2}
      >
        <div>Daily plan</div>
      </PortalSeoSprintChrome>,
    )

    expect(screen.getByRole('link', { name: /All sprints/i })).toHaveAttribute(
      'href',
      '/portal/seo?orgId=lumen-org&orgSlug=lumen-speeds',
    )
    expect(screen.queryByRole('link', { name: /arrow_back All sprints/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Progress/i })).toHaveAttribute(
      'href',
      '/portal/seo/sprints/lumen-sprint?orgId=lumen-org&orgSlug=lumen-speeds',
    )
    expect(screen.getByRole('link', { name: /Keywords/i })).toHaveAttribute(
      'href',
      '/portal/seo/sprints/lumen-sprint/keywords?orgId=lumen-org&orgSlug=lumen-speeds',
    )
  })
})
