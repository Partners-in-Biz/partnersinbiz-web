jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: jest.fn(),
    batch: jest.fn(),
  },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => '__SERVER_TIMESTAMP__'),
  },
}))

jest.mock('@/lib/auth/crm-middleware', () => ({
  withCrmAuth: (minRole: string, handler: Function) =>
    (req: Request, routeCtx?: unknown) => {
      const role = (req as Request & { _testRole?: string })._testRole ?? minRole
      if (minRole === 'admin' && role === 'member') {
        const { NextResponse } = require('next/server')
        return NextResponse.json({ success: false, error: 'Insufficient permissions' }, { status: 403 })
      }
      return handler(req, {
        orgId: 'org-a',
        role,
        isAgent: false,
        actor: { uid: 'admin-1', displayName: 'Admin One', kind: 'human' },
        permissions: {},
      }, routeCtx)
    },
}))

jest.mock('@/lib/companies/store', () => ({
  loadCompany: jest.fn(),
}))

jest.mock('@/lib/crm/live-updates', () => ({
  safeTouchCrmLiveUpdate: jest.fn().mockResolvedValue(undefined),
}))

import { NextRequest } from 'next/server'
import { POST } from '@/app/api/v1/crm/companies/merge/route'
import { adminDb } from '@/lib/firebase/admin'
import { loadCompany } from '@/lib/companies/store'

const mockCollection = adminDb.collection as jest.Mock
const mockBatch = adminDb.batch as jest.Mock
const mockLoadCompany = loadCompany as jest.Mock

function makeReq(body: Record<string, unknown>, role = 'admin'): NextRequest {
  const req = new NextRequest('http://localhost/api/v1/crm/companies/merge', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', authorization: 'Bearer test' },
  })
  ;(req as NextRequest & { _testRole?: string })._testRole = role
  return req
}

function makeDoc(id: string, data: Record<string, unknown>) {
  return {
    id,
    ref: { id, update: jest.fn().mockResolvedValue(undefined) },
    data: () => data,
  }
}

describe('POST /api/v1/crm/companies/merge', () => {
  let winnerUpdate: jest.Mock
  let loserUpdate: jest.Mock
  const batchUpdates: Array<{ ref: { id: string }; data: Record<string, unknown> }> = []
  const whereCallsByCollection: Record<string, Array<[string, string, string]>> = {}

  beforeEach(() => {
    jest.clearAllMocks()
    batchUpdates.length = 0
    for (const key of Object.keys(whereCallsByCollection)) delete whereCallsByCollection[key]

    winnerUpdate = jest.fn().mockResolvedValue(undefined)
    loserUpdate = jest.fn().mockResolvedValue(undefined)
    mockLoadCompany.mockImplementation((id: string, orgId: string) => {
      if (orgId !== 'org-a') return Promise.resolve(null)
      if (id === 'winner-co') {
        return Promise.resolve({
          ref: { update: winnerUpdate },
          data: { id, orgId, name: 'Winner Co', domain: 'winner.example', tags: ['customer'], notes: 'Keep me', createdAt: null, updatedAt: null },
        })
      }
      if (id === 'loser-co') {
        return Promise.resolve({
          ref: { update: loserUpdate },
          data: { id, orgId, name: 'Loser Co', website: 'https://loser.example', industry: 'Staffing', tags: ['duplicate'], notes: '', createdAt: null, updatedAt: null },
        })
      }
      return Promise.resolve(null)
    })

    mockBatch.mockImplementation(() => ({
      update: jest.fn((ref, data) => batchUpdates.push({ ref, data })),
      commit: jest.fn().mockResolvedValue(undefined),
    }))

    mockCollection.mockImplementation((collectionName: string) => {
      whereCallsByCollection[collectionName] = []
      const query = {
        where: jest.fn((field: string, op: string, value: string) => {
          whereCallsByCollection[collectionName].push([field, op, value])
          return query
        }),
        limit: jest.fn(() => query),
        get: jest.fn(() => {
          const calls = whereCallsByCollection[collectionName]
          const fieldFilter = calls.find(([field, , value]) => field !== 'orgId' && value === 'loser-co')?.[0]
          if (!fieldFilter) {
            if (collectionName === 'contacts') {
              return Promise.resolve({
                docs: [makeDoc('contact-link', {
                  orgId: 'org-a',
                  companyLinks: [
                    { companyId: 'loser-co', companyName: 'Loser Co', primary: true },
                    { companyId: 'other-co', companyName: 'Other Co' },
                  ],
                })],
              })
            }
            return Promise.resolve({ docs: [] })
          }
          const id = `${collectionName}-${fieldFilter}`
          return Promise.resolve({ docs: [makeDoc(id, { orgId: 'org-a', [fieldFilter]: 'loser-co' })] })
        }),
      }
      return query
    })
  })

  it('merges same-org companies, soft-deletes loser, and re-links related records to the winner', async () => {
    const res = await POST(makeReq({ winnerId: 'winner-co', loserId: 'loser-co' }))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.company.name).toBe('Winner Co')
    expect(body.data.company.industry).toBe('Staffing')
    expect(body.data.company.tags).toEqual(['customer', 'duplicate'])
    expect(loserUpdate).toHaveBeenCalledWith(expect.objectContaining({ deleted: true, mergedIntoId: 'winner-co' }))

    expect(batchUpdates).toEqual(expect.arrayContaining([
      expect.objectContaining({ data: expect.objectContaining({ companyId: 'winner-co', companyName: 'Winner Co' }) }),
      expect.objectContaining({ data: expect.objectContaining({ sourceCompanyId: 'winner-co' }) }),
      expect.objectContaining({ data: expect.objectContaining({ companyLinks: expect.arrayContaining([expect.objectContaining({ companyId: 'winner-co', companyName: 'Winner Co' })]) }) }),
    ]))
    expect(whereCallsByCollection.contacts).toContainEqual(['orgId', '==', 'org-a'])
    expect(whereCallsByCollection.deals).toContainEqual(['orgId', '==', 'org-a'])
    expect(whereCallsByCollection.quotes).toContainEqual(['orgId', '==', 'org-a'])
    expect(whereCallsByCollection.activities).toContainEqual(['orgId', '==', 'org-a'])
  })

  it('rejects merging a company into itself', async () => {
    const res = await POST(makeReq({ winnerId: 'winner-co', loserId: 'winner-co' }))
    expect(res.status).toBe(400)
  })

  it('rejects missing or cross-org companies as not found', async () => {
    mockLoadCompany.mockImplementation((id: string) => Promise.resolve(id === 'winner-co'
      ? { ref: { update: winnerUpdate }, data: { id, orgId: 'org-a', name: 'Winner Co', tags: [], notes: '', createdAt: null, updatedAt: null } }
      : null))

    const res = await POST(makeReq({ winnerId: 'winner-co', loserId: 'other-org-co' }))
    expect(res.status).toBe(404)
    expect(loserUpdate).not.toHaveBeenCalled()
  })

  it('requires admin access', async () => {
    const res = await POST(makeReq({ winnerId: 'winner-co', loserId: 'loser-co' }, 'member'))
    expect(res.status).toBe(403)
  })
})
