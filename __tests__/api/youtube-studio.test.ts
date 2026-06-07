import { NextRequest } from 'next/server'

const mockCollection = jest.fn()
const mockWhere = jest.fn()
const mockGet = jest.fn()
const mockAdd = jest.fn()
const mockDoc = jest.fn()
const mockDocGet = jest.fn()
const mockDocSet = jest.fn()
const mockBatch = jest.fn()
const mockBatchSet = jest.fn()
const mockBatchCommit = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection, batch: mockBatch },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: any) => (req: NextRequest, ctx?: any) =>
    handler(req, { uid: 'admin-1', role: 'admin' }, ctx),
}))

jest.mock('@/lib/api/platformAdmin', () => ({
  canAccessOrg: jest.fn(() => true),
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TS' },
}))

type FirestoreDoc = {
  id: string
  data: Record<string, unknown>
  set?: jest.Mock
}

type CollectionFixture = {
  listDocs?: FirestoreDoc[]
  docs?: Record<string, FirestoreDoc>
  add?: jest.Mock
  nextDocId?: string
}

function stageFirestore(fixtures: Record<string, CollectionFixture>) {
  mockCollection.mockImplementation((collectionName: string) => {
    if (collectionName === 'organizations') {
      return {
        doc: () => ({
          get: jest.fn().mockResolvedValue({ exists: true }),
        }),
      }
    }

    const fixture = fixtures[collectionName]
    if (!fixture) throw new Error(`Unexpected collection ${collectionName}`)

    return {
      where: (...args: unknown[]) => {
        mockWhere(...args)
        return {
          get: async () => {
            mockGet()
            return {
              docs: (fixture.listDocs ?? []).map((doc) => ({
                id: doc.id,
                data: () => doc.data,
              })),
            }
          },
        }
      },
      add: fixture.add ?? mockAdd,
      doc: (id?: string) => {
        const docId = id ?? fixture.nextDocId ?? 'new-doc-id'
        mockDoc(docId)
        const record = fixture.docs?.[docId]
        const set = record?.set ?? mockDocSet
        const ref = { id: docId, set }

        return {
          id: docId,
          set,
          get: async () => {
            mockDocGet(docId)
            if (!record) return { exists: false, id: docId, data: () => undefined, ref }
            return {
              exists: true,
              id: record.id,
              data: () => record.data,
              ref,
            }
          },
        }
      },
    }
  })

  mockAdd.mockResolvedValue({ id: 'new-id' })
  mockDocSet.mockResolvedValue(undefined)
  mockBatch.mockReturnValue({ set: mockBatchSet, commit: mockBatchCommit })
  mockBatchCommit.mockResolvedValue(undefined)
}

