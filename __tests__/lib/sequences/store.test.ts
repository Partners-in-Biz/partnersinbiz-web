// __tests__/lib/sequences/store.test.ts

const mockGet = jest.fn()
const mockDoc = jest.fn()
const mockAdd = jest.fn()
const mockDocUpdate = jest.fn()
const mockCollection = jest.fn()
const mockWhere = jest.fn()
const mockOrderBy = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP') },
}))

// eslint-disable-next-line import/first
import {
  listSequences,
  getSequence,
  createSequence,
  updateSequence,
  deleteSequence,
} from '@/lib/sequences/store'
import type { MemberRef } from '@/lib/orgMembers/memberRef'

const ACTOR: MemberRef = { uid: 'user-1', displayName: 'Test User', kind: 'human' }

function makeQuery() {
  return {
    where: mockWhere,
    orderBy: mockOrderBy,
    get: mockGet,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  const query = makeQuery()
  mockWhere.mockReturnValue(query)
  mockOrderBy.mockReturnValue(query)
  mockCollection.mockReturnValue({ doc: mockDoc, where: mockWhere, add: mockAdd })
})

// ── listSequences ─────────────────────────────────────────────────────────────

describe('listSequences', () => {
  it('returns active sequences for the org', async () => {
    mockGet.mockResolvedValue({
      docs: [
        { id: 'seq-1', data: () => ({ orgId: 'org-a', name: 'Onboarding', status: 'active', steps: [], description: '' }) },
        { id: 'seq-2', data: () => ({ orgId: 'org-a', name: 'Winback', status: 'active', steps: [], description: '' }) },
      ],
    })
    const results = await listSequences('org-a')
    expect(results).toHaveLength(2)
    expect(results[0].id).toBe('seq-1')
    expect(results[1].id).toBe('seq-2')
  })

  it('filters deleted sequences and sorts by name without composite-sensitive query clauses', async () => {
    mockGet.mockResolvedValue({
      docs: [
        { id: 'seq-2', data: () => ({ orgId: 'org-a', name: 'Winback', deleted: true, status: 'active', steps: [], description: '' }) },
        { id: 'seq-3', data: () => ({ orgId: 'org-a', name: 'Beta', status: 'active', steps: [], description: '' }) },
        { id: 'seq-1', data: () => ({ orgId: 'org-a', name: 'Alpha', deleted: false, status: 'active', steps: [], description: '' }) },
      ],
    })
    const results = await listSequences('org-a')
    expect(mockWhere).toHaveBeenCalledWith('orgId', '==', 'org-a')
    expect(mockWhere).not.toHaveBeenCalledWith('deleted', '!=', true)
    expect(mockOrderBy).not.toHaveBeenCalled()
    expect(results.map((seq) => seq.id)).toEqual(['seq-1', 'seq-3'])
  })

  it('returns empty array when no sequences found', async () => {
    mockGet.mockResolvedValue({ docs: [] })
    const results = await listSequences('org-empty')
    expect(results).toEqual([])
  })
})

// ── getSequence ───────────────────────────────────────────────────────────────

describe('getSequence', () => {
  it('returns sequence when found with matching orgId', async () => {
    const ref = { get: mockGet, id: 'seq-1', update: mockDocUpdate }
    mockDoc.mockReturnValue(ref)
    mockGet.mockResolvedValue({
      exists: true,
      id: 'seq-1',
      data: () => ({ orgId: 'org-a', name: 'Onboarding', status: 'active', steps: [], description: '' }),
    })
    const result = await getSequence('org-a', 'seq-1')
    expect(result).not.toBeNull()
    expect(result!.id).toBe('seq-1')
    expect(result!.name).toBe('Onboarding')
  })

  it('returns null when sequence does not exist', async () => {
    const ref = { get: mockGet, id: 'seq-x', update: mockDocUpdate }
    mockDoc.mockReturnValue(ref)
    mockGet.mockResolvedValue({ exists: false })
    const result = await getSequence('org-a', 'seq-x')
    expect(result).toBeNull()
  })

  it('returns null when orgId does not match (cross-tenant guard)', async () => {
    const ref = { get: mockGet, id: 'seq-1', update: mockDocUpdate }
    mockDoc.mockReturnValue(ref)
    mockGet.mockResolvedValue({
      exists: true,
      id: 'seq-1',
      data: () => ({ orgId: 'org-other', name: 'Onboarding', status: 'active', steps: [], description: '' }),
    })
    const result = await getSequence('org-a', 'seq-1')
    expect(result).toBeNull()
  })
})

// ── createSequence ────────────────────────────────────────────────────────────

