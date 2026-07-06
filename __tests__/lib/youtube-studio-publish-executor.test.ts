import type {
  YouTubeChannelWorkspace,
  YouTubePublishingPacket,
  YouTubeReleasePlan,
  YouTubeSourceAsset,
} from '@/lib/youtube-studio/types'

// ---- Firestore + provider mocks (mirrors __tests__/api/youtube-studio.test.ts conventions) ----

const mockCollection = jest.fn()
const mockBatch = jest.fn()
const mockResolveProvider = jest.fn()
const mockRefreshAccountToken = jest.fn()
const mockMarkAccountTokenExpired = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection, batch: mockBatch },
}))

jest.mock('@/lib/social/account-resolver', () => ({
  resolveProvider: (...args: unknown[]) => mockResolveProvider(...args),
  refreshAccountToken: (...args: unknown[]) => mockRefreshAccountToken(...args),
  markAccountTokenExpired: (...args: unknown[]) => mockMarkAccountTokenExpired(...args),
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => 'SERVER_TS',
    arrayUnion: (...items: unknown[]) => ({ __op: 'arrayUnion', items }),
    increment: (value: number) => ({ __op: 'increment', value }),
  },
}))

// ---- Fixtures ----

const pass = { status: 'pass' as const, message: 'ok' }

function channel(overrides: Partial<YouTubeChannelWorkspace> = {}): YouTubeChannelWorkspace {
  return {
    id: 'channel-1',
    orgId: 'org-1',
    title: 'Channel',
    status: 'active',
    connectedAccountId: 'account-1',
    publishingReadiness: {
      accountStatus: 'connected',
      apiProjectStatus: 'verified',
      readiness: 'scheduled_publish_ready',
      defaultUploadPrivacy: 'private',
      allowedModes: ['manual_handoff', 'private_api_upload', 'scheduled_api_publish'],
      quotaDailyLimit: 10000,
      quotaUnitsRemaining: 1600,
    },
    defaultApprovalPolicy: {
      requireInternalBriefApproval: false,
      requireClientBriefApproval: false,
      requireClientScriptApproval: false,
      requireClientDraftApproval: false,
      requireClientThumbnailApproval: false,
      requireClientPublishConfirmation: false,
      requireInternalPublishApproval: true,
    },
    defaultPublishingPolicy: {
      allowedModes: ['manual_handoff', 'private_api_upload', 'scheduled_api_publish'],
      defaultVisibility: 'private',
      privateFirstRequired: true,
      publicPublishRequiresAdmin: true,
      publicPublishRequiresClientConfirmation: false,
    },
    contentPillars: [],
    avoidTopics: [],
    aiDisclosureDefaults: { syntheticMediaLikely: false },
    deleted: false,
    ...overrides,
  }
}

function packet(overrides: Partial<YouTubePublishingPacket> = {}): YouTubePublishingPacket {
  return {
    id: 'packet-1',
    orgId: 'org-1',
    channelWorkspaceId: 'channel-1',
    videoProjectId: 'video-1',
    versionNumber: 1,
    status: 'approved',
    titleOptions: [{ text: 'Approved title', selected: true }],
    description: 'Approved description',
    tags: ['growth'],
    chapters: [],
    thumbnailAssetId: 'thumb-1',
    captionAssetId: 'caption-1',
    videoAssetId: 'asset-1',
    visibility: 'private',
    selfDeclaredMadeForKids: false,
    containsSyntheticMedia: false,
    checks: {
      rights: pass,
      aiDisclosure: pass,
      madeForKids: pass,
      metadata: pass,
      thumbnail: pass,
      captions: pass,
      approval: pass,
      connectedAccount: pass,
    },
    approvedBy: 'admin-1',
    approvedAt: 'date',
    approvedSnapshotHash: 'hash',
    approvalState: {
      internalStatus: 'approved',
      clientStatus: 'approved',
      changeRequestStatus: 'none',
      internalApproval: { status: 'approved', decidedBy: 'admin-1', decidedByType: 'user', decidedAt: 'date', snapshotHash: 'hash' },
      clientApproval: { status: 'approved', decidedBy: 'client-1', decidedByType: 'user', decidedAt: 'date', snapshotHash: 'hash' },
      publishLock: { locked: false, reasons: [] },
    },
    immutableAuditRecordIds: ['audit-1'],
    isLatestVersion: true,
    deleted: false,
    ...overrides,
  }
}