describe('youtube studio admin API', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
  })

  it('lists channel workspaces for an org and filters deleted records in memory', async () => {
    stageFirestore({
      youtube_channel_workspaces: {
        listDocs: [
          { id: 'channel-b', data: { orgId: 'org-1', title: 'Beta', status: 'active', deleted: false } },
          { id: 'channel-hidden', data: { orgId: 'org-1', title: 'Hidden', status: 'archived', deleted: true } },
          { id: 'channel-a', data: { orgId: 'org-1', title: 'Acme', status: 'active', deleted: false } },
        ],
      },
    })

    const { GET } = await import('@/app/api/v1/youtube-studio/channels/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/youtube-studio/channels?orgId=org-1'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockWhere).toHaveBeenCalledWith('orgId', '==', 'org-1')
    expect(body.data.channels).toHaveLength(2)
    expect(body.data.channels.map((channel: { id: string }) => channel.id)).toEqual(['channel-a', 'channel-b'])
  })

  it('creates a channel workspace with actor fields and server timestamps', async () => {
    stageFirestore({
      youtube_channel_workspaces: {},
    })

    const { POST } = await import('@/app/api/v1/youtube-studio/channels/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/youtube-studio/channels', {
      method: 'POST',
      body: JSON.stringify({ orgId: 'org-1', title: 'Acme Channel' }),
    }))
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.data.id).toBe('new-id')
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      title: 'Acme Channel',
      createdBy: 'admin-1',
      createdByType: 'user',
      updatedBy: 'admin-1',
      updatedByType: 'user',
      createdAt: 'SERVER_TS',
      updatedAt: 'SERVER_TS',
    }))
  })

  it.each([
    ['missing', {}],
    ['cross-org', {
      'series-1': {
        id: 'series-1',
        data: { orgId: 'org-2', channelWorkspaceId: 'channel-1', name: 'Other org', deleted: false },
      },
    }],
    ['mismatched channel', {
      'series-1': {
        id: 'series-1',
        data: { orgId: 'org-1', channelWorkspaceId: 'channel-2', name: 'Other channel', deleted: false },
      },
    }],
  ])('rejects video project creation with a %s series relationship', async (_label, seriesDocs) => {
    stageFirestore({
      youtube_channel_workspaces: {
        docs: {
          'channel-1': {
            id: 'channel-1',
            data: { orgId: 'org-1', title: 'Acme', deleted: false },
          },
        },
      },
      youtube_series: {
        docs: seriesDocs,
      },
      youtube_video_projects: {},
    })

    const { POST } = await import('@/app/api/v1/youtube-studio/videos/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/youtube-studio/videos', {
      method: 'POST',
      body: JSON.stringify({
        orgId: 'org-1',
        channelWorkspaceId: 'channel-1',
        seriesId: 'series-1',
        title: 'Launch',
      }),
    }))
    const body = await res.json()

    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(body.error).toMatch(/series/i)
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('updates a video project without changing org scope or resetting omitted fields', async () => {
    const existingVideo = {
      orgId: 'org-1',
      channelWorkspaceId: 'channel-1',
      title: 'Old',
      objective: 'Keep the original objective',
      status: 'production',
      videoType: 'tutorial',
      source: { intakeType: 'source_url', sourceUrl: 'https://example.com/source' },
      linked: { taskIds: ['task-1'], documentIds: ['doc-1'] },
      approvalPolicy: { requireClientDraftApproval: false },
      deleted: false,
    }

    stageFirestore({
      youtube_video_projects: {
        docs: {
          'video-1': { id: 'video-1', data: existingVideo },
        },
      },
    })

    const { PUT } = await import('@/app/api/v1/youtube-studio/videos/[id]/route')
    const res = await PUT(new NextRequest('http://localhost/api/v1/youtube-studio/videos/video-1', {
      method: 'PUT',
      body: JSON.stringify({ title: 'New', orgId: 'bad-org' }),
    }), { params: Promise.resolve({ id: 'video-1' }) })

    expect(res.status).toBe(200)
    expect(mockDocSet).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      channelWorkspaceId: 'channel-1',
      title: 'New',
      objective: 'Keep the original objective',
      status: 'production',
      videoType: 'tutorial',
      source: expect.objectContaining({ intakeType: 'source_url', sourceUrl: 'https://example.com/source' }),
      linked: expect.objectContaining({ taskIds: ['task-1'], documentIds: ['doc-1'] }),
      updatedBy: 'admin-1',
      updatedByType: 'user',
      updatedAt: 'SERVER_TS',
    }), { merge: true })
  })

  it('rejects channel workspace updates that point outside the video org', async () => {
    stageFirestore({
      youtube_channel_workspaces: {
        docs: {
          'channel-2': {
            id: 'channel-2',
            data: { orgId: 'org-2', title: 'Other org', deleted: false },
          },
        },
      },
      youtube_video_projects: {
        docs: {
          'video-1': {
            id: 'video-1',
            data: {
              orgId: 'org-1',
              channelWorkspaceId: 'channel-1',
              title: 'Launch',
              objective: 'Keep',
              status: 'production',
              videoType: 'tutorial',
              source: { intakeType: 'manual' },
              linked: {},
              approvalPolicy: { requireClientDraftApproval: false },
              deleted: false,
            },
          },
        },
      },
    })

    const { PUT } = await import('@/app/api/v1/youtube-studio/videos/[id]/route')
    const res = await PUT(new NextRequest('http://localhost/api/v1/youtube-studio/videos/video-1', {
      method: 'PUT',
      body: JSON.stringify({ channelWorkspaceId: 'channel-2' }),
    }), { params: Promise.resolve({ id: 'video-1' }) })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/channelWorkspaceId/i)
    expect(mockDocSet).not.toHaveBeenCalled()
  })

  it.each([
    ['empty', ''],
    ['null', null],
  ])('rejects %s seriesId updates instead of silently leaving the old value', async (_label, seriesId) => {
    stageFirestore({
      youtube_video_projects: {
        docs: {
          'video-1': {
            id: 'video-1',
            data: {
              orgId: 'org-1',
              channelWorkspaceId: 'channel-1',
              seriesId: 'series-1',
              title: 'Launch',
              objective: 'Keep',
              status: 'production',
              videoType: 'tutorial',
              source: { intakeType: 'manual' },
              linked: {},
              approvalPolicy: { requireClientDraftApproval: false },
              deleted: false,
            },
          },
        },
      },
    })

    const { PUT } = await import('@/app/api/v1/youtube-studio/videos/[id]/route')
    const res = await PUT(new NextRequest('http://localhost/api/v1/youtube-studio/videos/video-1', {
      method: 'PUT',
      body: JSON.stringify({ seriesId }),
    }), { params: Promise.resolve({ id: 'video-1' }) })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/seriesId/i)
    expect(mockDocSet).not.toHaveBeenCalled()
  })

  it('creates a draft private publish packet and atomically links it back to the video project', async () => {
    stageFirestore({
      youtube_channel_workspaces: {
        docs: {
          'channel-1': {
            id: 'channel-1',
            data: { orgId: 'org-1', title: 'Acme', deleted: false },
          },
        },
      },
      youtube_video_projects: {
        docs: {
          'video-1': {
            id: 'video-1',
            data: { orgId: 'org-1', channelWorkspaceId: 'channel-1', title: 'Launch', deleted: false },
          },
        },
      },
      youtube_publishing_packets: {
        nextDocId: 'packet-1',
      },
    })

    const { POST } = await import('@/app/api/v1/youtube-studio/publish-packets/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/youtube-studio/publish-packets', {
      method: 'POST',
      body: JSON.stringify({
        orgId: 'org-1',
        channelWorkspaceId: 'channel-1',
        videoProjectId: 'video-1',
        status: 'published',
        visibility: 'public',
        approvedBy: 'client-supplied-approver',
        approvedAt: 'client-supplied-date',
        approvedSnapshotHash: 'client-supplied-hash',
        titleOptions: [{ text: 'Launch plan' }],
        tags: [' growth ', '', 'ops'],
      }),
    }))
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.data.id).toBe('packet-1')
    expect(mockBatch).toHaveBeenCalledTimes(1)
    expect(mockBatchSet).toHaveBeenCalledTimes(2)
    expect(mockBatchCommit).toHaveBeenCalledTimes(1)

    expect(mockBatchSet).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: 'packet-1' }), expect.objectContaining({
      orgId: 'org-1',
      channelWorkspaceId: 'channel-1',
      videoProjectId: 'video-1',
      versionNumber: 1,
      status: 'draft',
      visibility: 'private',
      tags: ['growth', 'ops'],
      createdAt: 'SERVER_TS',
    }))

    const packetWrite = mockBatchSet.mock.calls[0][1]
    expect(JSON.stringify(packetWrite)).not.toContain('undefined')
    expect(packetWrite.approvedBy).toBeUndefined()
    expect(packetWrite.approvedAt).toBeUndefined()
    expect(packetWrite.approvedSnapshotHash).toBeUndefined()
    expect(packetWrite.checks.approval.status).toBe('warning')

    expect(mockBatchSet).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: 'video-1' }), expect.objectContaining({
      publishPacketId: 'packet-1',
      updatedBy: 'admin-1',
      updatedAt: 'SERVER_TS',
    }), { merge: true })
  })

  it.each([
    ['missing', {}, 404],
    ['deleted', {
      'packet-old': {
        id: 'packet-old',
        data: { orgId: 'org-1', videoProjectId: 'video-1', deleted: true },
      },
    }, 404],
    ['cross-org', {
      'packet-old': {
        id: 'packet-old',
        data: { orgId: 'org-2', videoProjectId: 'video-1', deleted: false },
      },
    }, 400],
    ['mismatched video', {
      'packet-old': {
        id: 'packet-old',
        data: { orgId: 'org-1', videoProjectId: 'video-2', deleted: false },
      },
    }, 400],
  ])('rejects publish packet creation with a %s superseded packet relationship', async (_label, packetDocs, expectedStatus) => {
    stageFirestore({
      youtube_channel_workspaces: {
        docs: {
          'channel-1': {
            id: 'channel-1',
            data: { orgId: 'org-1', title: 'Acme', deleted: false },
          },
        },
      },
      youtube_video_projects: {
        docs: {
          'video-1': {
            id: 'video-1',
            data: { orgId: 'org-1', channelWorkspaceId: 'channel-1', title: 'Launch', deleted: false },
          },
        },
      },
      youtube_publishing_packets: {
        docs: packetDocs,
      },
    })

    const { POST } = await import('@/app/api/v1/youtube-studio/publish-packets/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/youtube-studio/publish-packets', {
      method: 'POST',
      body: JSON.stringify({
        orgId: 'org-1',
        channelWorkspaceId: 'channel-1',
        videoProjectId: 'video-1',
        supersedesPacketId: 'packet-old',
      }),
    }))
    const body = await res.json()

    expect(res.status).toBe(expectedStatus)
    expect(body.error).toMatch(/superseded|supersedesPacketId/i)
    expect(mockBatchSet).not.toHaveBeenCalled()
    expect(mockBatchCommit).not.toHaveBeenCalled()
  })
})
