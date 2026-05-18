/**
 * Integration-style tests for scripts/crm-migrate-multi-pipeline.ts
 *
 * Firestore is fully mocked.  The tests exercise:
 * - Dry-run: no batch.commit() calls, CSV path contains "dryrun"
 * - Commit: batch.commit() called once per 30-deal chunk
 * - Idempotent: orgs with an existing pipeline produce 0 dealsUpdated on second pass
 * - CSV writer: called with correct columns
 * - parseFlags: --dry-run / --commit / --org-id parsing
 */

// ── Firestore + firebase-admin mocks (must come before imports) ───────────────

const mockBatchCommit = jest.fn()
const mockBatchUpdate = jest.fn()
const mockBatchFn = jest.fn(() => ({ update: mockBatchUpdate, commit: mockBatchCommit }))
const mockWhere = jest.fn()
const mockOrderBy = jest.fn()
const mockLimit = jest.fn()
const mockGet = jest.fn()
const mockAdd = jest.fn()
const mockDoc = jest.fn()
const mockDocUpdate = jest.fn()
const mockCollection = jest.fn()

// Org-level collection mock (top-level, not inside pipelines/deals)
const mockOrgCollection = jest.fn()
const mockOrgGet = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: mockCollection,
    batch: mockBatchFn,
  },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { delete: jest.fn(() => 'DELETE_SENTINEL') },
  Timestamp: { now: jest.fn(() => ({ seconds: 9000, nanoseconds: 0 })) },
}))

// Mock fs so writeCsvReport doesn't touch disk
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(() => true),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
  readFileSync: jest.fn(() => ''),
}))

// Stub firebase-admin module (used in initFirebase inside run())
jest.mock('firebase-admin', () => ({
  apps: ['fake'],  // pretend already initialised — skip initializeApp branch
  firestore: jest.fn(() => ({
    collection: mockOrgCollection,
    batch: mockBatchFn,
  })),
}), { virtual: true })

// eslint-disable-next-line import/first
import { parseFlags, buildCsvRow, writeCsvReport, run } from '@/scripts/crm-migrate-multi-pipeline'
import { writeFileSync } from 'fs'
import type { MigrationResult } from '@/lib/pipelines/migration'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeQuery() {
  return {
    where: mockWhere,
    orderBy: mockOrderBy,
    limit: mockLimit,
    get: mockGet,
  }
}

function makeDeal(id: string, stage = 'discovery', pipelineId?: string) {
  return {
    id,
    ref: { id },
    data: () => ({
      orgId: 'org-a',
      stage,
      ...(pipelineId ? { pipelineId } : {}),
    }),
  }
}

function makeOrgDocs(...ids: string[]) {
  return ids.map((id) => ({ id, data: () => ({ name: `Org ${id}` }) }))
}

beforeEach(() => {
  jest.clearAllMocks()

  // Wire query chain
  const q = makeQuery()
  mockWhere.mockReturnValue(q)
  mockOrderBy.mockReturnValue(q)
  mockLimit.mockReturnValue(q)

  mockCollection.mockReturnValue({
    where: mockWhere,
    add: mockAdd,
    doc: mockDoc,
  })
  mockAdd.mockResolvedValue({ id: 'new-pipeline-id' })
  mockDoc.mockReturnValue({ id: 'doc-id', get: mockGet, update: mockDocUpdate })
  mockDocUpdate.mockResolvedValue(undefined)
  mockBatchCommit.mockResolvedValue(undefined)

  // Default: org query returns nothing (overridden per test)
  mockOrgCollection.mockReturnValue({
    where: jest.fn().mockReturnThis(),
    get: mockOrgGet,
  })
  mockOrgGet.mockResolvedValue({ size: 0, docs: [] })
})

// ── parseFlags ────────────────────────────────────────────────────────────────

describe('parseFlags', () => {
  it('defaults to dry-run=true', () => {
    expect(parseFlags([])).toEqual({ dryRun: true })
  })

  it('--commit sets dryRun false', () => {
    expect(parseFlags(['--commit'])).toMatchObject({ dryRun: false })
  })

  it('--dry-run keeps dryRun true even after --commit', () => {
    expect(parseFlags(['--commit', '--dry-run'])).toMatchObject({ dryRun: true })
  })

  it('--org-id captures next token', () => {
    expect(parseFlags(['--org-id', 'org-xyz'])).toMatchObject({ orgId: 'org-xyz' })
  })

  it('--org-id + --commit together', () => {
    expect(parseFlags(['--org-id', 'org-xyz', '--commit'])).toEqual({ dryRun: false, orgId: 'org-xyz' })
  })
})

// ── buildCsvRow ───────────────────────────────────────────────────────────────

describe('buildCsvRow', () => {
  it('produces correct comma-separated line for a clean result', () => {
    const r: MigrationResult = {
      orgId: 'org-1',
      pipelineCreated: true,
      pipelineId: 'pl-abc',
      dealsUpdated: 7,
      errors: [],
    }
    expect(buildCsvRow(r)).toBe('org-1,true,pl-abc,7,')
  })

  it('includes sanitised errors (commas → semicolons)', () => {
    const r: MigrationResult = {
      orgId: 'org-2',
      pipelineCreated: false,
      pipelineId: 'pl-existing',
      dealsUpdated: 0,
      errors: ['err one, two', 'another error'],
    }
    const row = buildCsvRow(r)
    expect(row).toContain('err one; two | another error')
  })
})

// ── writeCsvReport ────────────────────────────────────────────────────────────

