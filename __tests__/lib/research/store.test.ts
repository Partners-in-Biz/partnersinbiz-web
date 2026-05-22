import type { ApiUser } from '@/lib/api/types'

const mockSet = jest.fn()
const mockUpdate = jest.fn()
const mockGet = jest.fn()
const mockDoc = jest.fn()
const mockWhere = jest.fn()
const mockCollection = jest.fn()
const mockBatchSet = jest.fn()
const mockBatchCommit = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: mockCollection,
    batch: jest.fn(() => ({ set: mockBatchSet, commit: mockBatchCommit })),
  },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
  },
}))

const user: ApiUser = { uid: 'admin-1', role: 'admin', orgId: 'platform' }

beforeEach(() => {
  jest.clearAllMocks()
  const docRef = { id: 'research-1', set: mockSet, update: mockUpdate, get: mockGet, collection: mockCollection }
  mockDoc.mockReturnValue(docRef)
  mockCollection.mockReturnValue({ doc: mockDoc, where: mockWhere })
})

describe('research store', () => {
  it('creates a normalized research item with structured findings and recommendations', async () => {
    const { createResearchItem } = await import('@/lib/research/store')

    const created = await createResearchItem({
      orgId: 'org-1',
      title: '  Competitor positioning audit  ',
      kind: 'competitor',
      visibility: 'client_visible',
      summary: 'Summary',
      findings: [{ title: 'Finding', body: 'Body', confidence: 'high' }],
      recommendations: [{ title: 'Recommendation', body: 'Body', priority: 'high' }],
      user,
    })

    expect(created.id).toBe('research-1')
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      title: 'Competitor positioning audit',
      slug: 'competitor-positioning-audit',
      kind: 'competitor',
      status: 'draft',
      visibility: 'client_visible',
      deleted: false,
    }))
    const payload = mockSet.mock.calls[0][0]
    expect(payload.findings[0]).toMatchObject({ id: expect.any(String), confidence: 'high', status: 'open' })
    expect(payload.recommendations[0]).toMatchObject({ id: expect.any(String), priority: 'high', status: 'open' })
  })

  it('soft archives research items instead of deleting evidence', async () => {
    const { archiveResearchItem } = await import('@/lib/research/store')

    await archiveResearchItem('research-1', user)

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'archived',
      deleted: true,
      updatedBy: 'admin-1',
    }))
  })
})
