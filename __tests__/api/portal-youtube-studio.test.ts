import { NextRequest } from 'next/server'

const mockCollection = jest.fn()
const mockWhere = jest.fn()
const mockOrgGet = jest.fn()
const mockChannelsGet = jest.fn()
const mockSeriesGet = jest.fn()
const mockVideosGet = jest.fn()
const mockPacketsGet = jest.fn()
const mockAnalyticsGet = jest.fn()
const mockAdd = jest.fn()
const mockDoc = jest.fn()
const mockDocGet = jest.fn()
const mockDocSet = jest.fn()
const mockWithPortalAuthAndRole = jest.fn()

type MockPortalRoleHandler = (
  req: NextRequest,
  uid: string,
  orgId: string,
  role: string,
) => Promise<Response> | Response

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/auth/portal-middleware', () => ({
  withPortalAuthAndRole: (minRole: string, handler: MockPortalRoleHandler) => {
    mockWithPortalAuthAndRole(minRole)
    return (req: NextRequest) =>
      handler(req, 'client-1', req.nextUrl.searchParams.get('orgId') || 'org-1', 'member')
  },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TS' },
}))

type FirestoreDoc = {
  id: string
  data: Record<string, unknown>
  set?: jest.Mock
}

type FirestoreStage = {
  settings?: Record<string, unknown>
  channels?: FirestoreDoc[]
  series?: FirestoreDoc[]
  videos?: FirestoreDoc[]
  packets?: FirestoreDoc[]
  analytics?: FirestoreDoc[]
}

function docsById(docs: FirestoreDoc[] = []) {
  return Object.fromEntries(docs.map((doc) => [doc.id, doc]))
}

function findUndefinedPaths(value: unknown, path = 'payload'): string[] {
  if (value === undefined) return [path]
  if (Array.isArray(value)) return value.flatMap((item, index) => findUndefinedPaths(item, `${path}[${index}]`))
  if (!value || typeof value !== 'object') return []

  return Object.entries(value).flatMap(([key, entry]) => findUndefinedPaths(entry, `${path}.${key}`))
}

function defaultChecks() {
  return {
    rights: { status: 'pass', message: 'Rights cleared', checkedBy: 'admin-1', checkedAt: { seconds: 1 } },
    aiDisclosure: { status: 'warning', message: 'Review disclosure', checkedBy: 'agent-1' },
    madeForKids: { status: 'pass', message: 'Not made for kids' },
    metadata: { status: 'pass', message: 'Metadata complete' },
    thumbnail: { status: 'pass', message: 'Thumbnail approved' },
    captions: { status: 'pass', message: 'Captions ready' },
    approval: { status: 'pass', message: 'Approved', checkedByType: 'system' },
    connectedAccount: {
      status: 'warning',
      message: 'Manual handoff required',
      checkedBy: 'admin-2',
      checkedByType: 'user',
    },
  }
}

