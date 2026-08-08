jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: jest.fn() },
}))

import { adminDb } from '@/lib/firebase/admin'
import {
  addDesignIterationVariants,
  applyDesignIteration,
  createDesignIterationSession,
  decideDesignIterationVariant,
  DESIGN_ITERATION_SESSIONS_COLLECTION,
  getDesignIterationSession,
  listDesignIterationSessions,
} from '@/lib/design-iteration/store'
import { cleanDesignIterationVariant, designIterationOwnedBy } from '@/lib/design-iteration/types'

const mockCollection = adminDb.collection as jest.Mock
let mockDoc: jest.Mock
let mockGet: jest.Mock
let mockSet: jest.Mock
let mockUpdate: jest.Mock

function variantInput(overrides: Record<string, unknown> = {}) {
  return {
    archetype: 'Bolder hero',
    description: 'Increase heading scale and contrast on the hero.',
    changeType: 'dom-css',
    screenshotUrl: 'https://cdn.example/v1.jpg',
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockDoc = jest.fn((id: string) => ({ id, get: mockGet, set: mockSet, update: mockUpdate }))
  mockCollection.mockReturnValue({ doc: mockDoc, where: jest.fn().mockReturnValue({ orderBy: jest.fn().mockReturnValue({ limit: jest.fn().mockReturnValue({ get: jest.fn().mockResolvedValue({ docs: [] }) }) }) }) })
  mockGet = jest.fn()
  mockSet = jest.fn()
  mockUpdate = jest.fn()
})

