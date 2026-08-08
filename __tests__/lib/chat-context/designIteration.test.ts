jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: jest.fn() },
}))

import { adminDb } from '@/lib/firebase/admin'
import { designIterationChatContextAdapter } from '@/lib/chat-context/adapters/designIteration'
import type { ChatContextResolveInput } from '@/lib/chat-context/access'

const mockCollection = adminDb.collection as jest.Mock
let mockDoc: jest.Mock
let mockGet: jest.Mock

function resolveInput(overrides: Partial<ChatContextResolveInput> = {}): ChatContextResolveInput {
  return {
    kind: 'design',
    id: 'di_abc123',
    user: { uid: 'user-1', role: 'client', orgId: 'org-1', activeOrgId: 'org-1' } as ChatContextResolveInput['user'],
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockDoc = jest.fn((id: string) => ({ id, get: mockGet }))
  mockCollection.mockReturnValue({ doc: mockDoc })
  mockGet = jest.fn()
})

describe('design-iteration chat-context adapter', () => {
  it('resolves a di_ session into a variant-deck model', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      id: 'di_abc123',
      data: () => ({
        orgId: 'org-1', url: 'https://example.com', instruction: 'make the hero bolder',
        elementRefs: [{ ref: '@e12' }],
        variants: [
          { id: 'v_1', archetype: 'Bolder hero', description: 'Larger scale.', changeType: 'dom-css', status: 'pending', createdAtMs: 1000 },
          { id: 'v_2', archetype: 'Sharp corners', description: 'Zero-radius.', changeType: 'dom-css', status: 'pending', createdAtMs: 1000 },
        ],
        status: 'review', createdAtMs: 1000, updatedAtMs: 1000,
      }),
    })

    const result = await designIterationChatContextAdapter.resolve(resolveInput())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.model.context.kind).toBe('design')
    expect(result.model.context.id).toBe('di_abc123')
    expect(result.model.pulse?.metrics).toContainEqual({ id: 'variants', label: 'Variants', value: 2 })
    expect(result.model.groups).toHaveLength(2)
    expect(result.model.groups?.[0].label).toContain('Bolder hero')
    expect(result.model.attention?.[0].label).toContain('awaiting decision')
    expect(result.model.preview?.status).toBe('review')
  })

  it('shows applied + detector attention when the session is applied', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      id: 'di_abc123',
      data: () => ({
        orgId: 'org-1', url: 'https://example.com', instruction: 'x',
        elementRefs: [],
        variants: [{ id: 'v_1', archetype: 'A', description: 'x', changeType: 'dom-css', status: 'accepted', createdAtMs: 1000 }],
        acceptedVariantId: 'v_1', status: 'applied',
        apply: { repo: 'partnersinbiz-web-development', branch: 'development', filesChanged: ['x'], diffSummary: '+12 -3', detectorExitCode: 0, detectorFindings: 0, appliedAtMs: 2000 },
        createdAtMs: 1000, updatedAtMs: 2000,
      }),
    })

    const result = await designIterationChatContextAdapter.resolve(resolveInput())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.model.preview?.status).toBe('complete')
    expect(result.model.attention?.[0].label).toBe('Applied to repo')
    expect(result.model.attention?.some((item) => item.id === 'detector')).toBe(true)
  })

  it('is org-scoped: returns not_found for a foreign org', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      id: 'di_abc123',
      data: () => ({ orgId: 'org-2', url: 'https://example.com', instruction: 'x', elementRefs: [], variants: [], status: 'review', createdAtMs: 1, updatedAtMs: 1 }),
    })
    const result = await designIterationChatContextAdapter.resolve(resolveInput())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('not_found')
  })

  it('rejects non-design kinds', async () => {
    const result = await designIterationChatContextAdapter.resolve(resolveInput({ kind: 'project', id: 'p_1' }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('unsupported')
  })
})