function defaultStage(): Required<FirestoreStage> {
  return {
    settings: {},
    channels: [
      {
        id: 'channel-1',
        data: {
          orgId: 'org-1',
          title: 'Acme Channel',
          status: 'active',
          contentPillars: [
            'Growth',
            { label: 'Internal pillar', policyNotes: 'operator-only channel guidance' },
            '',
            'Retention',
          ],
          visibility: { showInClientPortal: true },
          publishingReadiness: {
            accountStatus: 'connected',
            apiProjectStatus: 'verified',
            readiness: 'scheduled_publish_ready',
            defaultUploadPrivacy: 'private',
            allowedModes: ['manual_handoff', 'private_api_upload', 'scheduled_api_publish'],
            notes: 'operator-only publishing readiness',
          },
          deleted: false,
          connectedAccountId: 'secret-account',
          strategyDocumentId: 'strategy-doc-secret',
          defaultApprovalPolicy: { requireInternalBriefApproval: true },
          defaultPublishingPolicy: { allowedModes: ['scheduled_api_publish'] },
          internalNotes: 'hide channel notes',
          createdBy: 'admin-1',
          updatedBy: 'admin-2',
        },
      },
      {
        id: 'channel-hidden',
        data: {
          orgId: 'org-1',
          title: 'Hidden Channel',
          status: 'active',
          visibility: { showInClientPortal: false },
          deleted: false,
          connectedAccountId: 'hidden-secret',
        },
      },
    ],
    series: [
      {
        id: 'series-1',
        data: {
          orgId: 'org-1',
          channelWorkspaceId: 'channel-1',
          name: 'Client Series',
          objective: 'Build trust with buyer education',
          audience: 'Client stakeholders',
          format: 'long_form',
          cadence: 'weekly',
          targetDurationSeconds: 600,
          episodeTemplate: {
            hook: 'Open with the business outcome',
            sections: [
              {
                label: 'Problem',
                targetSeconds: 90,
                notes: 'Frame the client pain',
                internalPrompt: 'Do not expose prompt',
              },
              null,
              'not-a-section',
              {
                label: { text: 'Internal section', policyNotes: 'operator-only section policy' },
                targetSeconds: 45,
                notes: { internalPrompt: 'secret section notes' },
                internalPrompt: 'Do not expose malformed section prompt',
              },
            ],
            outro: 'Close with next steps',
            internalTemplateId: 'template-secret',
          },
          styleGuide: {
            visualNotes: 'Bright office footage',
            thumbnailNotes: 'Use founder portrait',
            captionNotes: 'Sentence case',
            introOutroRules: 'Keep intro under 5 seconds',
            internalStyleToken: 'style-secret',
          },
          season: 'Season 1',
          status: 'active',
          internalNotes: 'hide series notes',
          createdAt: { seconds: 10 },
          updatedAt: { seconds: 11 },
          createdBy: 'admin-1',
          createdByType: 'user',
          updatedBy: 'admin-2',
          updatedByType: 'user',
          deleted: false,
        },
      },
      {
        id: 'series-hidden-channel',
        data: {
          orgId: 'org-1',
          channelWorkspaceId: 'channel-hidden',
          name: 'Hidden Channel Series',
          status: 'active',
          deleted: false,
        },
      },
    ],
    videos: [
      {
        id: 'video-1',
        data: {
          orgId: 'org-1',
          channelWorkspaceId: 'channel-1',
          seriesId: 'series-1',
          title: 'Client Draft',
          objective: 'Grow trust',
          status: 'client_review',
          videoType: 'long_form',
          visibility: { showInClientPortal: true, showPublishingPacket: true },
          source: {
            intakeType: 'research',
            researchItemId: 'research-secret',
            campaignId: 'campaign-secret',
            projectId: 'project-secret',
            sourceUrl: 'https://internal.example/source',
            transcriptAssetId: 'transcript-secret',
          },
          linked: {
            projectId: 'linked-project-secret',
            taskIds: ['task-secret'],
            documentIds: ['document-secret'],
            campaignId: 'linked-campaign-secret',
            socialPostIds: ['social-secret'],
          },
          approvalPolicy: { requireInternalPublishApproval: true },
          publishPacketId: 'packet-secret',
          youtubeVideoId: 'youtube-secret',
          scheduledAt: { seconds: 3 },
          publishedAt: { seconds: 4 },
          internalNotes: 'hide video notes',
          clientReview: { status: 'requested', notes: 'Client-facing note', decidedBy: 'client-secret' },
          createdBy: 'admin-1',
          updatedBy: 'admin-2',
          deleted: false,
        },
      },
      {
        id: 'video-hidden',
        data: {
          orgId: 'org-1',
          channelWorkspaceId: 'channel-1',
          title: 'Hidden Video',
          objective: 'Internal only',
          status: 'client_review',
          videoType: 'long_form',
          visibility: { showInClientPortal: false, showPublishingPacket: true },
          internalNotes: 'hide hidden notes',
          deleted: false,
        },
      },
      {
        id: 'video-hidden-channel',
        data: {
          orgId: 'org-1',
          channelWorkspaceId: 'channel-hidden',
          title: 'Hidden Channel Video',
          objective: 'Internal channel',
          status: 'client_review',
          videoType: 'long_form',
          visibility: { showInClientPortal: true, showPublishingPacket: true },
          deleted: false,
        },
      },
    ],
    packets: [
      {
        id: 'packet-1',
        data: {
          orgId: 'org-1',
          channelWorkspaceId: 'channel-1',
          videoProjectId: 'video-1',
          versionNumber: 1,
          supersedesPacketId: 'packet-internal-parent',
          status: 'client_review',
          titleOptions: [
            {
              text: 'Launch plan',
              rationale: 'Client-safe framing',
              selected: true,
              internalPrompt: 'secret title prompt',
              scoringAudit: { score: 0.92 },
              sourceAssetId: 'title-source-secret',
              policyNotes: 'operator-only title policy note',
            },
          ],
          tags: [
            'growth',
            { text: 'internal', internalPrompt: 'secret tag prompt' },
            '',
            'retention',
          ],
          chapters: [
            {
              startSeconds: 0,
              title: 'Intro',
              internalPrompt: 'secret chapter prompt',
              scoringAudit: { score: 0.88 },
              sourceAssetId: 'chapter-source-secret',
              policyNotes: 'operator-only chapter policy note',
            },
            {
              startSeconds: -1,
              title: 'Legacy negative start',
              internalPrompt: 'negative chapter should not leak',
            },
          ],
          thumbnailAssetId: 'thumbnail-secret',
          captionAssetId: 'caption-secret',
          videoAssetId: 'video-asset-secret',
          visibility: 'private',
          checks: defaultChecks(),
          approvedBy: 'admin-1',
          approvedAt: { seconds: 2 },
          approvedSnapshotHash: 'secret-hash',
          deleted: false,
        },
      },
      {
        id: 'packet-hidden-video',
        data: {
          orgId: 'org-1',
          channelWorkspaceId: 'channel-1',
          videoProjectId: 'video-hidden',
          versionNumber: 1,
          status: 'client_review',
          titleOptions: [{ text: 'Hidden' }],
          tags: [],
          chapters: [],
          visibility: 'private',
          checks: defaultChecks(),
          deleted: false,
        },
      },
    ],
    analytics: [
      {
        id: 'snapshot-1',
        data: {
          orgId: 'org-1',
          channelWorkspaceId: 'channel-1',
          videoProjectId: 'video-1',
          seriesId: 'series-1',
          periodStart: '2026-06-01',
          periodEnd: '2026-06-07',
          source: 'youtube_analytics_api',
          sourceFreshness: 'delayed',
          metrics: {
            views: 1000,
            watchTimeMinutes: 240,
            averageViewPercentage: 44,
            impressionsCtr: 3.2,
            secretMetric: 999,
          },
          dimensions: { country: 'ZA', internalSegment: 'operator-only dimension' },
          clientSummary: 'Views are building but the hook still needs work.',
          internalNotes: 'Operator-only analytics notes',
          recommendations: [
            {
              type: 'thumbnail_test',
              summary: 'Test a clearer before/after thumbnail.',
              confidence: 'medium',
              status: 'suggested',
              taskId: 'task-secret',
              notes: 'internal recommendation note',
            },
          ],
          visibility: { showInClientPortal: true },
          importedBy: 'admin-1',
          importedAt: { seconds: 12 },
          deleted: false,
        },
      },
      {
        id: 'snapshot-hidden',
        data: {
          orgId: 'org-1',
          channelWorkspaceId: 'channel-1',
          videoProjectId: 'video-1',
          periodStart: '2026-06-01',
          periodEnd: '2026-06-07',
          source: 'manual_import',
          sourceFreshness: 'partial',
          metrics: { views: 99 },
          recommendations: [],
          visibility: { showInClientPortal: false },
          deleted: false,
        },
      },
    ],
  }
}