describe('createSequence', () => {
  it('adds a sequence with correct shape including createdByRef', async () => {
    const fakeRef = { id: 'new-seq', get: mockGet }
    mockAdd.mockResolvedValue(fakeRef)
    mockGet.mockResolvedValue({
      data: () => ({ orgId: 'org-a', name: 'Onboarding', status: 'draft', steps: [], description: '' }),
    })
    const input = { orgId: 'org-a', name: 'Onboarding', status: 'draft' as const, steps: [], description: '', deleted: false }
    await createSequence('org-a', input, ACTOR)
    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-a',
        name: 'Onboarding',
        createdAt: 'SERVER_TIMESTAMP',
        updatedAt: 'SERVER_TIMESTAMP',
        createdByRef: ACTOR,
        updatedByRef: ACTOR,
      }),
    )
  })

  it('returns the created sequence with its new id', async () => {
    const fakeRef = { id: 'seq-42', get: mockGet }
    mockAdd.mockResolvedValue(fakeRef)
    mockGet.mockResolvedValue({
      data: () => ({ orgId: 'org-a', name: 'Winback', status: 'draft', steps: [], description: '' }),
    })
    const input = { orgId: 'org-a', name: 'Winback', status: 'draft' as const, steps: [], description: '', deleted: false }
    const result = await createSequence('org-a', input, ACTOR)
    expect(result.id).toBe('seq-42')
  })
})

// ── updateSequence ────────────────────────────────────────────────────────────

describe('updateSequence', () => {
  it('calls doc.update() with patch and updatedByRef', async () => {
    const ref = { get: mockGet, id: 'seq-1', update: mockDocUpdate }
    mockDoc.mockReturnValue(ref)
    mockDocUpdate.mockResolvedValue(undefined)
    mockGet
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ orgId: 'org-a', name: 'Old Name', status: 'draft', steps: [], description: '' }),
      })
      .mockResolvedValueOnce({
        data: () => ({ orgId: 'org-a', name: 'New Name', status: 'draft', steps: [], description: '' }),
      })
    await updateSequence('org-a', 'seq-1', { name: 'New Name' }, ACTOR)
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'New Name',
        updatedAt: 'SERVER_TIMESTAMP',
        updatedByRef: ACTOR,
      }),
    )
  })

  it('throws when sequence is not found', async () => {
    const ref = { get: mockGet, id: 'seq-x', update: mockDocUpdate }
    mockDoc.mockReturnValue(ref)
    mockGet.mockResolvedValue({ exists: false })
    await expect(updateSequence('org-a', 'seq-x', { name: 'x' }, ACTOR)).rejects.toThrow(
      'Sequence not found: seq-x',
    )
  })

  it('throws when orgId does not match', async () => {
    const ref = { get: mockGet, id: 'seq-1', update: mockDocUpdate }
    mockDoc.mockReturnValue(ref)
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ orgId: 'org-other', name: 'X', status: 'draft', steps: [], description: '' }),
    })
    await expect(updateSequence('org-a', 'seq-1', { name: 'x' }, ACTOR)).rejects.toThrow(
      'Sequence not found: seq-1',
    )
  })
})

// ── deleteSequence ────────────────────────────────────────────────────────────

describe('deleteSequence', () => {
  it('soft-deletes the sequence by setting deleted: true', async () => {
    const ref = { get: mockGet, id: 'seq-1', update: mockDocUpdate }
    mockDoc.mockReturnValue(ref)
    mockDocUpdate.mockResolvedValue(undefined)
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ orgId: 'org-a', name: 'Onboarding', status: 'active', steps: [], description: '' }),
    })
    await deleteSequence('org-a', 'seq-1', ACTOR)
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        deleted: true,
        updatedAt: 'SERVER_TIMESTAMP',
        updatedByRef: ACTOR,
      }),
    )
  })

  it('throws when sequence is not found', async () => {
    const ref = { get: mockGet, id: 'seq-x', update: mockDocUpdate }
    mockDoc.mockReturnValue(ref)
    mockGet.mockResolvedValue({ exists: false })
    await expect(deleteSequence('org-a', 'seq-x', ACTOR)).rejects.toThrow(
      'Sequence not found: seq-x',
    )
  })

  it('throws on cross-tenant soft-delete attempt', async () => {
    const ref = { get: mockGet, id: 'seq-1', update: mockDocUpdate }
    mockDoc.mockReturnValue(ref)
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ orgId: 'org-other', name: 'Onboarding', status: 'active', steps: [], description: '' }),
    })
    await expect(deleteSequence('org-a', 'seq-1', ACTOR)).rejects.toThrow(
      'Sequence not found: seq-1',
    )
  })
})