describe('writeCsvReport', () => {
  it('writes a file whose path contains the mode string', () => {
    const results: MigrationResult[] = [
      { orgId: 'org-1', pipelineCreated: true, pipelineId: 'pl-1', dealsUpdated: 3, errors: [] },
    ]
    const path = writeCsvReport(results, 'dryrun', '/tmp/test-reports')
    expect(path).toMatch(/dryrun/)
    expect(writeFileSync).toHaveBeenCalledTimes(1)
    const [calledPath, content] = (writeFileSync as jest.Mock).mock.calls[0]
    expect(calledPath).toMatch(/a3-multi-pipeline-dryrun/)
    expect(content).toContain('orgId,pipelineCreated,pipelineId,dealsUpdated,errors')
    expect(content).toContain('org-1,true,pl-1,3,')
  })

  it('uses "commit" suffix when mode is commit', () => {
    writeCsvReport([], 'commit', '/tmp/test-reports')
    const [calledPath] = (writeFileSync as jest.Mock).mock.calls[0]
    expect(calledPath).toMatch(/a3-multi-pipeline-commit/)
  })
})

// ── run() — dry-run ───────────────────────────────────────────────────────────

describe('run() — dry-run mode', () => {
  it('does not call batch.commit() even when deals exist', async () => {
    mockOrgGet.mockResolvedValue({
      size: 1,
      docs: makeOrgDocs('org-a'),
    })

    // migrateOrgToDefaultPipeline call stack:
    //  get#1 → existing pipeline check → empty (so pipeline will be created / dry-run)
    //  get#2 → deals query → 2 legacy deals
    mockGet
      .mockResolvedValueOnce({ empty: true, docs: [] })  // no existing pipeline
      .mockResolvedValueOnce({
        empty: false,
        docs: [makeDeal('d1', 'proposal'), makeDeal('d2', 'won')],
      })

    const results = await run({ dryRun: true })

    expect(results).toHaveLength(1)
    expect(results[0].dealsUpdated).toBe(2)
    expect(results[0].pipelineCreated).toBe(true)
    // No writes
    expect(mockBatchCommit).not.toHaveBeenCalled()
    expect(mockAdd).not.toHaveBeenCalled()
  })
})

// ── run() — commit mode ───────────────────────────────────────────────────────

describe('run() — commit mode', () => {
  it('calls batch.commit() for each 30-deal chunk', async () => {
    mockOrgGet.mockResolvedValue({
      size: 1,
      docs: makeOrgDocs('org-a'),
    })

    const deals31 = Array.from({ length: 31 }, (_, i) => makeDeal(`d${i}`, 'discovery'))

    mockGet
      .mockResolvedValueOnce({ empty: true, docs: [] })   // no existing pipeline
      .mockResolvedValueOnce({ empty: true, docs: [] })   // bootstrapDefaultPipeline internal check
      .mockResolvedValueOnce({ empty: false, docs: deals31 }) // deals query

    const results = await run({ dryRun: false })

    expect(results[0].dealsUpdated).toBe(31)
    // 31 deals → chunk of 30 + chunk of 1 = 2 batch.commit() calls
    expect(mockBatchCommit).toHaveBeenCalledTimes(2)
  })

  it('creates one pipeline per org and returns pipelineId', async () => {
    mockOrgGet.mockResolvedValue({ size: 1, docs: makeOrgDocs('org-b') })

    mockGet
      .mockResolvedValueOnce({ empty: true, docs: [] })   // no existing pipeline
      .mockResolvedValueOnce({ empty: true, docs: [] })   // bootstrap internal check
      .mockResolvedValueOnce({ empty: true, docs: [] })   // no deals

    const results = await run({ dryRun: false })

    expect(results[0].pipelineCreated).toBe(true)
    expect(results[0].pipelineId).toBe('new-pipeline-id')
  })
})

// ── Idempotency ───────────────────────────────────────────────────────────────

describe('idempotency', () => {
  it('second run produces 0 dealsUpdated when all deals already have pipelineId', async () => {
    mockOrgGet.mockResolvedValue({ size: 1, docs: makeOrgDocs('org-c') })

    // Org already has a pipeline
    const existingPipeline = {
      id: 'pl-existing',
      data: () => ({ orgId: 'org-c', isDefault: true }),
    }

    // Deals already migrated
    const migratedDeals = [
      makeDeal('d1', 'discovery', 'pl-existing'),
      makeDeal('d2', 'won', 'pl-existing'),
    ]

    mockGet
      .mockResolvedValueOnce({ empty: false, docs: [existingPipeline] }) // pipeline exists → skip create
      .mockResolvedValueOnce({ empty: false, docs: migratedDeals })       // deals have pipelineId → filter skips all

    const results = await run({ dryRun: false })

    expect(results[0].pipelineCreated).toBe(false)
    expect(results[0].dealsUpdated).toBe(0)
    expect(mockBatchCommit).not.toHaveBeenCalled()
  })
})

// ── --org-id filter ───────────────────────────────────────────────────────────

describe('--org-id flag', () => {
  it('passes orgId filter to org collection query', async () => {
    const mockWhereFn = jest.fn().mockReturnValue({ get: mockOrgGet })
    mockOrgCollection.mockReturnValue({ where: mockWhereFn, get: mockOrgGet })
    mockOrgGet.mockResolvedValue({ size: 0, docs: [] })

    await run({ dryRun: true, orgId: 'org-specific' })

    expect(mockWhereFn).toHaveBeenCalledWith('__name__', '==', 'org-specific')
  })
})
