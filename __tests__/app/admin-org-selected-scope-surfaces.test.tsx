import '@testing-library/jest-dom'
import { render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'fs'
import * as path from 'path'
import OrgDashboard from '@/app/(admin)/admin/org/[slug]/dashboard/page'

jest.mock('next/link', () => {
  return function MockLink({ href, children, ...props }: { href: string; children: React.ReactNode }) {
    return <a href={href} {...props}>{children}</a>
  }
})

jest.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'lumen' }),
}))

jest.mock('@/components/ui/Charts', () => ({
  StatCardWithChart: ({ label, value }: { label: string; value: string | number }) => <div>{label}: {value}</div>,
  DonutChart: () => <div>Donut chart</div>,
  HorizontalBarChart: () => <div>Bar chart</div>,
  TrendAreaChart: () => <div>Trend chart</div>,
}))

jest.mock('@/components/social/ScheduledContentPreviewCards', () => ({
  ScheduledContentPreviewCards: () => <div>Scheduled content preview</div>,
}))

function routeSource(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

describe('selected client-org admin command surfaces', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-14T09:00:00Z'))
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/organizations') {
        return jsonResponse({ data: [{ id: 'org-1', slug: 'lumen', name: 'Lumen' }] })
      }
      if (url === '/api/v1/projects?view=received&orgId=org-1') {
        expect(init?.headers).toEqual(expect.objectContaining({ 'X-Org-Id': 'org-1', 'X-Org-Slug': 'lumen' }))
        return jsonResponse({ data: [{ id: 'project-1', name: 'Operator rollout', status: 'active' }] })
      }
      if (url.startsWith('/api/v1/social/stats?orgId=org-1')) {
        expect(init?.headers).toEqual(expect.objectContaining({ 'X-Org-Id': 'org-1', 'X-Org-Slug': 'lumen' }))
        return jsonResponse({ data: { total: 0, byStatus: { draft: 0, pending_approval: 0, approved: 0, scheduled: 0, published: 0, failed: 0, cancelled: 0 }, byPlatform: {}, approvalRate: 0, last30Days: 0 } })
      }
      if (url.startsWith('/api/v1/social/posts?orgId=org-1')) {
        expect(init?.headers).toEqual(expect.objectContaining({ 'X-Org-Id': 'org-1', 'X-Org-Slug': 'lumen' }))
        return jsonResponse({ data: [] })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('resolves slug to orgId before the admin dashboard loads tenant-scoped data', async () => {
    render(<OrgDashboard />)

    expect(await screen.findByText('Operator rollout')).toBeInTheDocument()
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/projects?view=received&orgId=org-1', expect.objectContaining({
        headers: expect.objectContaining({ 'X-Org-Id': 'org-1', 'X-Org-Slug': 'lumen' }),
      }))
    })
  })

  it('keeps selected-org route copy and links operator-scoped', () => {
    const dashboard = routeSource('app/(admin)/admin/org/[slug]/dashboard/page.tsx')
    const activity = routeSource('app/(admin)/admin/org/[slug]/activity/page.tsx')
    const settings = routeSource('app/(admin)/admin/org/[slug]/settings/page.tsx')
    const billing = routeSource('app/(admin)/admin/org/[slug]/billing/page.tsx')
    const team = routeSource('app/(admin)/admin/org/[slug]/team/page.tsx')
    const integrations = routeSource('app/(admin)/admin/org/[slug]/integrations/page.tsx')
    const emailDomains = routeSource('app/(admin)/admin/org/[slug]/email-domains/page.tsx')

    expect(dashboard).toContain('eyebrow="Admin org dashboard"')
    expect(activity).toContain('No selected-org activity yet.')
    expect(settings).toContain('selected org')
    expect(settings).not.toContain('client portal')
    expect(billing).toContain('selected org')
    expect(team).toContain('PiB operator access')
    expect(team).not.toContain('client workspace')
    expect(integrations).toContain('surface="admin"')
    expect(integrations).toContain('orgSlug={slug}')
    expect(emailDomains).toContain('surface="admin"')
    expect(emailDomains).toContain('orgSlug={slug}')
    expect(`${dashboard}\n${activity}\n${settings}\n${billing}\n${team}\n${integrations}\n${emailDomains}`).not.toContain('/portal')
  })
})