function releasePlan(overrides: Partial<YouTubeReleasePlan> = {}): YouTubeReleasePlan {
  return {
    id: 'release-1',
    orgId: 'org-1',
    channelWorkspaceId: 'channel-1',
    videoProjectId: 'video-1',
    publishingPacketId: 'packet-1',
    mode: 'private_api_upload',
    status: 'ready',
    uploadPrivacyStatus: 'private',
    targetVisibility: 'private',
    scheduledPublishAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    checks: {
      approvedPacket: pass,
      connectedAccount: pass,
      privateFirst: pass,
      clientConfirmation: { status: 'not_applicable', message: 'not needed' },
      scheduleWindow: { status: 'not_applicable', message: 'not scheduled' },
    },
    deleted: false,
    ...overrides,
  }
}

function sourceAsset(overrides: Partial<YouTubeSourceAsset> = {}): YouTubeSourceAsset {
  return {
    id: 'asset-1',
    orgId: 'org-1',
    channelWorkspaceId: 'channel-1',
    videoProjectId: 'video-1',
    title: 'Rendered video',
    assetType: 'rendered_video',
    status: 'ready',
    mediaFormat: 'horizontal',
    sourceUrl: 'https://cdn.example.com/video.mp4',
    rights: { status: 'cleared' },
    deleted: false,
    ...overrides,
  }
}

// ---- Firestore harness ----
// Each collection has a docs map keyed by id. doc(id).get() reads it; doc(id).set() records writes.

type DocFixture = { id: string; data: Record<string, unknown> }

type Harness = {
  writes: Array<{ collection: string; id: string; patch: Record<string, unknown> }>
  queries: Array<{ collection: string; wheres: Array<[string, string, unknown]> }>
}

function stageFirestore(
  collections: Record<string, DocFixture[]>,
): Harness {
  const harness: Harness = { writes: [], queries: [] }

  const makeDocRef = (collection: string, id: string) => {
    const fixture = (collections[collection] ?? []).find((d) => d.id === id)
    return {
      id,
      __collection: collection,
      get: async () => ({
        id,
        exists: Boolean(fixture),
        data: () => (fixture ? fixture.data : undefined),
        ref: makeDocRef(collection, id),
      }),
      set: (patch: Record<string, unknown>) => {
        harness.writes.push({ collection, id, patch })
        return Promise.resolve()
      },
    }
  }

  mockCollection.mockImplementation((collection: string) => {
    const buildQuery = (wheres: Array<[string, string, unknown]>) => ({
      where: (field: string, op: string, value: unknown) => buildQuery([...wheres, [field, op, value]]),
      get: async () => {
        harness.queries.push({ collection, wheres })
        let docs = collections[collection] ?? []
        for (const [field, op, value] of wheres) {
          docs = docs.filter((d) => {
            const actual = d.data[field]
            if (op === '==') return actual === value
            if (op === '<=') return typeof actual === 'string' && typeof value === 'string' && actual <= value
            return true
          })
        }
        return {
          docs: docs.map((d) => ({ id: d.id, data: () => d.data, ref: makeDocRef(collection, d.id) })),
        }
      },
    })
    return {
      ...buildQuery([]),
      doc: (id: string) => makeDocRef(collection, id),
    }
  })

  mockBatch.mockImplementation(() => {
    const ops: Array<{ collection: string; id: string; patch: Record<string, unknown> }> = []
    return {
      set: (ref: { id: string }, patch: Record<string, unknown>) => {
        // ref carries no collection; find via write recording at commit time is awkward, so
        // encode collection on the ref instead. We wrap makeDocRef to tag collection.
        const tagged = ref as unknown as { __collection?: string }
        ops.push({ collection: tagged.__collection ?? 'unknown', id: ref.id, patch })
      },
      commit: async () => {
        for (const op of ops) harness.writes.push(op)
      },
    }
  })

  return harness
}

const COLLECTIONS = {
  channels: 'youtube_channel_workspaces',
  videos: 'youtube_video_projects',
  packets: 'youtube_publishing_packets',
  releasePlans: 'youtube_release_plans',
  sourceAssets: 'youtube_source_assets',
}