describe('design-iteration store', () => {
  it('creates an org-scoped session and reads it back with org scoping', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({
        orgId: 'org-1', url: 'https://example.com', instruction: 'make the hero bolder',
        elementRefs: [{ ref: '@e12', name: 'Hero heading' }],
        variants: [{ id: 'v_1', archetype: 'Bolder hero', description: 'x', changeType: 'dom-css', status: 'pending', createdAtMs: 1000 }],
        status: 'review', createdAtMs: 1000, updatedAtMs: 1000,
      }),
    })

    const created = await createDesignIterationSession({
      orgId: 'org-1',
      url: 'https://example.com',
      instruction: 'make the hero bolder',
      elementRefs: [{ ref: '@e12', name: 'Hero heading' }],
      variants: [cleanDesignIterationVariant(variantInput(), 1000, 0)!],
      createdBy: 'user-1',
      nowMs: 1000,
    })
    expect(created.id).toMatch(/^di_/)
    expect(created.status).toBe('review')
    expect(created.orgId).toBe('org-1')
    expect(mockSet).toHaveBeenCalled()

    const read = await getDesignIterationSession('org-1', 'di_1')
    expect(read?.url).toBe('https://example.com')
    expect(read?.variants[0].archetype).toBe('Bolder hero')

    const otherOrg = await getDesignIterationSession('org-2', 'di_1')
    expect(otherOrg).toBeNull()
  })

  it('creates a draft when no variants are supplied', async () => {
    const created = await createDesignIterationSession({
      orgId: 'org-1',
      url: 'https://example.com',
      instruction: 'pick a direction',
      nowMs: 1000,
    })
    expect(created.status).toBe('draft')
    expect(created.variants).toEqual([])
  })

  it('appends variants to an existing deck', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({
        orgId: 'org-1', url: 'https://example.com', instruction: 'make it bolder',
        elementRefs: [], variants: [], status: 'draft', createdAtMs: 1000, updatedAtMs: 1000,
      }),
    })
    const session = await addDesignIterationVariants('org-1', 'di_1', [
      cleanDesignIterationVariant(variantInput(), 2000, 0)!,
      cleanDesignIterationVariant({ archetype: 'Sharp corners', description: 'Keep sharp 0-radius cards.', changeType: 'dom-css' }, 2000, 1)!,
    ], { nowMs: 2000 })
    expect(session?.status).toBe('review')
    expect(session?.variants).toHaveLength(2)
    expect(mockUpdate).toHaveBeenCalled()
  })

  it('accepts a variant and flips session status to accepted', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({
        orgId: 'org-1', url: 'https://example.com', instruction: 'bolder',
        elementRefs: [],
        variants: [
          { id: 'v_1', archetype: 'Bolder hero', description: 'x', changeType: 'dom-css', status: 'pending', createdAtMs: 1000 },
          { id: 'v_2', archetype: 'Quiet minimal', description: 'y', changeType: 'dom-css', status: 'pending', createdAtMs: 1000 },
        ],
        status: 'review', createdAtMs: 1000, updatedAtMs: 1000,
      }),
    })

    const { session, variant } = await decideDesignIterationVariant({
      orgId: 'org-1', sessionId: 'di_1', variantId: 'v_1', decision: 'accept', decidedBy: 'user-1',
    })
    expect(variant?.status).toBe('accepted')
    expect(session?.status).toBe('accepted')
    expect(session?.acceptedVariantId).toBe('v_1')
    expect(mockUpdate).toHaveBeenCalled()
  })

  it('rejects all variants -> session status rejected', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({
        orgId: 'org-1', url: 'https://example.com', instruction: 'bolder',
        elementRefs: [],
        variants: [
          { id: 'v_1', archetype: 'A', description: 'x', changeType: 'dom-css', status: 'pending', createdAtMs: 1000 },
        ],
        status: 'review', createdAtMs: 1000, updatedAtMs: 1000,
      }),
    })
    const { session } = await decideDesignIterationVariant({
      orgId: 'org-1', sessionId: 'di_1', variantId: 'v_1', decision: 'reject', decidedBy: 'user-1',
    })
    expect(session?.status).toBe('rejected')
  })

  it('refuses to apply before an accept', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({
        orgId: 'org-1', url: 'https://example.com', instruction: 'bolder',
        elementRefs: [],
        variants: [{ id: 'v_1', archetype: 'A', description: 'x', changeType: 'dom-css', status: 'pending', createdAtMs: 1000 }],
        status: 'review', createdAtMs: 1000, updatedAtMs: 1000,
      }),
    })
    const applied = await applyDesignIteration({
      orgId: 'org-1', sessionId: 'di_1',
      apply: { repo: 'client-site', branch: 'development', filesChanged: ['index.html'], diffSummary: 'x', appliedAtMs: 2000 },
    })
    expect(applied).toBeNull()
  })

  it('records an apply after an accept', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({
        orgId: 'org-1', url: 'https://example.com', instruction: 'bolder',
        elementRefs: [],
        variants: [{ id: 'v_1', archetype: 'A', description: 'x', changeType: 'dom-css', status: 'accepted', createdAtMs: 1000 }],
        acceptedVariantId: 'v_1', status: 'accepted', createdAtMs: 1000, updatedAtMs: 1000,
      }),
    })
    const applied = await applyDesignIteration({
      orgId: 'org-1', sessionId: 'di_1',
      apply: {
        repo: 'partnersinbiz-web-development', branch: 'development',
        filesChanged: ['app/page.tsx'], diffSummary: '+12 -3 hero block',
        detectorExitCode: 0, detectorFindings: 0, appliedAtMs: 2000, appliedBy: 'agent:theo',
      },
    })
    expect(applied?.status).toBe('applied')
    expect(applied?.apply?.repo).toBe('partnersinbiz-web-development')
    expect(applied?.apply?.detectorExitCode).toBe(0)
    expect(mockUpdate).toHaveBeenCalled()
  })

  it('lists only the caller org sessions', async () => {
    mockCollection.mockReturnValue({
      where: jest.fn().mockReturnValue({
        orderBy: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            get: jest.fn().mockResolvedValue({
              docs: [
                { id: 'di_1', data: () => ({ orgId: 'org-1', url: 'https://a.com', instruction: 'x', elementRefs: [], variants: [], status: 'review', createdAtMs: 1, updatedAtMs: 1 }) },
              ],
            }),
          }),
        }),
      }),
    })
    const sessions = await listDesignIterationSessions('org-1')
    expect(sessions).toHaveLength(1)
    expect(sessions[0].url).toBe('https://a.com')
  })

  it('validates ownership and variant cleaning', () => {
    expect(designIterationOwnedBy({ orgId: 'org-1' }, 'org-1')).toBe(true)
    expect(designIterationOwnedBy({ orgId: 'org-1' }, 'org-2')).toBe(false)
    const clean = cleanDesignIterationVariant(variantInput(), 1000, 2)
    expect(clean?.id).toBe('v_1000_2')
    expect(clean?.status).toBe('pending')
    expect(cleanDesignIterationVariant({ archetype: '', description: 'x' }, 1000, 0)).toBeNull()
  })
})
