import { NextRequest } from 'next/server'

const mockCollection = jest.fn()
const mockWhere = jest.fn()
const mockGet = jest.fn()
const mockAdd = jest.fn()
const mockDoc = jest.fn()
const mockDocGet = jest.fn()
const mockDocSet = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
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
      doc: (id: string) => {
        mockDoc(id)
        const record = fixture.docs?.[id]
        const set = record?.set ?? mockDocSet
        const ref = { set }

        return {
          set,
          get: async () => {
            mockDocGet(id)
            if (!record) return { exists: false, id, data: () => undefined, ref }
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

  it('creates a publish packet and links it back to the video project', async () => {
    const packetAdd = jest.fn().mockResolvedValue({ id: 'packet-1' })
    const videoSet = jest.fn().mockResolvedValue(undefined)

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
            set: videoSet,
          },
        },
      },
      youtube_publishing_packets: {
        add: packetAdd,
      },
    })

    const { POST } = await import('@/app/api/v1/youtube-studio/publish-packets/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/youtube-studio/publish-packets', {
      method: 'POST',
      body: JSON.stringify({
        orgId: 'org-1',
        channelWorkspaceId: 'channel-1',
        videoProjectId: 'video-1',
        titleOptions: [{ text: 'Launch plan' }],
        tags: [' growth ', '', 'ops'],
      }),
    }))
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.data.id).toBe('packet-1')
    expect(packetAdd).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      channelWorkspaceId: 'channel-1',
      videoProjectId: 'video-1',
      versionNumber: 1,
      visibility: 'private',
      tags: ['growth', 'ops'],
      createdAt: 'SERVER_TS',
    }))
    expect(JSON.stringify(packetAdd.mock.calls[0][0])).not.toContain('undefined')
    expect(videoSet).toHaveBeenCalledWith(expect.objectContaining({
      publishPacketId: 'packet-1',
      updatedBy: 'admin-1',
      updatedAt: 'SERVER_TS',
    }), { merge: true })
  })
})