function baseCollections(overrides: Partial<{
  release: YouTubeReleasePlan
  packet: YouTubePublishingPacket
  channel: YouTubeChannelWorkspace
  asset: YouTubeSourceAsset
}> = {}) {
  const rel = overrides.release ?? releasePlan()
  const pkt = overrides.packet ?? packet()
  const ch = overrides.channel ?? channel()
  const asset = overrides.asset ?? sourceAsset()
  return {
    [COLLECTIONS.releasePlans]: [{ id: rel.id!, data: { ...rel } as Record<string, unknown> }],
    [COLLECTIONS.packets]: [{ id: pkt.id!, data: { ...pkt } as Record<string, unknown> }],
    [COLLECTIONS.channels]: [{ id: ch.id!, data: { ...ch } as Record<string, unknown> }],
    [COLLECTIONS.videos]: [{ id: rel.videoProjectId, data: { id: rel.videoProjectId, orgId: rel.orgId, deleted: false } }],
    [COLLECTIONS.sourceAssets]: [{ id: asset.id!, data: { ...asset } as Record<string, unknown> }],
  }
}

function successProvider() {
  mockResolveProvider.mockResolvedValue({
    provider: { publishPost: jest.fn(async () => ({ platformPostId: 'yt-abc', platformPostUrl: 'https://youtu.be/yt-abc' })) },
    accountId: 'account-1',
  })
}

function findWrite(harness: Harness, collection: string, id: string) {
  return harness.writes.filter((w) => w.collection === collection && w.id === id)
}