function stageFirestore(overrides: FirestoreStage = {}) {
  const staged = {
    ...defaultStage(),
    ...overrides,
  }
  const channelDocs = docsById(staged.channels)
  const videoDocs = docsById(staged.videos)
  const seriesDocs = docsById(staged.series)
  const packetDocs = docsById(staged.packets)
  const analyticsDocs = docsById(staged.analytics)

  mockOrgGet.mockResolvedValue({
    exists: true,
    data: () => ({ settings: staged.settings }),
  })
  mockChannelsGet.mockResolvedValue({
    docs: staged.channels.map((doc) => ({ id: doc.id, data: () => doc.data })),
  })
  mockSeriesGet.mockResolvedValue({
    docs: staged.series.map((doc) => ({ id: doc.id, data: () => doc.data })),
  })
  mockVideosGet.mockResolvedValue({
    docs: staged.videos.map((doc) => ({ id: doc.id, data: () => doc.data })),
  })
  mockPacketsGet.mockResolvedValue({
    docs: staged.packets.map((doc) => ({ id: doc.id, data: () => doc.data })),
  })
  mockAnalyticsGet.mockResolvedValue({
    docs: staged.analytics.map((doc) => ({ id: doc.id, data: () => doc.data })),
  })
  mockAdd.mockResolvedValue({ id: 'request-1' })
  mockDocSet.mockResolvedValue(undefined)

  mockCollection.mockImplementation((name: string) => {
    if (name === 'organizations') return { doc: () => ({ get: mockOrgGet }) }

    const collections = {
      youtube_channel_workspaces: { docs: channelDocs, queryGet: mockChannelsGet },
      youtube_series: { docs: seriesDocs, queryGet: mockSeriesGet },
      youtube_video_projects: { docs: videoDocs, queryGet: mockVideosGet },
      youtube_publishing_packets: { docs: packetDocs, queryGet: mockPacketsGet },
      youtube_analytics_snapshots: { docs: analyticsDocs, queryGet: mockAnalyticsGet },
    }
    const collection = collections[name as keyof typeof collections]
    if (!collection) throw new Error(`Unexpected collection: ${name}`)

    return {
      where: (...args: unknown[]) => {
        mockWhere(name, ...args)
        return { get: collection.queryGet }
      },
      add: mockAdd,
      doc: (id: string) => {
        mockDoc(name, id)
        const record = collection.docs[id]
        const set = record?.set ?? mockDocSet
        const ref = { id, set }
        return {
          id,
          ref,
          set,
          get: async () => {
            mockDocGet(name, id)
            if (!record) return { exists: false, id, data: () => undefined, ref }
            return { exists: true, id: record.id, data: () => record.data, ref }
          },
        }
      },
    }
  })
}

