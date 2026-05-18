// __tests__/lib/scoring/store.test.ts

const mockDocGet = jest.fn()
const mockDoc = jest.fn()
const mockCollection = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

import { loadConfig, getOrBootstrapConfig, sanitizeConfigForWrite } from '@/lib/scoring/store'

beforeEach(() => {
  jest.clearAllMocks()
  mockDoc.mockReturnValue({ get: mockDocGet })
  mockCollection.mockReturnValue({ doc: mockDoc })
})

// ── loadConfig ───────────────────────────────────────────────────────────────

describe('loadConfig', () => {
  it('returns null when the doc does not exist', async () => {
    mockDocGet.mockResolvedValue({ exists: false, data: () => null })
    const result = await loadConfig('org-1')
    expect(result).toBeNull()
  })

  it('returns the config when the doc exists', async () => {
    const stored = {
      orgId: 'org-1',
      icp: { industries: ['SaaS'] },
      leadWeights: { emailOpens: 3 },
      aiEnabled: true,
      updatedAt: null,
      createdAt: null,
    }
    mockDocGet.mockResolvedValue({ exists: true, id: 'org-1', data: () => stored })
    const result = await loadConfig('org-1')
    expect(result).not.toBeNull()
    expect(result?.orgId).toBe('org-1')
    expect(result?.icp.industries).toEqual(['SaaS'])
    expect(result?.aiEnabled).toBe(true)
  })

  it('queries the scoringConfig collection with the correct orgId', async () => {
    mockDocGet.mockResolvedValue({ exists: false, data: () => null })
    await loadConfig('org-xyz')
    expect(mockCollection).toHaveBeenCalledWith('scoringConfig')
    expect(mockDoc).toHaveBeenCalledWith('org-xyz')
  })
})

// ── getOrBootstrapConfig ─────────────────────────────────────────────────────

describe('getOrBootstrapConfig', () => {
  it('returns existing config if the doc exists', async () => {
    const stored = {
      orgId: 'org-2',
      icp: {},
      leadWeights: { emailOpens: 5 },
      aiEnabled: false,
      updatedAt: null,
      createdAt: null,
    }
    mockDocGet.mockResolvedValue({ exists: true, id: 'org-2', data: () => stored })
    const result = await getOrBootstrapConfig('org-2')
    expect(result.leadWeights.emailOpens).toBe(5)
  })

  it('returns default config in-memory when doc is absent', async () => {
    mockDocGet.mockResolvedValue({ exists: false, data: () => null })
    const result = await getOrBootstrapConfig('org-new')
    expect(result.orgId).toBe('org-new')
    expect(result.icp).toEqual({})
    expect(result.leadWeights.emailOpens).toBe(2)
    expect(result.leadWeights.emailClicks).toBe(5)
    expect(result.leadWeights.emailReplies).toBe(15)
    expect(result.leadWeights.sequenceCompleted).toBe(10)
    expect(result.leadWeights.recentContact).toBe(10)
    expect(result.leadWeights.formSubmission).toBe(8)
    expect(result.aiEnabled).toBe(false)
    expect(result.aiModel).toBe('gpt-4o-mini')
    expect(result.aiCacheHours).toBe(24)
  })

  it('does NOT write to Firestore when bootstrapping defaults', async () => {
    const mockAdd = jest.fn()
    const mockSet = jest.fn()
    mockDocGet.mockResolvedValue({ exists: false, data: () => null })
    mockDoc.mockReturnValue({ get: mockDocGet, set: mockSet, add: mockAdd })
    await getOrBootstrapConfig('org-no-write')
    expect(mockSet).not.toHaveBeenCalled()
    expect(mockAdd).not.toHaveBeenCalled()
  })
})

// ── sanitizeConfigForWrite ───────────────────────────────────────────────────

describe('sanitizeConfigForWrite', () => {
  it('strips id from input', () => {
    const result = sanitizeConfigForWrite({ id: 'abc', aiEnabled: false })
    expect(result).not.toHaveProperty('id')
    expect(result.aiEnabled).toBe(false)
  })

  it('strips orgId from input', () => {
    const result = sanitizeConfigForWrite({ orgId: 'org-1', icp: {} })
    expect(result).not.toHaveProperty('orgId')
    expect(result.icp).toEqual({})
  })

  it('strips all NEVER_FROM_BODY fields', () => {
    const input = {
      id: 'x',
      orgId: 'org-1',
      createdBy: 'uid',
      createdByRef: { uid: 'uid', name: 'Alice' },
      createdAt: { _seconds: 0 },
      updatedBy: 'uid',
      updatedByRef: { uid: 'uid', name: 'Alice' },
      updatedAt: { _seconds: 1 },
      deleted: true,
      // Safe fields
      aiEnabled: true,
      aiModel: 'gpt-4o',
      icp: { industries: ['Tech'] },
      leadWeights: { emailOpens: 3 },
    }
    const result = sanitizeConfigForWrite(input)
    const forbidden = ['id', 'orgId', 'createdBy', 'createdByRef', 'createdAt', 'updatedBy', 'updatedByRef', 'updatedAt', 'deleted']
    for (const f of forbidden) expect(result).not.toHaveProperty(f)
    expect(result.aiEnabled).toBe(true)
    expect(result.aiModel).toBe('gpt-4o')
    expect(result.icp).toEqual({ industries: ['Tech'] })
    expect(result.leadWeights).toEqual({ emailOpens: 3 })
  })

  it('drops undefined values', () => {
    const result = sanitizeConfigForWrite({ aiEnabled: undefined, icp: {} })
    expect(result).not.toHaveProperty('aiEnabled')
    expect(result.icp).toEqual({})
  })
})
