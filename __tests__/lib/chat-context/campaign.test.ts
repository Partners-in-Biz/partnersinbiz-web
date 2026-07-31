import { campaignChatContextAdapter } from '@/lib/chat-context/adapters/campaign'

const mockGet = jest.fn()
const mockBuildAssets = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => ({
      doc: (id: string) => ({
        get: () => mockGet(name, id),
      }),
    }),
  },
}))

jest.mock('@/lib/campaigns/assets', () => ({
  buildCampaignAssets: (...args: unknown[]) => mockBuildAssets(...args),
}))

describe('campaign chat context adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns a campaign preview model with asset metrics and pending attention', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      id: 'camp-1',
      data: () => ({
        orgId: 'org-1',
        name: 'July Growth Push',
        status: 'in_review',
        deleted: false,
      }),
    })
    mockBuildAssets.mockResolvedValue({
      campaignId: 'camp-1',
      social: [
        { id: 's1', platforms: ['linkedin'], content: { text: 'LI post' }, status: 'pending_approval' },
        { id: 's2', platforms: ['instagram'], content: { text: 'IG post' }, status: 'approved', approvedBy: 'reviewer-1' },
      ],
      blogs: [{ id: 'b1', title: 'Launch blog', status: 'review' }],
      videos: [{ id: 'v1', platforms: ['youtube'], content: { text: 'Video' }, status: 'draft' }],
      meta: {
        totals: { social: 2, blogs: 1, videos: 1 },
        byStatus: { draft: 1, pending_approval: 2, approved: 1, published: 0 },
      },
    })

    const result = await campaignChatContextAdapter.resolve({
      kind: 'campaign',
      id: 'camp-1',
      user: { uid: 'u1', role: 'client', authKind: 'session', activeOrgId: 'org-1', orgId: 'org-1' },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.model.context).toMatchObject({
      kind: 'campaign',
      id: 'camp-1',
      label: 'July Growth Push',
      href: '/portal/campaigns/camp-1',
    })
    expect(result.model.preview?.kind).toBe('campaign')
    expect(result.model.pulse.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'social', value: 2 }),
      expect.objectContaining({ id: 'blogs', value: 1 }),
      expect.objectContaining({ id: 'videos', value: 1 }),
    ]))
    expect(result.model.attention.some((item) => item.state === 'needs_approval')).toBe(true)
    expect(result.model.groups.find((g) => g.id === 'social')?.items).toHaveLength(2)
    expect(result.model.groups.find((g) => g.id === 'social')?.items[0].actions?.[0]).toEqual(expect.objectContaining({
      label: 'Approve post',
      href: '/api/v1/social/posts/s1/client-approve',
    }))
    expect(result.model.groups.find((g) => g.id === 'social')?.items[1].actions).toBeUndefined()
    expect(result.model.groups.find((g) => g.id === 'videos')?.items[0].actions?.[0]).toEqual(expect.objectContaining({
      label: 'Submit for review',
      href: '/api/v1/social/posts/v1/submit',
    }))
    expect(result.model.capabilities).toEqual(expect.arrayContaining(['open', 'preview', 'inline-actions']))
  })

  it('returns not_found when the campaign is missing or soft-deleted', async () => {
    mockGet.mockResolvedValue({ exists: false, data: () => undefined })
    await expect(campaignChatContextAdapter.resolve({
      kind: 'campaign',
      id: 'missing',
      user: { uid: 'u1', role: 'admin', authKind: 'session', activeOrgId: 'org-1', orgId: 'org-1' },
    })).resolves.toMatchObject({ ok: false, reason: 'not_found', status: 404 })
  })

  it('does not create a mutation target for an asset without a canonical id', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      id: 'camp-1',
      data: () => ({ orgId: 'org-1', name: 'Launch', status: 'draft', deleted: false }),
    })
    mockBuildAssets.mockResolvedValue({
      social: [{ platforms: ['linkedin'], content: { text: 'Incomplete record' }, status: 'draft' }],
      blogs: [],
      videos: [],
      meta: { totals: { social: 1, blogs: 0, videos: 0 }, byStatus: { draft: 1 } },
    })

    const result = await campaignChatContextAdapter.resolve({
      kind: 'campaign',
      id: 'camp-1',
      user: { uid: 'u1', role: 'client', authKind: 'session', activeOrgId: 'org-1', orgId: 'org-1' },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.model.groups[0].items[0].actions).toBeUndefined()
    expect(result.model.capabilities).not.toContain('inline-actions')
  })
})
