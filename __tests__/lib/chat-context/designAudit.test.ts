jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: jest.fn() },
}))

import { adminDb } from '@/lib/firebase/admin'
import { designAuditChatContextAdapter } from '@/lib/chat-context/adapters/designAudit'
import type { ApiUser } from '@/lib/api/types'

const mockCollection = adminDb.collection as jest.Mock
let mockGet: jest.Mock

function makeUser(role: 'admin' | 'client' = 'admin'): ApiUser {
  return { uid: 'user-1', role, orgId: 'org-1', activeOrgId: 'org-1' }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGet = jest.fn()
  mockCollection.mockReturnValue({ doc: jest.fn((id: string) => ({ id, get: mockGet })) })
})

describe('designAuditChatContextAdapter', () => {
  it('resolves an org-scoped design run into a read model', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      id: 'dar_1',
      data: () => ({
        orgId: 'org-1', url: 'https://example.com/', scope: 'all', status: 'done', exitCode: 2,
        summary: { total: 2, bySeverity: { P0: 1, P1: 1, P2: 0, P3: 0 }, byScope: { type: 2 } },
        findings: [
          { rule: 'tiny-body-text', severity: 'P1', scope: 'type', ref: 'p:nth-of-type(1)', line: 2, snippet: '<p>', message: 'Body text too small' },
          { rule: 'purple-gradients', severity: 'P0', scope: 'layout', ref: 'section.hero', line: 1, snippet: '<section>', message: 'Purple gradient' },
        ],
        notes: [], errors: [], designSystemPresent: false,
        waivers: [{ id: 'w_1', rule: 'tiny-body-text', ref: 'p:nth-of-type(1)', reason: 'Legal footer', createdAtMs: 100 }],
        createdAtMs: 1000, updatedAtMs: 1000,
      }),
    })

    const result = await designAuditChatContextAdapter.resolve({
      kind: 'design',
      id: 'dar_1',
      user: makeUser(),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.model.context).toMatchObject({ kind: 'design', id: 'dar_1', orgId: 'org-1' })
    expect(result.model.pulse.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'p0', value: 1 }),
      expect.objectContaining({ id: 'p1', value: 1 }),
    ]))
    const groupLabels = result.model.groups.map((g) => g.label)
    expect(groupLabels).toEqual(expect.arrayContaining(['P0 findings', 'P1 findings']))
    expect(result.model.attention.some((a) => a.id === 'p0-findings')).toBe(true)
    expect(result.model.attention.some((a) => a.id === 'waivers')).toBe(true)
  })

  it('rejects runs from another org', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({
        orgId: 'org-other', url: 'https://example.com/', scope: 'all', status: 'done', exitCode: 0,
        summary: { total: 0, bySeverity: { P0: 0, P1: 0, P2: 0, P3: 0 }, byScope: {} },
        findings: [], notes: [], errors: [], designSystemPresent: false, waivers: [],
        createdAtMs: 1000, updatedAtMs: 1000,
      }),
    })
    const result = await designAuditChatContextAdapter.resolve({ kind: 'design', id: 'dar_1', user: makeUser() })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('not_found')
  })

  it('returns not_found for missing runs and unsupported for other kinds', async () => {
    mockGet.mockResolvedValue({ exists: false })
    const missing = await designAuditChatContextAdapter.resolve({ kind: 'design', id: 'dar_missing', user: makeUser() })
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.reason).toBe('not_found')

    const unsupported = await designAuditChatContextAdapter.resolve({ kind: 'project', id: 'p1', user: makeUser() })
    expect(unsupported.ok).toBe(false)
    if (!unsupported.ok) expect(unsupported.reason).toBe('unsupported')
  })

  it('reports clean state for zero findings', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({
        orgId: 'org-1', url: 'https://example.com/', scope: 'all', status: 'done', exitCode: 0,
        summary: { total: 0, bySeverity: { P0: 0, P1: 0, P2: 0, P3: 0 }, byScope: {} },
        findings: [], notes: [], errors: [], designSystemPresent: false, waivers: [],
        createdAtMs: 1000, updatedAtMs: 1000,
      }),
    })
    const result = await designAuditChatContextAdapter.resolve({ kind: 'design', id: 'dar_1', user: makeUser() })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.model.preview?.status).toBe('complete')
    expect(result.model.attention).toHaveLength(0)
  })
})
