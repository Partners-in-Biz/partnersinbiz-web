jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: jest.fn() },
}))

import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import {
  createDesignAuditRun,
  DESIGN_AUDIT_RUNS_COLLECTION,
  getDesignAuditRun,
  listDesignAuditRuns,
  recordDesignAuditWaiver,
  replaceDesignAuditRunResult,
} from '@/lib/design-audit/audit-runs'
import type { AuditResult } from '@/lib/design-audit/types'

const mockCollection = adminDb.collection as jest.Mock
let mockDoc: jest.Mock
let mockGet: jest.Mock
let mockSet: jest.Mock
let mockUpdate: jest.Mock

function makeResult(overrides: Partial<AuditResult> = {}): AuditResult {
  return {
    schema: 'pib-design-audit/v1',
    exitCode: 2,
    summary: { total: 1, bySeverity: { P0: 0, P1: 1, P2: 0, P3: 0 }, byScope: { type: 1 } },
    findings: [{ rule: 'tiny-body-text', severity: 'P1', scope: 'type', ref: 'p:nth-of-type(1)', line: 2, snippet: '<p>', message: 'Body text is too small', value: '11px' }],
    rulesRun: ['tiny-body-text'],
    rulesIgnored: [],
    designSystem: { present: false },
    notes: [],
    errors: [],
    durationMs: 5,
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockDoc = jest.fn((id: string) => ({ id, get: mockGet, set: mockSet, update: mockUpdate }))
  mockCollection.mockReturnValue({ doc: mockDoc })
  mockGet = jest.fn()
  mockSet = jest.fn()
  mockUpdate = jest.fn()
})

describe('design-audit audit-runs store', () => {
  it('creates an org-scoped run and reads it back with org scoping', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({
        orgId: 'org-1', url: 'https://example.com', scope: 'all', status: 'done', exitCode: 2,
        summary: { total: 1, bySeverity: { P0: 0, P1: 1, P2: 0, P3: 0 }, byScope: { type: 1 } },
        findings: [{ rule: 'tiny-body-text', severity: 'P1', scope: 'type', ref: 'p:nth-of-type(1)', line: 2, snippet: '<p>', message: 'Body text is too small' }],
        notes: [], errors: [], designSystemPresent: false, waivers: [],
        createdAtMs: 1000, updatedAtMs: 1000,
      }),
    })

    const created = await createDesignAuditRun({
      orgId: 'org-1',
      url: 'https://example.com',
      scope: 'all',
      result: makeResult(),
      screenshotUrl: 'https://cdn.example/frame.jpg',
      createdBy: 'user-1',
      nowMs: 1000,
    })
    expect(created.id).toMatch(/^dar_/)
    expect(created.orgId).toBe('org-1')
    expect(mockCollection).toHaveBeenCalledWith(DESIGN_AUDIT_RUNS_COLLECTION)
    expect(mockSet).toHaveBeenCalled()

    const read = await getDesignAuditRun('org-1', created.id)
    expect(read?.url).toBe('https://example.com')

    const wrongOrg = await getDesignAuditRun('org-2', created.id)
    expect(wrongOrg).toBeNull()
  })

  it('returns null when the run does not exist', async () => {
    mockGet.mockResolvedValue({ exists: false })
    expect(await getDesignAuditRun('org-1', 'dar_missing')).toBeNull()
  })

  it('records a waiver and persists it', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({
        orgId: 'org-1', url: 'https://example.com', scope: 'all', status: 'done', exitCode: 2,
        summary: { total: 1, bySeverity: { P0: 0, P1: 1, P2: 0, P3: 0 }, byScope: { type: 1 } },
        findings: [], notes: [], errors: [], designSystemPresent: false, waivers: [],
        createdAtMs: 1000, updatedAtMs: 1000,
      }),
    })

    const run = await recordDesignAuditWaiver({
      orgId: 'org-1',
      runId: 'dar_1',
      rule: 'tiny-body-text',
      ref: 'p:nth-of-type(1)',
      reason: 'Intentionally compact legal footer',
      createdBy: 'user-1',
      nowMs: 2000,
    })
    expect(run?.waivers).toHaveLength(1)
    expect(run?.waivers[0]).toMatchObject({ rule: 'tiny-body-text', reason: 'Intentionally compact legal footer' })
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ waivers: expect.any(Array) }))
  })

  it('replaces the engine result on re-run', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({
        orgId: 'org-1', url: 'https://example.com', scope: 'all', status: 'done', exitCode: 2,
        summary: { total: 1, bySeverity: { P0: 0, P1: 1, P2: 0, P3: 0 }, byScope: { type: 1 } },
        findings: [], notes: [], errors: [], designSystemPresent: false, waivers: [],
        createdAtMs: 1000, updatedAtMs: 1000,
      }),
    })

    const run = await replaceDesignAuditRunResult({
      orgId: 'org-1',
      runId: 'dar_1',
      result: makeResult({ exitCode: 0, summary: { total: 0, bySeverity: { P0: 0, P1: 0, P2: 0, P3: 0 }, byScope: {} }, findings: [] }),
      nowMs: 3000,
    })
    expect(run?.exitCode).toBe(0)
    expect(run?.findings).toHaveLength(0)
  })

  it('lists runs for an org with descending createdAtMs', async () => {
    mockCollection.mockReturnValue({
      doc: mockDoc,
      where: jest.fn(() => ({ orderBy: jest.fn(() => ({ limit: jest.fn(() => ({ get: mockGet })) })) })),
    })
    mockGet.mockResolvedValue({
      docs: [
        { id: 'dar_2', data: () => ({ orgId: 'org-1', url: 'https://example.com/2', scope: 'all', status: 'done', exitCode: 0, summary: null, findings: [], notes: [], errors: [], designSystemPresent: false, waivers: [], createdAtMs: 2000, updatedAtMs: 2000 }) },
        { id: 'dar_1', data: () => ({ orgId: 'org-1', url: 'https://example.com/1', scope: 'all', status: 'done', exitCode: 2, summary: null, findings: [], notes: [], errors: [], designSystemPresent: false, waivers: [], createdAtMs: 1000, updatedAtMs: 1000 }) },
      ],
    })
    const runs = await listDesignAuditRuns('org-1')
    expect(runs.map((r) => r.id)).toEqual(['dar_2', 'dar_1'])
  })

  it('exposes FieldValue for server timestamps', () => {
    expect(typeof FieldValue.serverTimestamp).toBe('function')
  })
})
