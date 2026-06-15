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
      if (url === '/api/v1/organizations/org-1') {
        return jsonResponse({
          data: {
            id: 'org-1',
            name: 'Lumen',
            settings: {
              portalModules: {
                mobileApps: false,
                youtubeStudio: true,
                bookStudio: false,
              },
              defaultApprovalRequired: true,
              timezone: 'Africa/Johannesburg',
              preferredSendHourLocal: 8,
              preferredSendDaysOfWeek: [1, 2, 3, 4],
              replyNotifyEmails: ['ops@lumen.test'],
            },
          },
        })
      }
      if (url === '/api/v1/organizations/org-1/members') {
        return jsonResponse({
          data: [
            { userId: 'owner-1', role: 'owner', accessScope: 'all' },
            { userId: 'admin-1', role: 'admin', accessScope: 'marketing' },
            { userId: 'viewer-1', role: 'viewer', accessScope: 'readonly' },
          ],
        })
      }
      if (url === '/api/v1/admin/agent-tasks?orgId=org-1') {
        return jsonResponse({
          data: {
            total: 2,
            byStatus: {
              pending: 1,
              'in-progress': 1,
              blocked: 0,
              done: 0,
            },
            cards: [
              {
                id: 'task-1',
                title: 'Audit homepage',
                assigneeAgentId: 'theo',
                agentStatus: 'in-progress',
                projectName: 'Operator rollout',
                href: '/admin/org/lumen/projects/project-1?task=task-1',
                updatedAt: '2026-06-14T08:30:00.000Z',
              },
            ],
          },
        })
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

    expect((await screen.findAllByText('Operator rollout')).length).toBeGreaterThan(0)
    expect(screen.getByText('Admin control plane')).toBeInTheDocument()
    expect(screen.getByText('Client portal exposure')).toBeInTheDocument()
    expect(screen.getByText('Access and roles')).toBeInTheDocument()
    expect(screen.getByText('Operating rules')).toBeInTheDocument()
    expect(screen.getByText('Live operator workload')).toBeInTheDocument()
    expect(screen.getByText('Audit homepage')).toBeInTheDocument()
    expect(screen.getByText(/theo/i)).toBeInTheDocument()
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/projects?view=received&orgId=org-1', expect.objectContaining({
        headers: expect.objectContaining({ 'X-Org-Id': 'org-1', 'X-Org-Slug': 'lumen' }),
      }))
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/organizations/org-1', expect.any(Object))
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/organizations/org-1/members', expect.any(Object))
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/admin/agent-tasks?orgId=org-1', expect.any(Object))
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

  it('keeps selected-org admin routes and admin-mode shared components off portal defaults', () => {
    const adminRouteSources = [
      'app/(admin)/admin/org/[slug]/dashboard/page.tsx',
      'app/(admin)/admin/org/[slug]/settings/page.tsx',
      'app/(admin)/admin/org/[slug]/team/page.tsx',
      'app/(admin)/admin/org/[slug]/activity/page.tsx',
      'app/(admin)/admin/org/[slug]/crm/companies/[id]/page.tsx',
      'app/(admin)/admin/org/[slug]/capture-sources/page.tsx',
      'app/(admin)/admin/org/[slug]/campaigns/page.tsx',
      'app/(admin)/admin/org/[slug]/social/page.tsx',
      'app/(admin)/admin/org/[slug]/mobile-apps/page.tsx',
      'app/(admin)/admin/org/[slug]/youtube-studio/page.tsx',
      'app/(admin)/admin/org/[slug]/book-studio/page.tsx',
      'app/(admin)/admin/org/[slug]/marketing/page.tsx',
      'app/(admin)/admin/org/[slug]/research/page.tsx',
      'app/(admin)/admin/org/[slug]/documents/page.tsx',
      'app/(admin)/admin/org/[slug]/intelligence/page.tsx',
      'app/(admin)/admin/org/[slug]/integrations/page.tsx',
      'app/(admin)/admin/org/[slug]/email-domains/page.tsx',
      'app/(admin)/admin/org/[slug]/seo/page.tsx',
      'app/(admin)/admin/org/[slug]/wiki/page.tsx',
    ]
      .map(routeSource)
      .join('\n')

    expect(adminRouteSources).not.toMatch(/\bsurface=["']portal["']/)
    expect(adminRouteSources).not.toMatch(/\bmode=["']portal["']/)
    expect(adminRouteSources).not.toMatch(/\bhref=["']\/portal\b/)
    expect(adminRouteSources).not.toMatch(/router\.push\(["']\/portal\b/)
    expect(adminRouteSources).not.toMatch(/redirect\(["']\/portal\b/)
    expect(adminRouteSources).not.toMatch(/client workspace/i)

    const clientDocuments = routeSource('components/client-documents/ClientDocumentsWorkspace.tsx')
    const crmCompanyWorkspace = routeSource('components/crm/CompanyWorkspacePanel.tsx')
    const researchDetail = routeSource('components/research/ResearchDetailClient.tsx')

    expect(clientDocuments).not.toContain("orgName || 'Client workspace'")
    expect(clientDocuments).not.toContain("surface === 'admin' ? 'Client Documents'")
    expect(crmCompanyWorkspace).not.toContain('Client workspace gate')
    expect(researchDetail).not.toContain('client workspace')
  })
})
