const mockAdd = jest.fn()
const mockDoc = jest.fn()
const mockDocGet = jest.fn()
const mockDocUpdate = jest.fn()
const mockWhere = jest.fn()
const mockGet = jest.fn()
const mockCollection = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP') },
}))

const mockSyncCanvasRunOutputToYouTube = jest.fn()
jest.mock('@/lib/creative-canvas/youtube-bridge', () => ({
  syncCanvasRunOutputToYouTube: (...args: unknown[]) => mockSyncCanvasRunOutputToYouTube(...args),
}))

import { completeCreativeCanvasRun } from '@/lib/creative-canvas/runs'

const ACTOR = { uid: 'agent:maya', type: 'agent' as const }

function primeRunAndCanvasDocs() {
  mockDocGet
    .mockResolvedValueOnce({
      exists: true,
      id: 'run-1',
      data: () => ({
        orgId: 'org-1',
        canvasId: 'canvas-1',
        nodeId: 'model-1',
        providerKey: 'higgsfield',
        model: 'nano_banana_flash',
        status: 'queued',
        input: { sourceNodeIds: [], sourceArtifactIds: [], outputKind: 'video' },
        provenance: { generatedBy: 'agent', promptStored: 'summary', syntheticMedia: true },
      }),
    })
    .mockResolvedValueOnce({
      exists: true,
      id: 'canvas-1',
      data: () => ({
        orgId: 'org-1',
        title: 'Launch Canvas',
        purpose: 'Launch',
        activeVersion: 1,
        deleted: false,
        linked: { youtubeVideoProjectId: 'ytproj-1' },
        nodes: [
          { id: 'model-1', orgId: 'org-1', type: 'model', title: 'Higgsfield', position: { x: 0, y: 0 }, data: {} },
        ],
        edges: [],
      }),
    })
}

const COMPLETE_INPUT = {
  outputNodeId: 'output-1',
  output: { kind: 'video', url: 'https://cdn.example.com/out.mp4' },
  provenance: { providerJobId: 'hf-job-1' },
}

beforeEach(() => {
  jest.clearAllMocks()
  mockDoc.mockReturnValue({ get: mockDocGet, update: mockDocUpdate })
  const query = { where: mockWhere, get: mockGet }
  mockWhere.mockReturnValue(query)
  mockCollection.mockReturnValue({ add: mockAdd, doc: mockDoc, where: mockWhere })
  mockSyncCanvasRunOutputToYouTube.mockResolvedValue('asset_only')
})

describe('completeLoadedCreativeCanvasRun → YouTube sync hook', () => {
  it('fires the bridge once with the completed run + loaded canvas', async () => {
    primeRunAndCanvasDocs()

    const result = await completeCreativeCanvasRun('run-1', 'org-1', COMPLETE_INPUT, ACTOR)

    expect(result.run.status).toBe('completed')
    expect(mockSyncCanvasRunOutputToYouTube).toHaveBeenCalledTimes(1)
    const [runArg, canvasArg] = mockSyncCanvasRunOutputToYouTube.mock.calls[0]
    expect(runArg).toEqual(expect.objectContaining({ id: 'run-1', status: 'completed' }))
    expect(canvasArg).toEqual(expect.objectContaining({ id: 'canvas-1' }))
  })

  it('completion succeeds even when the bridge rejects (fire-and-forget)', async () => {
    primeRunAndCanvasDocs()
    mockSyncCanvasRunOutputToYouTube.mockRejectedValueOnce(new Error('firestore down'))

    await expect(completeCreativeCanvasRun('run-1', 'org-1', COMPLETE_INPUT, ACTOR)).resolves.toEqual(
      expect.objectContaining({ run: expect.objectContaining({ status: 'completed' }) }),
    )
    // Give the swallowed rejection a tick so an unhandled rejection would surface.
    await new Promise((resolve) => setImmediate(resolve))
  })
})
