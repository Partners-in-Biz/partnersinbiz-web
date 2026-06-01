// __tests__/lib/sequences/enrollment.test.ts

const mockGet = jest.fn()
const mockDoc = jest.fn()
const mockAdd = jest.fn()
const mockDocUpdate = jest.fn()
const mockCollection = jest.fn()
const mockWhere = jest.fn()
const mockOrderBy = jest.fn()
const mockLimit = jest.fn()

const MOCK_NOW_MS = 1_716_000_000_000 // fixed epoch for deterministic assertions

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

const mockTimestampFromMillis = jest.fn((ms: number) => ({ _ms: ms, toMillis: () => ms }))
const mockTimestampNow = jest.fn(() => ({ _sentinel: 'now' }))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP') },
  Timestamp: {
    fromMillis: (ms: number) => mockTimestampFromMillis(ms),
    now: () => mockTimestampNow(),
  },
}))

import {
  enrollContact,
  unenrollContact,
  getDueEnrollments,
  listEnrollments,
  advanceEnrollment,
  getEnrollment,
} from '@/lib/sequences/enrollment'
import type { MemberRef } from '@/lib/orgMembers/memberRef'

const ACTOR: MemberRef = { uid: 'user-1', displayName: 'Test User', kind: 'human' }

function makeQuery() {
  return {
    where: mockWhere,
    orderBy: mockOrderBy,
    limit: mockLimit,
    get: mockGet,
  }
}

beforeEach(() => {
  mockGet.mockReset()
  mockDoc.mockReset()
  mockAdd.mockReset()
  mockDocUpdate.mockReset()
  mockCollection.mockReset()
  mockWhere.mockReset()
  mockOrderBy.mockReset()
  mockLimit.mockReset()
  mockTimestampFromMillis.mockClear()
  mockTimestampNow.mockClear()
  jest.spyOn(Date, 'now').mockReturnValue(MOCK_NOW_MS)
  const query = makeQuery()
  mockWhere.mockReturnValue(query)
  mockOrderBy.mockReturnValue(query)
  mockLimit.mockReturnValue(query)
  mockDoc.mockReturnValue({ get: mockGet, update: mockDocUpdate })
  mockCollection.mockReturnValue({ doc: mockDoc, where: mockWhere, add: mockAdd })
})

afterEach(() => {
  jest.restoreAllMocks()
})

// ── enrollContact ─────────────────────────────────────────────────────────────

describe('enrollContact', () => {
  it('writes correct doc shape with nextSendAt computed from firstStepDelayDays', async () => {
    const fakeRef = { id: 'enr-1', get: mockGet }
    mockAdd.mockResolvedValue(fakeRef)
    mockGet
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ orgId: 'org-a', deleted: false }),
      })
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({
        data: () => ({
          orgId: 'org-a',
          sequenceId: 'seq-1',
          contactId: 'con-1',
          campaignId: '',
          status: 'active',
          currentStep: 0,
        }),
      })

    await enrollContact('org-a', 'seq-1', 'con-1', ACTOR, 3)

    const expectedMs = MOCK_NOW_MS + 3 * 86_400_000
    expect(mockTimestampFromMillis).toHaveBeenCalledWith(expectedMs)
    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-a',
        sequenceId: 'seq-1',
        contactId: 'con-1',
        campaignId: '',
        status: 'active',
        currentStep: 0,
        enrolledAt: 'SERVER_TIMESTAMP',
        createdByRef: ACTOR,
        updatedByRef: ACTOR,
      }),
    )
  })

  it('returns the enrollment with its new id', async () => {
    const fakeRef = { id: 'enr-99', get: mockGet }
    mockAdd.mockResolvedValue(fakeRef)
    mockGet
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ orgId: 'org-a', deleted: false }),
      })
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({
        data: () => ({ orgId: 'org-a', sequenceId: 'seq-1', contactId: 'con-1', campaignId: '', status: 'active', currentStep: 0 }),
      })
    const result = await enrollContact('org-a', 'seq-1', 'con-1', ACTOR, 0)
    expect(result.id).toBe('enr-99')
  })

  it('returns an existing active enrollment instead of duplicating the contact', async () => {
    mockGet
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ orgId: 'org-a', deleted: false }),
      })
      .mockResolvedValueOnce({
        docs: [
          {
            id: 'enr-existing',
            data: () => ({
              orgId: 'org-a',
              sequenceId: 'seq-1',
              contactId: 'con-1',
              campaignId: '',
              status: 'active',
              currentStep: 0,
            }),
          },
        ],
      })

    const result = await enrollContact('org-a', 'seq-1', 'con-1', ACTOR, 0)

    expect(result.id).toBe('enr-existing')
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('rejects contacts outside the workspace before creating an enrollment', async () => {
    mockGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ orgId: 'org-other', deleted: false }),
    })

    await expect(enrollContact('org-a', 'seq-1', 'con-1', ACTOR, 0)).rejects.toMatchObject({
      message: 'Contact not found',
      status: 404,
    })
    expect(mockAdd).not.toHaveBeenCalled()
  })
})

