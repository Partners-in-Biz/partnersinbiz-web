import { NextRequest } from 'next/server'
import { POST } from '@/app/api/v1/reports/route'
import { adminDb } from '@/lib/firebase/admin'
import { generateReport } from '@/lib/reports/generate'

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifyIdToken: jest.fn(), verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn() },
}))

jest.mock('@/lib/reports/generate', () => ({
  generateReport: jest.fn(),
  listReports: jest.fn(),
}))

process.env.AI_API_KEY = 'test-key'

function makePost(body: object) {
  return new NextRequest('http://localhost/api/v1/reports', {
    method: 'POST',
    headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function mockOrgAndProperty(propertyOrgId: string) {
  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    if (name === 'organizations') {
      return {
        doc: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({ timezone: 'Africa/Johannesburg' }),
          }),
        }),
      }
    }
    if (name === 'properties') {
      return {
        doc: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue({
            exists: true,
            id: 'prop-1',
            data: () => ({ id: 'prop-1', orgId: propertyOrgId, deleted: false }),
          }),
        }),
      }
    }
    return { doc: jest.fn() }
  })
}

describe('POST /api/v1/reports', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(generateReport as jest.Mock).mockResolvedValue({ id: 'report-1' })
  })

  it('rejects a propertyId that belongs to another organization', async () => {
    mockOrgAndProperty('org-other')

    const res = await POST(makePost({
      orgId: 'org-1',
      propertyId: 'prop-1',
      type: 'monthly',
      month: '2026-05',
    }))

    expect(res.status).toBe(400)
    expect(generateReport).not.toHaveBeenCalled()
  })
})
