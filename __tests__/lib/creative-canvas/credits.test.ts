const mockDocGet = jest.fn()
const mockDocSet = jest.fn()
const mockSubAdd = jest.fn()
const mockSubCollection = jest.fn()
const mockDoc = jest.fn()
const mockCollection = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
    increment: jest.fn((n: number) => ({ __increment: n })),
  },
}))

import {
  CREATIVE_CANVAS_CREDITS_COLLECTION,
  getCanvasCredits,
  hasSufficientCredits,
  recordCanvasCreditUsage,
} from '@/lib/creative-canvas/credits'

beforeEach(() => {
  jest.clearAllMocks()
  mockSubCollection.mockReturnValue({ add: mockSubAdd })
  mockDoc.mockReturnValue({ get: mockDocGet, set: mockDocSet, collection: mockSubCollection })
  mockCollection.mockReturnValue({ doc: mockDoc })
  mockDocSet.mockResolvedValue(undefined)
  mockSubAdd.mockResolvedValue({ id: 'usage-1' })
})

describe('creative canvas credits', () => {
  it('returns zero used and null limit for a missing doc', async () => {
    mockDocGet.mockResolvedValue({ exists: false })
    const state = await getCanvasCredits('org-1')
    expect(mockCollection).toHaveBeenCalledWith(CREATIVE_CANVAS_CREDITS_COLLECTION)
    expect(mockDoc).toHaveBeenCalledWith('org-1')
    expect(state).toEqual({ orgId: 'org-1', used: 0, limit: null, updatedAt: null })
  })

  it('checks sufficiency against the configured limit', () => {
    expect(hasSufficientCredits({ orgId: 'o', used: 100, limit: null, updatedAt: null }, 50)).toBe(true)
    expect(hasSufficientCredits({ orgId: 'o', used: 8, limit: 10, updatedAt: null }, 2)).toBe(true)
    expect(hasSufficientCredits({ orgId: 'o', used: 9, limit: 10, updatedAt: null }, 2)).toBe(false)
  })

  it('increments used and writes a usage record', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ orgId: 'org-1', used: 7, limit: 100, updatedAt: 'SERVER_TIMESTAMP' }),
    })

    const state = await recordCanvasCreditUsage('org-1', 3, { runId: 'run-9', model: 'higgsfield' })

    expect(mockDocSet).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        used: { __increment: 3 },
        updatedAt: 'SERVER_TIMESTAMP',
      }),
      { merge: true },
    )
    expect(mockSubCollection).toHaveBeenCalledWith('usage')
    expect(mockSubAdd).toHaveBeenCalledWith(expect.objectContaining({
      cost: 3,
      runId: 'run-9',
      model: 'higgsfield',
      createdAt: 'SERVER_TIMESTAMP',
    }))
    expect(state).toEqual({ orgId: 'org-1', used: 7, limit: 100, updatedAt: 'SERVER_TIMESTAMP' })
  })

  it('guards malformed meta without throwing', async () => {
    mockDocGet.mockResolvedValue({ exists: false })
    await expect(recordCanvasCreditUsage('org-1', 5)).resolves.toEqual(
      expect.objectContaining({ orgId: 'org-1' }),
    )
    expect(mockSubAdd).toHaveBeenCalledWith(expect.objectContaining({ cost: 5, runId: null, model: null }))
  })
})
