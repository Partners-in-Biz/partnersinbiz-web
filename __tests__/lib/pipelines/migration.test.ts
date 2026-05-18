// __tests__/lib/pipelines/migration.test.ts

const mockGet = jest.fn()
const mockCollection = jest.fn()
const mockWhere = jest.fn()
const mockOrderBy = jest.fn()
const mockLimit = jest.fn()
const mockBatch = jest.fn()
const mockBatchUpdate = jest.fn()
const mockBatchCommit = jest.fn()
const mockAdd = jest.fn()
const mockDoc = jest.fn()
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
import { legacyStageToStageId, migrateOrgToDefaultPipeline } from '@/lib/pipelines/migration'
import type { MemberRef } from '@/lib/orgMembers/memberRef'

const ACTOR: MemberRef = { uid: 'agent:pip', displayName: 'Pip', kind: 'agent' }

function makeQuery() {
  const q: Record<string, jest.Mock> = {}
  q.where = mockWhere
  q.orderBy = mockOrderBy
  q.limit = mockLimit
  q.get = mockGet
  return q
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
  mockAdd.mockResolvedValue({ id: 'created-pipeline-id' })
  mockDoc.mockReturnValue({ get: mockGet, id: 'pl-id', update: mockDocUpdate })
  mockDocUpdate.mockResolvedValue(undefined)
})

// ──────────────────────────────────────────────────────────────────────────────
describe('legacyStageToStageId', () => {
  it('maps all known legacy stage names correctly', () => {
    expect(legacyStageToStageId['discovery']).toBe('discovery')
    expect(legacyStageToStageId['proposal']).toBe('proposal')
    expect(legacyStageToStageId['negotiation']).toBe('negotiation')
    expect(legacyStageToStageId['won']).toBe('won')
    expect(legacyStageToStageId['lost']).toBe('lost')
  })

  it('has exactly 5 entries', () => {
    expect(Object.keys(legacyStageToStageId)).toHaveLength(5)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
describe('migrateOrgToDefaultPipeline', () => {
  it('creates pipeline and migrates deals on a fresh org', async () => {
    // Call 1: migration existing-pipeline check → empty
    // Call 2: bootstrapDefaultPipeline's internal existing check → empty (so it creates)
    // Call 3: deals query → 2 deals with legacy stage
    mockGet
      .mockResolvedValueOnce({ empty: true, docs: [] })
      .mockResolvedValueOnce({ empty: true, docs: [] })
      .mockResolvedValueOnce({
        empty: false,
        docs: [
          { id: 'deal-1', ref: { id: 'deal-1' }, data: () => ({ orgId: 'org-a', stage: 'discovery' }) },
          { id: 'deal-2', ref: { id: 'deal-2' }, data: () => ({ orgId: 'org-a', stage: 'won' }) },
        ],
      })

    const result = await migrateOrgToDefaultPipeline('org-a', ACTOR, { dryRun: false })

    expect(result.pipelineCreated).toBe(true)
    expect(result.pipelineId).toBe('created-pipeline-id')
    expect(result.dealsUpdated).toBe(2)
    expect(result.errors).toHaveLength(0)
    expect(mockBatchCommit).toHaveBeenCalledTimes(1)
  })

  it('skips pipeline creation when pipeline already exists (idempotent)', async () => {
    mockGet
      .mockResolvedValueOnce({
        empty: false,
        docs: [{ id: 'pl-existing', data: () => ({ orgId: 'org-a', isDefault: true }) }],
      })
      .mockResolvedValueOnce({ empty: true, docs: [] }) // no deals to migrate

    const result = await migrateOrgToDefaultPipeline('org-a', ACTOR, { dryRun: false })

    expect(result.pipelineCreated).toBe(false)
    expect(result.pipelineId).toBe('pl-existing')
    expect(result.dealsUpdated).toBe(0)
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('dry-run: counts deals but makes no writes', async () => {
    mockGet
      .mockResolvedValueOnce({ empty: true, docs: [] })  // no existing pipeline
      .mockResolvedValueOnce({
        empty: false,
        docs: [
          { id: 'deal-1', ref: { id: 'deal-1' }, data: () => ({ orgId: 'org-b', stage: 'proposal' }) },
          { id: 'deal-2', ref: { id: 'deal-2' }, data: () => ({ orgId: 'org-b', stage: 'lost' }) },
          { id: 'deal-3', ref: { id: 'deal-3' }, data: () => ({ orgId: 'org-b', stage: 'negotiation' }) },
        ],
      })

    const result = await migrateOrgToDefaultPipeline('org-b', ACTOR, { dryRun: true })

    expect(result.pipelineCreated).toBe(true)
    expect(result.pipelineId).toBe('<DRYRUN_NEW_PIPELINE>')
    expect(result.dealsUpdated).toBe(3)
    expect(mockAdd).not.toHaveBeenCalled()
    expect(mockBatchCommit).not.toHaveBeenCalled()
  })

  it('handles batch boundary at 30 — creates two batches for 31 deals', async () => {
    const deals = Array.from({ length: 31 }, (_, i) => ({
      id: `deal-${i}`,
      ref: { id: `deal-${i}` },
      data: () => ({ orgId: 'org-c', stage: 'proposal' }),
    }))

    // Call 1: migration existing check → empty
    // Call 2: bootstrapDefaultPipeline existing check → empty (so it creates)
    // Call 3: deals query → 31 deals
    mockGet
      .mockResolvedValueOnce({ empty: true, docs: [] })
      .mockResolvedValueOnce({ empty: true, docs: [] })
      .mockResolvedValueOnce({ empty: false, docs: deals })

    const result = await migrateOrgToDefaultPipeline('org-c', ACTOR, { dryRun: false })

    expect(result.dealsUpdated).toBe(31)
    expect(mockBatchCommit).toHaveBeenCalledTimes(2)
  })

  it('skips deals that already have pipelineId set', async () => {
    mockGet
      .mockResolvedValueOnce({
        empty: false,
        docs: [{ id: 'pl-1', data: () => ({ orgId: 'org-d', isDefault: true }) }],
      })
      .mockResolvedValueOnce({
        empty: false,
        docs: [
          { id: 'deal-already', ref: { id: 'deal-already' }, data: () => ({ orgId: 'org-d', stage: 'won', pipelineId: 'pl-1' }) },
          { id: 'deal-migrate', ref: { id: 'deal-migrate' }, data: () => ({ orgId: 'org-d', stage: 'proposal' }) },
        ],
      })

    const result = await migrateOrgToDefaultPipeline('org-d', ACTOR, { dryRun: false })

    expect(result.dealsUpdated).toBe(1)
  })

  it('collects errors without throwing', async () => {
    mockGet.mockRejectedValueOnce(new Error('Firestore unavailable'))

    const result = await migrateOrgToDefaultPipeline('org-e', ACTOR, { dryRun: false })

    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('Firestore unavailable')
    expect(result.dealsUpdated).toBe(0)
  })
})