describe('drainDueYouTubeReleasePlans', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('publishes a due, ready API release plan and marks the plan published', async () => {
    const harness = stageFirestore(baseCollections({
      release: releasePlan({ scheduledPublishAt: '2020-01-01T00:00:00.000Z' }),
    }))
    successProvider()
    const { drainDueYouTubeReleasePlans } = await import('@/lib/youtube-studio/publish-executor')

    const result = await drainDueYouTubeReleasePlans({ now: new Date('2026-01-01T00:00:00.000Z') })

    expect(result).toMatchObject({ due: 1, published: 1, blocked: 0, retried: 0, exhausted: 0, skipped: 0 })
    const relWrites = findWrite(harness, COLLECTIONS.releasePlans, 'release-1')
    const published = relWrites.find((w) => w.patch.externalYouTubeVideoId === 'yt-abc')
    expect(published).toBeTruthy()
  })

  it('does not process plans whose scheduledPublishAt is in the future', async () => {
    stageFirestore(baseCollections({
      release: releasePlan({ scheduledPublishAt: '2099-01-01T00:00:00.000Z' }),
    }))
    successProvider()
    const { drainDueYouTubeReleasePlans } = await import('@/lib/youtube-studio/publish-executor')

    const result = await drainDueYouTubeReleasePlans({ now: new Date('2026-01-01T00:00:00.000Z') })

    expect(result.due).toBe(0)
    expect(result.published).toBe(0)
    expect(mockResolveProvider).not.toHaveBeenCalled()
  })

  it('records an approval block reason without consuming a retry attempt', async () => {
    const harness = stageFirestore(baseCollections({
      release: releasePlan({ scheduledPublishAt: '2020-01-01T00:00:00.000Z' }),
      // packet not approved => readiness blocks, approval-style block
      packet: packet({ status: 'client_review' }),
    }))
    successProvider()
    const { drainDueYouTubeReleasePlans } = await import('@/lib/youtube-studio/publish-executor')

    const result = await drainDueYouTubeReleasePlans({ now: new Date('2026-01-01T00:00:00.000Z') })

    expect(result).toMatchObject({ due: 1, published: 0, blocked: 1, retried: 0, exhausted: 0 })
    expect(mockResolveProvider).not.toHaveBeenCalled()
    const relWrites = findWrite(harness, COLLECTIONS.releasePlans, 'release-1')
    const blockWrite = relWrites.find((w) => typeof w.patch.lastPublishError === 'string')
    expect(blockWrite).toBeTruthy()
    // no attempt increment on a block
    for (const w of relWrites) {
      expect(w.patch.publishAttemptCount).toBeUndefined()
    }
  })

  it('increments the attempt count and stays retryable on a transient failure', async () => {
    const harness = stageFirestore(baseCollections({
      release: releasePlan({ scheduledPublishAt: '2020-01-01T00:00:00.000Z', publishAttemptCount: 1 }),
    }))
    mockResolveProvider.mockResolvedValue({
      provider: { publishPost: jest.fn(async () => { throw new Error('503 upstream unavailable timeout') }) },
      accountId: 'account-1',
    })
    const { drainDueYouTubeReleasePlans } = await import('@/lib/youtube-studio/publish-executor')

    const result = await drainDueYouTubeReleasePlans({ now: new Date('2026-01-01T00:00:00.000Z') })

    expect(result).toMatchObject({ due: 1, published: 0, retried: 1, exhausted: 0 })
    const relWrites = findWrite(harness, COLLECTIONS.releasePlans, 'release-1')
    const failWrite = relWrites.find((w) => typeof w.patch.lastPublishError === 'string' && w.patch.publishAttemptCount)
    expect(failWrite).toBeTruthy()
    // not terminal
    const terminal = relWrites.find((w) => w.patch.publishExecutionStatus === 'failed')
    expect(terminal).toBeFalsy()
  })

  it('marks the plan terminally failed once attempts reach the cap of 3', async () => {
    const harness = stageFirestore(baseCollections({
      release: releasePlan({ scheduledPublishAt: '2020-01-01T00:00:00.000Z', publishAttemptCount: 2 }),
    }))
    mockResolveProvider.mockResolvedValue({
      provider: { publishPost: jest.fn(async () => { throw new Error('503 upstream unavailable timeout') }) },
      accountId: 'account-1',
    })
    const { drainDueYouTubeReleasePlans } = await import('@/lib/youtube-studio/publish-executor')

    const result = await drainDueYouTubeReleasePlans({ now: new Date('2026-01-01T00:00:00.000Z') })

    expect(result).toMatchObject({ due: 1, published: 0, retried: 0, exhausted: 1 })
    const relWrites = findWrite(harness, COLLECTIONS.releasePlans, 'release-1')
    const terminal = relWrites.find((w) => w.patch.publishExecutionStatus === 'failed')
    expect(terminal).toBeTruthy()
  })

  it('excludes already terminally-failed plans from the due query', async () => {
    stageFirestore(baseCollections({
      release: releasePlan({ scheduledPublishAt: '2020-01-01T00:00:00.000Z', publishExecutionStatus: 'failed', publishAttemptCount: 3 } as Partial<YouTubeReleasePlan>),
    }))
    successProvider()
    const { drainDueYouTubeReleasePlans } = await import('@/lib/youtube-studio/publish-executor')

    const result = await drainDueYouTubeReleasePlans({ now: new Date('2026-01-01T00:00:00.000Z') })

    // still returned by our in-memory query (it does not filter execution status in Firestore),
    // but the executor must skip it in-memory
    expect(result.published).toBe(0)
    expect(mockResolveProvider).not.toHaveBeenCalled()
  })

  it('isolates a failing plan so the rest of the batch still processes', async () => {
    const relBad = releasePlan({ id: 'release-bad', scheduledPublishAt: '2020-01-01T00:00:00.000Z' })
    const relGood = releasePlan({ id: 'release-good', videoProjectId: 'video-2', scheduledPublishAt: '2020-01-01T00:00:00.000Z' })
    const collections = {
      [COLLECTIONS.releasePlans]: [
        { id: 'release-bad', data: { ...relBad } as Record<string, unknown> },
        { id: 'release-good', data: { ...relGood } as Record<string, unknown> },
      ],
      [COLLECTIONS.packets]: [{ id: 'packet-1', data: { ...packet() } as Record<string, unknown> }],
      [COLLECTIONS.channels]: [{ id: 'channel-1', data: { ...channel() } as Record<string, unknown> }],
      [COLLECTIONS.videos]: [
        { id: 'video-1', data: { id: 'video-1', orgId: 'org-1', deleted: false } },
        { id: 'video-2', data: { id: 'video-2', orgId: 'org-1', deleted: false } },
      ],
      [COLLECTIONS.sourceAssets]: [{ id: 'asset-1', data: { ...sourceAsset() } as Record<string, unknown> }],
    }
    const harness = stageFirestore(collections)

    // First plan throws hard (not a publish error — an unexpected exception in provider resolution),
    // second plan publishes fine.
    mockResolveProvider
      .mockImplementationOnce(async () => { throw new Error('boom unexpected') })
      .mockImplementationOnce(async () => ({
        provider: { publishPost: jest.fn(async () => ({ platformPostId: 'yt-good', platformPostUrl: 'https://youtu.be/yt-good' })) },
        accountId: 'account-1',
      }))
    const { drainDueYouTubeReleasePlans } = await import('@/lib/youtube-studio/publish-executor')

    const result = await drainDueYouTubeReleasePlans({ now: new Date('2026-01-01T00:00:00.000Z') })

    expect(result.due).toBe(2)
    expect(result.published).toBe(1)
    const goodWrites = findWrite(harness, COLLECTIONS.releasePlans, 'release-good')
    expect(goodWrites.some((w) => w.patch.externalYouTubeVideoId === 'yt-good')).toBe(true)
  })

  it('respects the batch limit', async () => {
    const collections = {
      [COLLECTIONS.releasePlans]: [
        { id: 'r1', data: { ...releasePlan({ id: 'r1', scheduledPublishAt: '2020-01-01T00:00:00.000Z' }) } as Record<string, unknown> },
        { id: 'r2', data: { ...releasePlan({ id: 'r2', scheduledPublishAt: '2020-01-01T00:00:00.000Z' }) } as Record<string, unknown> },
      ],
      [COLLECTIONS.packets]: [{ id: 'packet-1', data: { ...packet() } as Record<string, unknown> }],
      [COLLECTIONS.channels]: [{ id: 'channel-1', data: { ...channel() } as Record<string, unknown> }],
      [COLLECTIONS.videos]: [{ id: 'video-1', data: { id: 'video-1', orgId: 'org-1', deleted: false } }],
      [COLLECTIONS.sourceAssets]: [{ id: 'asset-1', data: { ...sourceAsset() } as Record<string, unknown> }],
    }
    stageFirestore(collections)
    successProvider()
    const { drainDueYouTubeReleasePlans } = await import('@/lib/youtube-studio/publish-executor')

    const result = await drainDueYouTubeReleasePlans({ now: new Date('2026-01-01T00:00:00.000Z'), limit: 1 })

    expect(result.due).toBe(1)
    expect(result.published).toBe(1)
  })

  it('never picks up a plan another tick is still publishing (in-flight guard)', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z')
    stageFirestore({
      [COLLECTIONS.releasePlans]: [{
        id: 'r-inflight',
        data: {
          ...releasePlan({ id: 'r-inflight', scheduledPublishAt: '2020-01-01T00:00:00.000Z' }),
          publishExecutionStatus: 'publishing',
          // Attempt started 2 minutes ago — well inside the 30-min staleness window.
          lastPublishAttemptAt: new Date(now.getTime() - 2 * 60 * 1000).toISOString(),
        } as Record<string, unknown>,
      }],
      [COLLECTIONS.packets]: [{ id: 'packet-1', data: { ...packet() } as Record<string, unknown> }],
      [COLLECTIONS.channels]: [{ id: 'channel-1', data: { ...channel() } as Record<string, unknown> }],
      [COLLECTIONS.videos]: [{ id: 'video-1', data: { id: 'video-1', orgId: 'org-1', deleted: false } }],
      [COLLECTIONS.sourceAssets]: [{ id: 'asset-1', data: { ...sourceAsset() } as Record<string, unknown> }],
    })
    successProvider()
    const { drainDueYouTubeReleasePlans } = await import('@/lib/youtube-studio/publish-executor')

    const result = await drainDueYouTubeReleasePlans({ now })

    // Excluded from the batch entirely — no due count, no publish, no upload.
    expect(result.due).toBe(0)
    expect(result.published).toBe(0)
  })

  it('retries a plan wedged in publishing after the 30-minute staleness window (crashed tick)', async () => {
    const now = new Date('2026-01-01T01:00:00.000Z')
    stageFirestore({
      [COLLECTIONS.releasePlans]: [{
        id: 'r-stale',
        data: {
          ...releasePlan({ id: 'r-stale', scheduledPublishAt: '2020-01-01T00:00:00.000Z' }),
          publishExecutionStatus: 'publishing',
          lastPublishAttemptAt: new Date(now.getTime() - 45 * 60 * 1000).toISOString(),
        } as Record<string, unknown>,
      }],
      [COLLECTIONS.packets]: [{ id: 'packet-1', data: { ...packet() } as Record<string, unknown> }],
      [COLLECTIONS.channels]: [{ id: 'channel-1', data: { ...channel() } as Record<string, unknown> }],
      [COLLECTIONS.videos]: [{ id: 'video-1', data: { id: 'video-1', orgId: 'org-1', deleted: false } }],
      [COLLECTIONS.sourceAssets]: [{ id: 'asset-1', data: { ...sourceAsset() } as Record<string, unknown> }],
    })
    successProvider()
    const { drainDueYouTubeReleasePlans } = await import('@/lib/youtube-studio/publish-executor')

    const result = await drainDueYouTubeReleasePlans({ now })

    expect(result.due).toBe(1)
    expect(result.published).toBe(1)
  })
})
