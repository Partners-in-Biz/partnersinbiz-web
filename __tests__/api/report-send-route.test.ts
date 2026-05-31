import { NextRequest } from 'next/server'

const mockGetReport = jest.fn()
const mockSendCampaignEmail = jest.fn()
const mockUpdate = jest.fn()
const mockWithAuthCalls: string[] = []
const mockCanAccessOrg = jest.fn()
const mockUser = { uid: 'client-1', role: 'client' as const, orgIds: ['org-1'] }

jest.mock('@/lib/api/auth', () => ({
  withAuth: (role: string, handler: (req: NextRequest, user: typeof mockUser, context?: unknown) => Promise<Response>) => {
    mockWithAuthCalls.push(role)
    return async (req: NextRequest, context?: unknown) => handler(req, mockUser, context)
  },
}))

jest.mock('@/lib/api/platformAdmin', () => ({
  canAccessOrg: (...args: unknown[]) => mockCanAccessOrg(...args),
}))

jest.mock('@/lib/api/capabilityGate', () => ({
  enforceAgentCapability: jest.fn(() => null),
}))

jest.mock('@/lib/reports/generate', () => ({
  getReport: (...args: unknown[]) => mockGetReport(...args),
}))

jest.mock('@/lib/email/resend', () => ({
  FROM_ADDRESS: 'reports@example.test',
  sendCampaignEmail: (...args: unknown[]) => mockSendCampaignEmail(...args),
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({ update: mockUpdate })),
    })),
  },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    arrayUnion: jest.fn((...values: string[]) => ({ arrayUnion: values })),
    serverTimestamp: jest.fn(() => 'server-timestamp'),
  },
}))

const report = {
  id: 'report-1',
  orgId: 'org-1',
  publicToken: 'public-report-token',
  brand: { orgName: 'Client One', accent: '#f5a623' },
  period: { start: '2026-05-01', end: '2026-05-31' },
  exec_summary: 'Revenue improved.',
  kpis: {
    total_revenue: 25000,
    deltas: { total_revenue: 12.5 },
  },
}

describe('report send route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
    mockWithAuthCalls.length = 0
    mockCanAccessOrg.mockReturnValue(true)
    mockGetReport.mockResolvedValue(report)
    mockSendCampaignEmail.mockResolvedValue({ ok: true })
  })

  it('lets authenticated clients send reports for accessible organisations', async () => {
    const { POST } = await import('@/app/api/v1/reports/[id]/send/route')

    const res = await POST(new NextRequest('http://localhost/api/v1/reports/report-1/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: ['client@example.test'] }),
    }), { params: Promise.resolve({ id: 'report-1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(mockWithAuthCalls).toContain('client')
    expect(mockCanAccessOrg).toHaveBeenCalledWith(mockUser, 'org-1')
    expect(mockSendCampaignEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: ['client@example.test'],
      subject: expect.stringContaining('Client One'),
    }))
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      sentTo: { arrayUnion: ['client@example.test'] },
      sentAt: 'server-timestamp',
    }))
  })

  it('blocks clients from sending reports outside their organisations', async () => {
    mockCanAccessOrg.mockReturnValue(false)
    const { POST } = await import('@/app/api/v1/reports/[id]/send/route')

    const res = await POST(new NextRequest('http://localhost/api/v1/reports/report-1/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: ['client@example.test'] }),
    }), { params: Promise.resolve({ id: 'report-1' }) })
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toMatch(/forbidden/i)
    expect(mockSendCampaignEmail).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})
