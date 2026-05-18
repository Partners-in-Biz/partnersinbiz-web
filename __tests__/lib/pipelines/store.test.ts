// __tests__/lib/pipelines/store.test.ts

const mockGet = jest.fn()
const mockDoc = jest.fn()
const mockCollection = jest.fn()
const mockBatch = jest.fn()
const mockWhere = jest.fn()
const mockOrderBy = jest.fn()
const mockLimit = jest.fn()
const mockAdd = jest.fn()
const mockBatchUpdate = jest.fn()
const mockBatchCommit = jest.fn()
const mockDocUpdate = jest.fn()

const mockTimestampNow = jest.fn().mockReturnValue({ seconds: 1000, nanoseconds: 0 })

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: mockCollection,
    batch: mockBatch,
  },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { delete: jest.fn(() => 'DELETE_SENTINEL') },
  Timestamp: { now: () => mockTimestampNow() },
}))

// eslint-disable-next-line import/first
import {
  loadPipeline,
  getDefaultPipelineForOrg,
  bootstrapDefaultPipeline,
  clearOtherDefaults,
  sanitizePipelineForWrite,
  assertStagesValid,
} from '@/lib/pipelines/store'
import { PipelineValidationError } from '@/lib/pipelines/types'
import type { PipelineStage } from '@/lib/pipelines/types'
import type { MemberRef } from '@/lib/orgMembers/memberRef'

const ACTOR: MemberRef = { uid: 'user-1', displayName: 'Test User', kind: 'human' }

function makeQuery() {
  const q: Record<string, jest.Mock> = {}
  q.where = mockWhere
  q.orderBy = mockOrderBy
  q.limit = mockLimit
  q.get = mockGet
  return q
}

function validStages(): PipelineStage[] {
  return [
    { id: 'discovery',   label: 'Discovery',   kind: 'open', order: 0, probability: 10 },
    { id: 'proposal',    label: 'Proposal',     kind: 'open', order: 1, probability: 30 },
    { id: 'negotiation', label: 'Negotiation',  kind: 'open', order: 2, probability: 70 },
    { id: 'won',         label: 'Won',          kind: 'won',  order: 3, probability: 100 },
    { id: 'lost',        label: 'Lost',         kind: 'lost', order: 4, probability: 0 },
  ]
}

beforeEach(() => {
  jest.clearAllMocks()
  const query = makeQuery()
  mockWhere.mockReturnValue(query)
  mockOrderBy.mockReturnValue(query)
  mockLimit.mockReturnValue(query)
  mockCollection.mockReturnValue({ doc: mockDoc, where: mockWhere, add: mockAdd })
  mockBatch.mockReturnValue({ update: mockBatchUpdate, commit: mockBatchCommit })
  mockBatchCommit.mockResolvedValue(undefined)
  mockAdd.mockResolvedValue({ id: 'new-pipeline-id' })
})

// ──────────────────────────────────────────────────────────────────────────────
describe('loadPipeline', () => {
  it('returns ref + data on hit', async () => {
    const ref = { get: mockGet, id: 'pl-1', update: mockDocUpdate }
    mockDoc.mockReturnValue(ref)
    mockGet.mockResolvedValue({ exists: true, data: () => ({ orgId: 'org-a', name: 'Sales', isDefault: true, archived: false }) })
    const result = await loadPipeline('pl-1', 'org-a')
    expect(result).not.toBeNull()
    expect(result!.data.id).toBe('pl-1')
    expect(result!.data.orgId).toBe('org-a')
  })

  it('returns null on cross-tenant access', async () => {
    const ref = { get: mockGet, id: 'pl-1' }
    mockDoc.mockReturnValue(ref)
    mockGet.mockResolvedValue({ exists: true, data: () => ({ orgId: 'org-other', name: 'X' }) })
    const result = await loadPipeline('pl-1', 'org-a')
    expect(result).toBeNull()
  })

  it('returns null on soft-deleted', async () => {
    const ref = { get: mockGet, id: 'pl-1' }
    mockDoc.mockReturnValue(ref)
    mockGet.mockResolvedValue({ exists: true, data: () => ({ orgId: 'org-a', name: 'X', deleted: true }) })
    const result = await loadPipeline('pl-1', 'org-a')
    expect(result).toBeNull()
  })

  it('returns null on missing doc', async () => {
    const ref = { get: mockGet, id: 'pl-1' }
    mockDoc.mockReturnValue(ref)
    mockGet.mockResolvedValue({ exists: false })
    const result = await loadPipeline('pl-1', 'org-a')
    expect(result).toBeNull()
  })
})

// ──────────────────────────────────────────────────────────────────────────────
describe('getDefaultPipelineForOrg', () => {
  it('returns the default pipeline when found', async () => {
    mockGet.mockResolvedValue({
      empty: false,
      docs: [{ id: 'pl-default', data: () => ({ orgId: 'org-a', isDefault: true, name: 'Default' }) }],
    })
    const result = await getDefaultPipelineForOrg('org-a')
    expect(result).not.toBeNull()
    expect(result!.id).toBe('pl-default')
    expect(result!.isDefault).toBe(true)
  })

  it('returns null when no default pipeline', async () => {
    mockGet.mockResolvedValue({ empty: true, docs: [] })
    const result = await getDefaultPipelineForOrg('org-a')
    expect(result).toBeNull()
  })
})

