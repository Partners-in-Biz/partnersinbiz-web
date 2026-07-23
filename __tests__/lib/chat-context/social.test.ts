import { socialChatContextAdapter } from '@/lib/chat-context/adapters/social'

const mockGet = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => ({
      doc: (id: string) => ({
        get: () => mockGet(name, id),
      }),
    }),
  },
}))

describe('social chat context adapter', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns a social preview model with platform detail and campaign relationship', async () => {
    mockGet.mockImplementation(async (collection: string) => {
      if (collection === 'social_posts') {
        return {
          exists: true,
          id: 'post-1',
          data: () => ({
            orgId: 'org-1',
            content: { text: 'Ship the carousel today' },
            platforms: ['instagram'],
            status: 'client_review',
            campaignId: 'camp-1',
            format: 'feed',
          }),
        }
      }
      return {
        exists: true,
        id: 'camp-1',
        data: () => ({ orgId: 'org-1', name: 'July Growth Push', deleted: false }),
      }
    })

    const result = await socialChatContextAdapter.resolve({
      kind: 'social',
      id: 'post-1',
      user: { uid: 'u1', role: 'client', authKind: 'session', activeOrgId: 'org-1', orgId: 'org-1' },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.model.context).toMatchObject({
      kind: 'social',
      id: 'post-1',
      href: '/portal/social/review/post-1',
    })
    expect(result.model.preview?.kind).toBe('social')
    expect(result.model.pulse.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'platform', value: 'instagram' }),
      expect.objectContaining({ id: 'status', value: 'client_review' }),
    ]))
    expect(result.model.relationships).toEqual([
      expect.objectContaining({ kind: 'campaign', id: 'camp-1', label: 'July Growth Push' }),
    ])
    expect(result.model.attention[0]?.state).toBe('review')
    expect(result.model.capabilities).toEqual(expect.arrayContaining(['open', 'preview']))
  })

  it('rejects posts outside the caller org', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      id: 'post-1',
      data: () => ({ orgId: 'other-org', content: 'Nope', platforms: ['x'] }),
    })

    await expect(socialChatContextAdapter.resolve({
      kind: 'social',
      id: 'post-1',
      user: { uid: 'u1', role: 'client', authKind: 'session', activeOrgId: 'org-1', orgId: 'org-1' },
    })).resolves.toMatchObject({ ok: false, reason: 'not_found', status: 404 })
  })
})
