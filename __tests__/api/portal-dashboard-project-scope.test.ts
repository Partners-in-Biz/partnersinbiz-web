import { NextRequest } from 'next/server'

const mockLoadMemberAccessPolicy = jest.fn()

jest.mock('@/lib/auth/portal-middleware', () => ({
  withPortalAuthAndRole: (_minRole: string, handler: (req: NextRequest, uid: string, orgId: string, role: string) => Promise<Response>) =>
    (req: NextRequest) => handler(req, 'stean', 'pib-platform-owner', 'member'),
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: () => ({
      where: () => ({ get: jest.fn().mockResolvedValue({ docs: [] }) }),
    }),
  },
}))

jest.mock('@/lib/orgMembers/org-access-policy', () => ({
  loadOrgMemberAccessPolicy: (...args: unknown[]) => mockLoadMemberAccessPolicy(...args),
}))

jest.mock('@/lib/reports/snapshot', () => ({
  snapshotKpis: jest.fn().mockResolvedValue(null),
  lastCompletedMonth: jest.fn().mockReturnValue({}),
  monthPeriod: jest.fn().mockReturnValue({ end: '' }),
}))

jest.mock('@/lib/integrations/connections', () => ({ listConnectionsForOrg: jest.fn().mockResolvedValue([]) }))
jest.mock('@/lib/reports/generate', () => ({ listReports: jest.fn().mockResolvedValue([]) }))
jest.mock('@/lib/portal/dashboard-summary', () => ({
  getPortalDashboardSummary: jest.fn().mockResolvedValue({
    onboarding: {},
    counts: {},
    projects: { total: 2, active: 2, recent: [] },
  }),
  getPortalDashboardProjectSummary: jest.fn().mockResolvedValue({ total: 2, active: 2, recent: [] }),
}))

describe('portal dashboard project scope', () => {
  beforeEach(() => jest.clearAllMocks())

  it('does not return organisation project metadata when policy hydration fails', async () => {
    mockLoadMemberAccessPolicy.mockRejectedValue(new Error('policy store unavailable'))
    const { GET } = await import('@/app/api/v1/portal/dashboard/route')

    await expect(GET(new NextRequest('https://partnersinbiz.online/api/v1/portal/dashboard')))
      .rejects.toThrow('policy store unavailable')
  })
})