// ──────────────────────────────────────────────────────────────────────────────
describe('bootstrapDefaultPipeline', () => {
  it('creates a new pipeline when none exist', async () => {
    mockGet.mockResolvedValue({ empty: true, docs: [] })
    const result = await bootstrapDefaultPipeline('org-new', ACTOR)
    expect(result.id).toBe('new-pipeline-id')
    expect(result.isDefault).toBe(true)
    expect(result.orgId).toBe('org-new')
    expect(mockAdd).toHaveBeenCalledTimes(1)
  })

  it('returns existing default pipeline idempotently (does not create)', async () => {
    mockGet.mockResolvedValue({
      empty: false,
      docs: [
        { id: 'pl-existing', data: () => ({ orgId: 'org-a', isDefault: true, name: 'Existing' }), ref: { update: mockDocUpdate } },
      ],
    })
    const result = await bootstrapDefaultPipeline('org-a', ACTOR)
    expect(result.id).toBe('pl-existing')
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('marks first pipeline as default when none is default', async () => {
    const fakeRef = { update: mockDocUpdate }
    mockDocUpdate.mockResolvedValue(undefined)
    mockGet.mockResolvedValue({
      empty: false,
      docs: [
        { id: 'pl-first', data: () => ({ orgId: 'org-a', isDefault: false, name: 'First' }), ref: fakeRef },
      ],
    })
    const result = await bootstrapDefaultPipeline('org-a', ACTOR)
    expect(result.id).toBe('pl-first')
    expect(result.isDefault).toBe(true)
    expect(mockDocUpdate).toHaveBeenCalledWith({ isDefault: true, updatedAt: expect.anything() })
    expect(mockAdd).not.toHaveBeenCalled()
  })
})

// ──────────────────────────────────────────────────────────────────────────────
describe('clearOtherDefaults', () => {
  it('batch-updates all pipelines except the given id', async () => {
    const ref1 = { id: 'pl-1', update: mockBatchUpdate }
    const ref2 = { id: 'pl-keep', update: mockBatchUpdate }
    mockGet.mockResolvedValue({
      empty: false,
      docs: [
        { id: 'pl-1', ref: ref1 },
        { id: 'pl-keep', ref: ref2 },
      ],
    })
    await clearOtherDefaults('org-a', 'pl-keep')
    expect(mockBatchUpdate).toHaveBeenCalledTimes(1)
    expect(mockBatchCommit).toHaveBeenCalledTimes(1)
  })

  it('does nothing when no other defaults exist', async () => {
    mockGet.mockResolvedValue({
      empty: false,
      docs: [{ id: 'pl-keep', ref: { id: 'pl-keep' } }],
    })
    await clearOtherDefaults('org-a', 'pl-keep')
    expect(mockBatchCommit).not.toHaveBeenCalled()
  })
})

// ──────────────────────────────────────────────────────────────────────────────
describe('sanitizePipelineForWrite', () => {
  it('strips NEVER_FROM_BODY fields and undefined values', () => {
    const result = sanitizePipelineForWrite({
      name: 'My Pipeline',
      orgId: 'org-a',        // stripped
      createdBy: 'uid-1',    // stripped
      createdAt: undefined,  // stripped (undefined)
      isDefault: true,
      archived: false,
      stages: [],
    } as never)
    expect(result).toHaveProperty('name', 'My Pipeline')
    expect(result).toHaveProperty('isDefault', true)
    expect(result).not.toHaveProperty('orgId')
    expect(result).not.toHaveProperty('createdBy')
    expect(result).not.toHaveProperty('createdAt')
  })
})

// ──────────────────────────────────────────────────────────────────────────────
describe('assertStagesValid', () => {
  it('passes on a valid 5-stage pipeline', () => {
    expect(() => assertStagesValid(validStages())).not.toThrow()
  })

  it('throws when fewer than 3 stages', () => {
    expect(() => assertStagesValid([
      { id: 'won', label: 'Won', kind: 'won', order: 0, probability: 100 },
      { id: 'lost', label: 'Lost', kind: 'lost', order: 1, probability: 0 },
    ])).toThrow(PipelineValidationError)
  })

  it('throws when no "won" stage', () => {
    const stages = validStages().map(s => s.kind === 'won' ? { ...s, kind: 'open' as const } : s)
    expect(() => assertStagesValid(stages)).toThrow(PipelineValidationError)
  })

  it('throws when no "lost" stage', () => {
    const stages = validStages().map(s => s.kind === 'lost' ? { ...s, kind: 'open' as const } : s)
    expect(() => assertStagesValid(stages)).toThrow(PipelineValidationError)
  })

  it('throws on duplicate stage IDs', () => {
    const stages = validStages()
    stages[1] = { ...stages[1], id: 'discovery' } // dup
    expect(() => assertStagesValid(stages)).toThrow(PipelineValidationError)
  })

  it('throws on stage id failing regex', () => {
    const stages = validStages()
    stages[0] = { ...stages[0], id: 'INVALID ID!' }
    expect(() => assertStagesValid(stages)).toThrow(PipelineValidationError)
  })
})