// ── unenrollContact ───────────────────────────────────────────────────────────

describe('unenrollContact', () => {
  it('sets status=exited and exitReason=manual', async () => {
    const ref = { update: mockDocUpdate }
    mockDoc.mockReturnValue(ref)
    mockDocUpdate.mockResolvedValue(undefined)

    await unenrollContact('org-a', 'enr-1', ACTOR)

    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'exited',
        exitReason: 'manual',
        updatedAt: 'SERVER_TIMESTAMP',
        updatedByRef: ACTOR,
      }),
    )
  })
})

// ── getDueEnrollments ─────────────────────────────────────────────────────────

describe('getDueEnrollments', () => {
  it('queries status==active && nextSendAt<=now', async () => {
    mockGet.mockResolvedValue({
      docs: [
        { id: 'enr-1', data: () => ({ orgId: 'org-a', status: 'active', currentStep: 0 }) },
      ],
    })

    await getDueEnrollments(50)

    expect(mockWhere).toHaveBeenCalledWith('status', '==', 'active')
    expect(mockWhere).toHaveBeenCalledWith('nextSendAt', '<=', mockTimestampNow())
    expect(mockOrderBy).toHaveBeenCalledWith('nextSendAt', 'asc')
    expect(mockLimit).toHaveBeenCalledWith(50)
  })

  it('defaults limit to 100', async () => {
    mockGet.mockResolvedValue({ docs: [] })
    await getDueEnrollments()
    expect(mockLimit).toHaveBeenCalledWith(100)
  })
})

// ── listEnrollments ───────────────────────────────────────────────────────────

describe('listEnrollments', () => {
  it('filters by contactId when provided', async () => {
    mockGet.mockResolvedValue({
      docs: [
        { id: 'enr-1', data: () => ({ orgId: 'org-a', contactId: 'con-1', status: 'active', currentStep: 0 }) },
      ],
    })
    await listEnrollments('org-a', { contactId: 'con-1' })
    expect(mockWhere).toHaveBeenCalledWith('orgId', '==', 'org-a')
    expect(mockWhere).toHaveBeenCalledWith('contactId', '==', 'con-1')
  })

  it('filters by sequenceId when provided', async () => {
    mockGet.mockResolvedValue({ docs: [] })
    await listEnrollments('org-a', { sequenceId: 'seq-5' })
    expect(mockWhere).toHaveBeenCalledWith('sequenceId', '==', 'seq-5')
  })

  it('returns all enrollments for org when no opts provided', async () => {
    mockGet.mockResolvedValue({
      docs: [
        { id: 'enr-1', data: () => ({ orgId: 'org-a', status: 'active', currentStep: 0 }) },
        { id: 'enr-2', data: () => ({ orgId: 'org-a', status: 'completed', currentStep: 2 }) },
      ],
    })
    const results = await listEnrollments('org-a')
    expect(results).toHaveLength(2)
  })
})

// ── advanceEnrollment ─────────────────────────────────────────────────────────

describe('advanceEnrollment', () => {
  it('updates patch fields plus updatedAt serverTimestamp', async () => {
    const ref = { update: mockDocUpdate }
    mockDoc.mockReturnValue(ref)
    mockDocUpdate.mockResolvedValue(undefined)

    const patch = { currentStep: 1, status: 'active' as const }
    await advanceEnrollment('enr-1', patch)

    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        currentStep: 1,
        status: 'active',
        updatedAt: 'SERVER_TIMESTAMP',
      }),
    )
  })

  it('marks enrollment as completed when status=completed is patched', async () => {
    const ref = { update: mockDocUpdate }
    mockDoc.mockReturnValue(ref)
    mockDocUpdate.mockResolvedValue(undefined)

    await advanceEnrollment('enr-1', { status: 'completed' })

    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'completed',
        updatedAt: 'SERVER_TIMESTAMP',
      }),
    )
  })
})

// ── getEnrollment ─────────────────────────────────────────────────────────────

describe('getEnrollment', () => {
  it('returns null when enrollment does not exist', async () => {
    const ref = { get: mockGet }
    mockDoc.mockReturnValue(ref)
    mockGet.mockResolvedValue({ exists: false })
    const result = await getEnrollment('org-a', 'enr-x')
    expect(result).toBeNull()
  })

  it('returns null when orgId does not match', async () => {
    const ref = { get: mockGet }
    mockDoc.mockReturnValue(ref)
    mockGet.mockResolvedValue({
      exists: true,
      id: 'enr-1',
      data: () => ({ orgId: 'org-other', status: 'active', currentStep: 0 }),
    })
    const result = await getEnrollment('org-a', 'enr-1')
    expect(result).toBeNull()
  })
})
