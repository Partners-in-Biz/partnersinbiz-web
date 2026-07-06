const mockCollection = jest.fn()
const mockWhere2 = jest.fn()
const mockGet = jest.fn()
const mockAdd = jest.fn()
const mockUpdate = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TS' },
}))

type ChannelDoc = { id: string; data: Record<string, unknown> }

function stageChannels(docs: ChannelDoc[]) {
  mockCollection.mockImplementation((name: string) => {
    if (name !== 'youtube_channel_workspaces') throw new Error(`Unexpected collection ${name}`)
    return {
      where: () => ({
        where: (...args: unknown[]) => {
          mockWhere2(...args)
          return {
            get: async () => {
              mockGet()
              return {
                docs: docs.map((doc) => ({
                  id: doc.id,
                  data: () => doc.data,
                  ref: { update: mockUpdate },
                })),
              }
            },
          }
        },
      }),
      add: mockAdd,
    }
  })
  mockAdd.mockResolvedValue({ id: 'new-channel-id' })
  mockUpdate.mockResolvedValue(undefined)
}

const profile = {
  platformAccountId: 'UC123',
  displayName: 'Acme Films',
  username: '@acmefilms',
  avatarUrl: 'https://yt.example/avatar.png',
  profileUrl: 'https://www.youtube.com/@acmefilms',
}

describe('provisionYouTubeChannelWorkspace', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
  })

  it('creates a workspace with connected readiness and system actor when none exists', async () => {
    stageChannels([])
    const { provisionYouTubeChannelWorkspace } = await import('@/lib/youtube-studio/channel-provisioning')

    const result = await provisionYouTubeChannelWorkspace('org-1', 'acct-1', profile)

    expect(result).toEqual({ channelWorkspaceId: 'new-channel-id', created: true })
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      title: 'Acme Films',
      youtubeChannelId: 'UC123',
      youtubeHandle: '@acmefilms',
      status: 'setup',
      connectedAccountId: 'acct-1',
      deleted: false,
      createdByType: 'system',
      updatedByType: 'system',
      createdAt: 'SERVER_TS',
    }))
    const payload = mockAdd.mock.calls[0][0]
    expect(payload.publishingReadiness.accountStatus).toBe('connected')
    // Defaults must match the manual POST /channels route (sanitizer defaults)
    expect(payload.defaultPublishingPolicy).toEqual({
      allowedModes: ['manual_handoff'],
      defaultVisibility: 'private',
      privateFirstRequired: true,
      publicPublishRequiresAdmin: true,
      publicPublishRequiresClientConfirmation: false,
    })
    expect(payload.defaultApprovalPolicy.requireInternalPublishApproval).toBe(true)
  })

  it('updates the existing workspace (idempotent re-link) instead of creating a duplicate', async () => {
    stageChannels([{
      id: 'channel-1',
      data: {
        orgId: 'org-1',
        title: 'Old title',
        youtubeChannelId: 'UC123',
        status: 'active',
        deleted: false,
        publishingReadiness: { accountStatus: 'connected', readiness: 'private_upload_ready', apiProjectStatus: 'verified' },
      },
    }])
    const { provisionYouTubeChannelWorkspace } = await import('@/lib/youtube-studio/channel-provisioning')

    const result = await provisionYouTubeChannelWorkspace('org-1', 'acct-2', profile)

    expect(result).toEqual({ channelWorkspaceId: 'channel-1', created: false })
    expect(mockAdd).not.toHaveBeenCalled()
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      connectedAccountId: 'acct-2',
      title: 'Acme Films',
      youtubeHandle: '@acmefilms',
      updatedByType: 'system',
      updatedAt: 'SERVER_TS',
    }))
    const patch = mockUpdate.mock.calls[0][0]
    // Existing readiness fields survive; only account status is healed
    expect(patch.publishingReadiness.accountStatus).toBe('connected')
    expect(patch.publishingReadiness.readiness).toBe('private_upload_ready')
    expect(patch.publishingReadiness.apiProjectStatus).toBe('verified')
  })

  it('heals a needs_reauth workspace back to connected', async () => {
    stageChannels([{
      id: 'channel-1',
      data: {
        orgId: 'org-1',
        title: 'Acme Films',
        youtubeChannelId: 'UC123',
        status: 'active',
        deleted: false,
        publishingReadiness: { accountStatus: 'needs_reauth', readiness: 'not_ready', apiProjectStatus: 'unknown' },
      },
    }])
    const { provisionYouTubeChannelWorkspace } = await import('@/lib/youtube-studio/channel-provisioning')

    await provisionYouTubeChannelWorkspace('org-1', 'acct-1', profile)

    expect(mockUpdate.mock.calls[0][0].publishingReadiness.accountStatus).toBe('connected')
  })

  it('ignores soft-deleted workspaces and creates a fresh one', async () => {
    stageChannels([{
      id: 'channel-dead',
      data: { orgId: 'org-1', youtubeChannelId: 'UC123', deleted: true },
    }])
    const { provisionYouTubeChannelWorkspace } = await import('@/lib/youtube-studio/channel-provisioning')

    const result = await provisionYouTubeChannelWorkspace('org-1', 'acct-1', profile)

    expect(result.created).toBe(true)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('rejects a missing/unknown channel id', async () => {
    stageChannels([])
    const { provisionYouTubeChannelWorkspace } = await import('@/lib/youtube-studio/channel-provisioning')

    await expect(provisionYouTubeChannelWorkspace('org-1', 'acct-1', { ...profile, platformAccountId: 'unknown' }))
      .rejects.toThrow(/channel id/i)
  })

  it('safe wrapper isolates failures instead of throwing', async () => {
    mockCollection.mockImplementation(() => { throw new Error('firestore down') })
    const { safeProvisionYouTubeChannelWorkspace } = await import('@/lib/youtube-studio/channel-provisioning')

    const outcome = await safeProvisionYouTubeChannelWorkspace('org-1', 'acct-1', profile)

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.error).toContain('firestore down')
  })
})