describe('portal youtube studio API', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
    stageFirestore()
  })

  it('returns client-safe channel, video, and packet records when enabled by default', async () => {
    const { GET } = await import('@/app/api/v1/portal/youtube-studio/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/portal/youtube-studio'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockWithPortalAuthAndRole).toHaveBeenCalledWith('viewer')
    expect(body.data.channels.map((channel: { id: string }) => channel.id)).toEqual(['channel-1'])
    expect(body.data.series.map((series: { id: string }) => series.id)).toEqual(['series-1'])
    expect(body.data.videos.map((video: { id: string }) => video.id)).toEqual(['video-1'])
    expect(body.data.packets.map((packet: { id: string }) => packet.id)).toEqual(['packet-1'])
    expect(body.data.analytics.map((snapshot: { id: string }) => snapshot.id)).toEqual(['snapshot-1'])
    const channel = body.data.channels[0]
    const series = body.data.series[0]
    const video = body.data.videos[0]
    const packet = body.data.packets[0]
    const snapshot = body.data.analytics[0]
    expect(channel).not.toHaveProperty('connectedAccountId')
    expect(channel).not.toHaveProperty('internalNotes')
    expect(channel).not.toHaveProperty('createdBy')
    expect(channel).not.toHaveProperty('updatedBy')
    expect(channel).not.toHaveProperty('strategyDocumentId')
    expect(channel).not.toHaveProperty('defaultApprovalPolicy')
    expect(channel).not.toHaveProperty('defaultPublishingPolicy')
    expect(channel).not.toHaveProperty('publishingReadiness')
    expect(channel.contentPillars).toEqual(['Growth', 'Retention'])
    expect(JSON.stringify(channel)).not.toContain('policyNotes')
    expect(Object.keys(series).sort()).toEqual([
      'audience',
      'cadence',
      'channelWorkspaceId',
      'episodeTemplate',
      'format',
      'id',
      'name',
      'objective',
      'orgId',
      'season',
      'status',
      'styleGuide',
      'targetDurationSeconds',
    ].sort())
    expect(series).toMatchObject({
      id: 'series-1',
      orgId: 'org-1',
      channelWorkspaceId: 'channel-1',
      name: 'Client Series',
      objective: 'Build trust with buyer education',
      audience: 'Client stakeholders',
      format: 'long_form',
      cadence: 'weekly',
      targetDurationSeconds: 600,
      episodeTemplate: {
        hook: 'Open with the business outcome',
        sections: [{ label: 'Problem', targetSeconds: 90, notes: 'Frame the client pain' }],
        outro: 'Close with next steps',
      },
      styleGuide: {
        visualNotes: 'Bright office footage',
        thumbnailNotes: 'Use founder portrait',
        captionNotes: 'Sentence case',
        introOutroRules: 'Keep intro under 5 seconds',
      },
      season: 'Season 1',
      status: 'active',
    })
    expect(series).not.toHaveProperty('internalNotes')
    expect(series).not.toHaveProperty('createdAt')
    expect(series).not.toHaveProperty('updatedAt')
    expect(series).not.toHaveProperty('createdBy')
    expect(series).not.toHaveProperty('createdByType')
    expect(series).not.toHaveProperty('updatedBy')
    expect(series).not.toHaveProperty('updatedByType')
    expect(series).not.toHaveProperty('deleted')
    expect(series.episodeTemplate).not.toHaveProperty('internalTemplateId')
    expect(series.episodeTemplate.sections[0]).not.toHaveProperty('internalPrompt')
    expect(JSON.stringify(series)).not.toContain('operator-only section policy')
    expect(JSON.stringify(series)).not.toContain('secret section notes')
    expect(series.styleGuide).not.toHaveProperty('internalStyleToken')
    expect(video).not.toHaveProperty('internalNotes')
    expect(video).not.toHaveProperty('createdBy')
    expect(video).not.toHaveProperty('updatedBy')
    expect(video).not.toHaveProperty('approvalPolicy')
    expect(video).not.toHaveProperty('linked')
    expect(video).not.toHaveProperty('publishPacketId')
    expect(video).not.toHaveProperty('youtubeVideoId')
    expect(video).not.toHaveProperty('scheduledAt')
    expect(video).not.toHaveProperty('publishedAt')
    expect(video.source).toEqual({ intakeType: 'research' })
    expect(video.source).not.toHaveProperty('researchItemId')
    expect(video.source).not.toHaveProperty('campaignId')
    expect(video.source).not.toHaveProperty('projectId')
    expect(video.source).not.toHaveProperty('sourceUrl')
    expect(video.source).not.toHaveProperty('transcriptAssetId')
    expect(video.clientReview).not.toHaveProperty('decidedBy')
    expect(packet).not.toHaveProperty('supersedesPacketId')
    expect(packet).not.toHaveProperty('thumbnailAssetId')
    expect(packet).not.toHaveProperty('captionAssetId')
    expect(packet).not.toHaveProperty('videoAssetId')
    expect(packet).not.toHaveProperty('approvedBy')
    expect(packet).not.toHaveProperty('approvedAt')
    expect(packet).not.toHaveProperty('approvedSnapshotHash')
    expect(packet.checks).not.toHaveProperty('connectedAccount')
    expect(packet.checks.rights).not.toHaveProperty('checkedBy')
    expect(packet.checks.rights).not.toHaveProperty('checkedByType')
    expect(packet.checks.aiDisclosure).not.toHaveProperty('checkedBy')
    expect(packet.titleOptions).toEqual([
      { text: 'Launch plan', rationale: 'Client-safe framing', selected: true },
    ])
    expect(packet.titleOptions[0]).not.toHaveProperty('internalPrompt')
    expect(packet.titleOptions[0]).not.toHaveProperty('scoringAudit')
    expect(packet.titleOptions[0]).not.toHaveProperty('sourceAssetId')
    expect(packet.titleOptions[0]).not.toHaveProperty('policyNotes')
    expect(packet.tags).toEqual(['growth', 'retention'])
    expect(JSON.stringify(packet)).not.toContain('secret tag prompt')
    expect(packet.chapters).toEqual([{ startSeconds: 0, title: 'Intro' }])
    expect(packet.chapters[0]).not.toHaveProperty('internalPrompt')
    expect(packet.chapters[0]).not.toHaveProperty('scoringAudit')
    expect(packet.chapters[0]).not.toHaveProperty('sourceAssetId')
    expect(packet.chapters[0]).not.toHaveProperty('policyNotes')
    expect(snapshot).toMatchObject({
      id: 'snapshot-1',
      orgId: 'org-1',
      channelWorkspaceId: 'channel-1',
      videoProjectId: 'video-1',
      seriesId: 'series-1',
      periodStart: '2026-06-01',
      periodEnd: '2026-06-07',
      source: 'youtube_analytics_api',
      sourceFreshness: 'delayed',
      metrics: {
        views: 1000,
        watchTimeMinutes: 240,
        averageViewPercentage: 44,
        impressionsCtr: 3.2,
      },
      clientSummary: 'Views are building but the hook still needs work.',
      recommendations: [{
        type: 'thumbnail_test',
        summary: 'Test a clearer before/after thumbnail.',
        confidence: 'medium',
        status: 'suggested',
      }],
    })
    expect(snapshot).not.toHaveProperty('dimensions')
    expect(snapshot).not.toHaveProperty('internalNotes')
    expect(snapshot).not.toHaveProperty('importedBy')
    expect(snapshot).not.toHaveProperty('importedAt')
    expect(snapshot.recommendations[0]).not.toHaveProperty('taskId')
    expect(snapshot.recommendations[0]).not.toHaveProperty('notes')
    expect(JSON.stringify(snapshot)).not.toContain('operator-only')
    expect(JSON.stringify(snapshot)).not.toContain('task-secret')
  })

  it('does not crash or leak when visible Firestore scalar values are malformed', async () => {
    stageFirestore({
      channels: [
        {
          id: 'channel-alpha',
          data: {
            orgId: 'org-1',
            title: 'Alpha Channel',
            status: 'active',
            contentPillars: [],
            visibility: { showInClientPortal: true },
            deleted: false,
          },
        },
        {
          id: 'channel-malformed',
          data: {
            orgId: 'org-1',
            title: { text: 'Operator-only channel title', policyNotes: 'secret channel policy' },
            status: { raw: 'active' },
            contentPillars: [' Growth ', { internalPrompt: 'secret pillar prompt' }],
            audienceNotes: { internalPrompt: 'secret audience note' },
            aiDisclosureDefaults: {
              syntheticMediaLikely: { raw: true },
              notes: { internalPrompt: 'secret disclosure note' },
            },
            visibility: { showInClientPortal: true, showAnalytics: { raw: true } },
            deleted: false,
          },
        },
      ],
      series: [],
      videos: [
        {
          id: 'video-alpha',
          data: {
            orgId: 'org-1',
            channelWorkspaceId: 'channel-alpha',
            title: 'Alpha Video',
            objective: 'Visible',
            status: 'client_review',
            videoType: 'long_form',
            visibility: { showInClientPortal: true, showPublishingPacket: false },
            deleted: false,
          },
        },
        {
          id: 'video-malformed',
          data: {
            orgId: 'org-1',
            channelWorkspaceId: 'channel-malformed',
            title: { text: 'Operator-only video title', policyNotes: 'secret video policy' },
            objective: { internalPrompt: 'secret objective prompt' },
            status: { raw: 'client_review' },
            videoType: { raw: 'long_form' },
            source: { intakeType: { raw: 'research' }, researchItemId: 'research-secret' },
            visibility: { showInClientPortal: true, showPublishingPacket: true },
            clientReview: { status: 'requested', notes: { internalPrompt: 'secret review note' } },
            deleted: false,
          },
        },
      ],
      packets: [
        {
          id: 'packet-malformed',
          data: {
            orgId: 'org-1',
            channelWorkspaceId: 'channel-malformed',
            videoProjectId: 'video-malformed',
            versionNumber: { raw: 2 },
            status: { raw: 'client_review' },
            titleOptions: [{ text: ' Client-safe title ', rationale: { internalPrompt: 'secret rationale' } }],
            description: { internalPrompt: 'secret description' },
            tags: [' growth ', { internalPrompt: 'secret tag' }],
            chapters: [{ startSeconds: 0, title: ' Intro ', internalPrompt: 'secret chapter prompt' }],
            visibility: { raw: 'public' },
            selfDeclaredMadeForKids: { raw: false },
            containsSyntheticMedia: true,
            aiDisclosureNotes: { internalPrompt: 'secret ai disclosure note' },
            checks: {
              rights: {
                status: { raw: 'pass' },
                message: { internalPrompt: 'secret gate message' },
                checkedBy: 'admin-secret',
              },
              aiDisclosure: { status: 'warning', message: ' Review disclosure ', checkedBy: 'agent-secret' },
              connectedAccount: { status: 'warning', message: 'secret connected account' },
            },
            deleted: false,
          },
        },
      ],
    })

    const { GET } = await import('@/app/api/v1/portal/youtube-studio/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/portal/youtube-studio'))
    const body = await res.json()

    expect(res.status).toBe(200)
    const channel = body.data.channels.find((item: { id: string }) => item.id === 'channel-malformed')
    const video = body.data.videos.find((item: { id: string }) => item.id === 'video-malformed')
    const packet = body.data.packets.find((item: { id: string }) => item.id === 'packet-malformed')

    expect(channel).toMatchObject({
      id: 'channel-malformed',
      title: 'Untitled YouTube channel',
      status: 'setup',
      contentPillars: ['Growth'],
      aiDisclosureDefaults: { syntheticMediaLikely: false },
    })
    expect(channel).not.toHaveProperty('audienceNotes')
    expect(channel.visibility).not.toHaveProperty('showAnalytics')
    expect(video).toMatchObject({
      id: 'video-malformed',
      title: 'Untitled video',
      objective: '',
      videoType: 'long_form',
      status: 'intake',
      source: { intakeType: 'manual' },
      clientReview: { status: 'requested' },
    })
    expect(video.clientReview).not.toHaveProperty('notes')
    expect(packet).toMatchObject({
      id: 'packet-malformed',
      versionNumber: 1,
      status: 'draft',
      titleOptions: [{ text: 'Client-safe title' }],
      tags: ['growth'],
      chapters: [{ startSeconds: 0, title: 'Intro' }],
      visibility: 'private',
      containsSyntheticMedia: true,
      checks: {
        rights: { status: 'not_applicable' },
        aiDisclosure: { status: 'warning', message: 'Review disclosure' },
      },
    })
    expect(packet).not.toHaveProperty('description')
    expect(packet).not.toHaveProperty('selfDeclaredMadeForKids')
    expect(packet).not.toHaveProperty('aiDisclosureNotes')
    expect(packet.checks).not.toHaveProperty('connectedAccount')
    expect(packet.checks.rights).not.toHaveProperty('message')
    expect(JSON.stringify(body)).not.toContain('secret')
    expect(JSON.stringify(body)).not.toContain('Operator-only')
  })

  it('hides client-visible analytics when the channel analytics toggle is off', async () => {
    const defaults = defaultStage()
    stageFirestore({
      channels: defaults.channels.map((channel) =>
        channel.id === 'channel-1'
          ? {
              ...channel,
              data: {
                ...channel.data,
                visibility: { showInClientPortal: true, showAnalytics: false },
              },
            }
          : channel
      ),
    })

    const { GET } = await import('@/app/api/v1/portal/youtube-studio/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/portal/youtube-studio'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.channels.map((channel: { id: string }) => channel.id)).toEqual(['channel-1'])
    expect(body.data.analytics).toEqual([])
  })

  it('blocks access when the org disables YouTube Studio before querying YouTube collections', async () => {
    stageFirestore({ settings: { portalModules: { youtubeStudio: false } } })

    const { GET } = await import('@/app/api/v1/portal/youtube-studio/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/portal/youtube-studio'))
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body).toMatchObject({ success: false, moduleDisabled: true, module: 'youtubeStudio' })
    expect(mockChannelsGet).not.toHaveBeenCalled()
    expect(mockSeriesGet).not.toHaveBeenCalled()
    expect(mockVideosGet).not.toHaveBeenCalled()
    expect(mockPacketsGet).not.toHaveBeenCalled()
    expect(mockAnalyticsGet).not.toHaveBeenCalled()
  })

  it('lets a portal member submit a sanitized client video request', async () => {
    const { POST } = await import('@/app/api/v1/portal/youtube-studio/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/portal/youtube-studio', {
      method: 'POST',
      body: JSON.stringify({
        orgId: 'org-2',
        channelWorkspaceId: 'channel-1',
        title: '  New FAQ video  ',
        objective: ' Answer buyers ',
        sourceUrl: ' https://youtu.be/demo ',
        status: 'live',
        internalNotes: 'do not write',
        connectedAccountId: 'secret',
        visibility: { showInClientPortal: false },
        clientReview: { status: 'approved' },
      }),
    }))
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(mockWithPortalAuthAndRole).toHaveBeenCalledWith('member')
    expect(body.data.id).toBe('request-1')
    expect(mockAdd).toHaveBeenCalledTimes(1)
    const write = mockAdd.mock.calls[0][0]
    expect(write).toMatchObject({
      orgId: 'org-1',
      channelWorkspaceId: 'channel-1',
      title: 'New FAQ video',
      objective: 'Answer buyers',
      source: { intakeType: 'client_request', sourceUrl: 'https://youtu.be/demo' },
      status: 'intake',
      visibility: { showInClientPortal: true },
      clientReview: { status: 'not_requested' },
      createdBy: 'client-1',
      createdByType: 'user',
      updatedBy: 'client-1',
      updatedByType: 'user',
      createdAt: 'SERVER_TS',
      updatedAt: 'SERVER_TS',
      deleted: false,
    })
    expect(write).not.toHaveProperty('internalNotes')
    expect(write).not.toHaveProperty('connectedAccountId')
    expect(findUndefinedPaths(write)).toEqual([])
  })

  it.each([
    [
      'hidden',
      [{ id: 'channel-1', data: { orgId: 'org-1', title: 'Hidden', visibility: { showInClientPortal: false }, deleted: false } }],
    ],
    [
      'cross-org',
      [{ id: 'channel-1', data: { orgId: 'org-2', title: 'Other org', visibility: { showInClientPortal: true }, deleted: false } }],
    ],
  ])('rejects %s channel video requests from portal users', async (_label, channels) => {
    stageFirestore({ channels })

    const { POST } = await import('@/app/api/v1/portal/youtube-studio/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/portal/youtube-studio', {
      method: 'POST',
      body: JSON.stringify({ channelWorkspaceId: 'channel-1', title: 'New FAQ video' }),
    }))
    const body = await res.json()

    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(body.error).toMatch(/channel/i)
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it.each([
    ['approved', 'internal_review'],
    ['changes_requested', 'changes_requested'],
  ])('lets a portal member write a %s client review decision on a visible video', async (decision, status) => {
    const { PUT } = await import('@/app/api/v1/portal/youtube-studio/route')
    const res = await PUT(new NextRequest('http://localhost/api/v1/portal/youtube-studio', {
      method: 'PUT',
      body: JSON.stringify({
        id: 'video-1',
        decision,
        notes: '  Please shorten the intro.  ',
        status: 'live',
        orgId: 'org-2',
        internalNotes: 'do not write',
      }),
    }))

    expect(res.status).toBe(200)
    expect(mockWithPortalAuthAndRole).toHaveBeenCalledWith('member')
    expect(mockDocSet).toHaveBeenCalledTimes(1)
    const [write, options] = mockDocSet.mock.calls[0]
    expect(write).toMatchObject({
      status,
      clientReview: {
        status: decision,
        notes: 'Please shorten the intro.',
        decidedBy: 'client-1',
        decidedAt: 'SERVER_TS',
      },
      updatedBy: 'client-1',
      updatedByType: 'user',
      updatedAt: 'SERVER_TS',
    })
    expect(options).toEqual({ merge: true })
    expect(write).not.toHaveProperty('internalNotes')
    expect(findUndefinedPaths(write)).toEqual([])
  })

  it.each([
    ['approved', 'approved', 'pass'],
    ['changes_requested', 'draft', 'warning'],
    ['rejected', 'blocked', 'block'],
  ])('lets a portal member write a %s decision on a visible publishing packet', async (decision, status, approvalStatus) => {
    const { PUT } = await import('@/app/api/v1/portal/youtube-studio/route')
    const res = await PUT(new NextRequest('http://localhost/api/v1/portal/youtube-studio', {
      method: 'PUT',
      body: JSON.stringify({
        packetId: 'packet-1',
        decision,
        notes: '  Please tighten the title.  ',
        status: 'published',
        approvedBy: 'client-supplied',
        approvedSnapshotHash: 'client-supplied-hash',
      }),
    }))

    expect(res.status).toBe(200)
    expect(mockWithPortalAuthAndRole).toHaveBeenCalledWith('member')
    expect(mockDocSet).toHaveBeenCalledTimes(1)
    const [write, options] = mockDocSet.mock.calls[0]
    expect(write).toMatchObject({
      status,
      checks: {
        approval: {
          status: approvalStatus,
          checkedBy: 'client-1',
          checkedByType: 'user',
          checkedAt: 'SERVER_TS',
        },
      },
      updatedBy: 'client-1',
      updatedByType: 'user',
      updatedAt: 'SERVER_TS',
    })
    if (decision === 'approved') {
      expect(write.approvedBy).toBe('client-1')
      expect(write.approvedAt).toBe('SERVER_TS')
      expect(write.approvedSnapshotHash).toEqual(expect.any(String))
      expect(write.approvedSnapshotHash).not.toBe('client-supplied-hash')
    } else {
      expect(write).not.toHaveProperty('approvedBy')
      expect(write).not.toHaveProperty('approvedAt')
      expect(write).not.toHaveProperty('approvedSnapshotHash')
    }
    expect(options).toEqual({ merge: true })
    expect(write).not.toHaveProperty('internalNotes')
    expect(findUndefinedPaths(write)).toEqual([])
  })

  it.each([
    [
      'hidden',
      { orgId: 'org-1', title: 'Hidden', status: 'client_review', visibility: { showInClientPortal: false }, deleted: false },
    ],
    [
      'cross-org',
      { orgId: 'org-2', title: 'Other org', status: 'client_review', visibility: { showInClientPortal: true }, deleted: false },
    ],
    [
      'deleted',
      { orgId: 'org-1', title: 'Deleted', status: 'client_review', visibility: { showInClientPortal: true }, deleted: true },
    ],
  ])('rejects %s video review decisions from portal users', async (_label, videoData) => {
    stageFirestore({
      videos: [{ id: 'video-1', data: videoData }],
    })

    const { PUT } = await import('@/app/api/v1/portal/youtube-studio/route')
    const res = await PUT(new NextRequest('http://localhost/api/v1/portal/youtube-studio', {
      method: 'PUT',
      body: JSON.stringify({ id: 'video-1', decision: 'approved' }),
    }))

    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(mockDocSet).not.toHaveBeenCalled()
  })

  it('rejects unsupported portal review decisions', async () => {
    const { PUT } = await import('@/app/api/v1/portal/youtube-studio/route')
    const res = await PUT(new NextRequest('http://localhost/api/v1/portal/youtube-studio', {
      method: 'PUT',
      body: JSON.stringify({ id: 'video-1', decision: 'publish_now' }),
    }))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/decision/i)
    expect(mockDocSet).not.toHaveBeenCalled()
  })
})
