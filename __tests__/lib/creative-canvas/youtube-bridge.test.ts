const mockDoc = jest.fn()
const mockWhere = jest.fn()
const mockAdd = jest.fn()
const mockCollection = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP') },
}))

const mockGetCreativeCanvas = jest.fn()
jest.mock('@/lib/creative-canvas/store', () => ({
  getCreativeCanvas: (...args: unknown[]) => mockGetCreativeCanvas(...args),
}))

import { syncCanvasRunOutputToYouTube } from '@/lib/creative-canvas/youtube-bridge'
import { YOUTUBE_COLLECTIONS } from '@/lib/youtube-studio/api'
import type { CreativeCanvas, CreativeCanvasRun } from '@/lib/creative-canvas/types'

// In-memory Firestore keyed by `${collection}/${id}` so set/get/query/add share state.
const store = new Map<string, Record<string, unknown>>()
let addAutoId = 0

function keyFor(collection: string, id: string) {
  return `${collection}/${id}`
}

beforeEach(() => {
  jest.clearAllMocks()
  store.clear()
  addAutoId = 0

  mockCollection.mockImplementation((collection: string) => {
    const doc = (id: string) => {
      const k = keyFor(collection, id)
      return {
        get: jest.fn(async () => {
          const data = store.get(k)
          return { exists: Boolean(data), id, data: () => data }
        }),
        set: jest.fn(async (value: Record<string, unknown>, options?: { merge?: boolean }) => {
          if (options?.merge) store.set(k, { ...(store.get(k) ?? {}), ...value })
          else store.set(k, value)
        }),
        update: jest.fn(async (value: Record<string, unknown>) => {
          store.set(k, { ...(store.get(k) ?? {}), ...value })
        }),
      }
    }

    function makeQuery(filters: Array<[string, unknown]>) {
      return {
        where: (field: string, _op: string, value: unknown) => makeQuery([...filters, [field, value]]),
        get: async () => {
          const results = [...store.entries()]
            .filter(([storeKey]) => storeKey.startsWith(`${collection}/`))
            .filter(([, data]) => filters.every(([field, value]) => data[field] === value))
            .map(([storeKey, data]) => ({ id: storeKey.split('/').slice(1).join('/'), data: () => data }))
          return { docs: results }
        },
      }
    }

    return {
      doc: (id: string) => {
        mockDoc(id)
        return doc(id)
      },
      where: (field: string, _op: string, value: unknown) => {
        mockWhere(field, _op, value)
        return makeQuery([[field, value]])
      },
      add: jest.fn(async (value: Record<string, unknown>) => {
        mockAdd(value)
        addAutoId += 1
        const id = `auto-${addAutoId}`
        store.set(keyFor(collection, id), value)
        return { id }
      }),
    }
  })
})

const ORG = 'org-1'
const PROJECT = 'ytproj-1'

/** Stage the linked video project doc — the bridge's tenant guard requires it to exist in-org. */
function stageProject(overrides: Record<string, unknown> = {}) {
  store.set(keyFor('youtube_video_projects', PROJECT), {
    orgId: ORG,
    channelWorkspaceId: 'ch-1',
    title: 'Test video project',
    deleted: false,
    ...overrides,
  })
}

function baseRun(overrides: Partial<CreativeCanvasRun> = {}): CreativeCanvasRun & { id: string } {
  return {
    id: 'run-1',
    orgId: ORG,
    canvasId: 'canvas-1',
    nodeId: 'node-1',
    providerKey: 'higgsfield',
    model: 'nano_banana_flash',
    status: 'completed',
    input: { sourceNodeIds: [], sourceArtifactIds: [], outputKind: 'video' },
    output: { outputNodeId: 'node-1-output', url: 'https://cdn.example.com/out.mp4', kind: 'video' } as CreativeCanvasRun['output'],
    provenance: { generatedBy: 'agent', promptStored: 'summary', syntheticMedia: true },
    ...overrides,
  }
}

function linkedCanvas(overrides: Partial<CreativeCanvas> = {}): CreativeCanvas & { id: string } {
  return {
    id: 'canvas-1',
    orgId: ORG,
    title: 'My Canvas',
    status: 'active',
    purpose: 'production',
    linked: { youtubeVideoProjectId: PROJECT },
    activeVersion: 1,
    visibility: 'internal',
    createdBy: 'u',
    createdByType: 'user',
    updatedBy: 'u',
    updatedByType: 'user',
    deleted: false,
    nodes: [],
    edges: [],
    ...overrides,
  } as CreativeCanvas & { id: string }
}

describe('syncCanvasRunOutputToYouTube', () => {
  it('skips when the linked project belongs to another org (tenant guard)', async () => {
    stageProject({ orgId: 'org-EVIL' })
    const result = await syncCanvasRunOutputToYouTube(baseRun(), linkedCanvas())
    expect(result).toBe('skipped')
    expect(store.has(keyFor('youtube_source_assets', 'canvas-run-run-1'))).toBe(false)
  })

  it('skips when the linked project is deleted or missing', async () => {
    stageProject({ deleted: true })
    expect(await syncCanvasRunOutputToYouTube(baseRun(), linkedCanvas())).toBe('skipped')
    store.delete(keyFor('youtube_video_projects', PROJECT))
    expect(await syncCanvasRunOutputToYouTube(baseRun(), linkedCanvas())).toBe('skipped')
  })

  it('does not churn createdAt on idempotent replay of the same run', async () => {
    stageProject()
    await syncCanvasRunOutputToYouTube(baseRun(), linkedCanvas())
    const assetKey = keyFor('youtube_source_assets', 'canvas-run-run-1')
    store.set(assetKey, { ...(store.get(assetKey) ?? {}), createdAt: 'ORIGINAL_TS' })
    await syncCanvasRunOutputToYouTube(baseRun(), linkedCanvas())
    expect(store.get(assetKey)?.createdAt).toBe('ORIGINAL_TS')
  })

  it('creates a source asset with the deterministic id + provenance for a linked video output', async () => {
    stageProject()
    const result = await syncCanvasRunOutputToYouTube(baseRun(), linkedCanvas())

    expect(result).toBe('asset_only')
    const asset = store.get(keyFor(YOUTUBE_COLLECTIONS.sourceAssets, 'canvas-run-run-1'))
    expect(asset).toBeDefined()
    expect(asset?.orgId).toBe(ORG)
    expect(asset?.videoProjectId).toBe(PROJECT)
    expect(asset?.assetType).toBe('rendered_video')
    expect(asset?.sourceUrl).toBe('https://cdn.example.com/out.mp4')
    expect(asset?.deleted).toBe(false)
    expect(asset?.createdByType).toBe('agent')
    expect(String(asset?.internalNotes)).toContain('run-1')
    expect(String(asset?.internalNotes)).toContain('higgsfield')
  })

  it('is idempotent — a second call does not create a duplicate or bump anything', async () => {
    stageProject()
    await syncCanvasRunOutputToYouTube(baseRun(), linkedCanvas())
    const first = store.get(keyFor(YOUTUBE_COLLECTIONS.sourceAssets, 'canvas-run-run-1'))
    await syncCanvasRunOutputToYouTube(baseRun(), linkedCanvas())
    const second = store.get(keyFor(YOUTUBE_COLLECTIONS.sourceAssets, 'canvas-run-run-1'))
    expect(second).toBeDefined()
    // Only one source-asset doc for this run.
    const assetDocs = [...store.keys()].filter((k) => k.startsWith(`${YOUTUBE_COLLECTIONS.sourceAssets}/`))
    expect(assetDocs).toEqual([keyFor(YOUTUBE_COLLECTIONS.sourceAssets, 'canvas-run-run-1')])
    expect(first?.createdByType).toBe('agent')
  })

  it('flips an open render job to rendered with the creative_canvas stamp (youtube_render)', async () => {
    stageProject()
    store.set(keyFor(YOUTUBE_COLLECTIONS.renderJobs, 'job-1'), {
      orgId: ORG, videoProjectId: PROJECT, channelWorkspaceId: 'ch-1',
      status: 'rendering', versionNumber: 1, deleted: false, createdAt: 100,
    })

    const run = baseRun({
      input: { sourceNodeIds: [], sourceArtifactIds: [], outputKind: 'youtube_render' },
      output: { outputNodeId: 'node-1-output', url: 'https://cdn.example.com/out.mp4', kind: 'youtube_render' } as CreativeCanvasRun['output'],
    })
    const result = await syncCanvasRunOutputToYouTube(run, linkedCanvas())

    expect(result).toBe('render_completed')
    const job = store.get(keyFor(YOUTUBE_COLLECTIONS.renderJobs, 'job-1'))
    expect(job?.status).toBe('rendered')
    expect((job?.output as Record<string, unknown>)?.previewUrl).toBe('https://cdn.example.com/out.mp4')
    expect((job?.output as Record<string, unknown>)?.downloadUrl).toBe('https://cdn.example.com/out.mp4')
    expect((job?.renderEngine as Record<string, unknown>)?.provider).toBe('creative_canvas')
    expect((job?.renderEngine as Record<string, unknown>)?.jobId).toBe('run-1')
    expect((job?.renderEngine as Record<string, unknown>)?.status).toBe('completed')
  })

  it('creates a rendered render job directly when none is open (youtube_render)', async () => {
    stageProject()
    const run = baseRun({
      input: { sourceNodeIds: [], sourceArtifactIds: [], outputKind: 'youtube_render' },
      output: { outputNodeId: 'node-1-output', url: 'https://cdn.example.com/out.mp4', kind: 'youtube_render' } as CreativeCanvasRun['output'],
    })
    const result = await syncCanvasRunOutputToYouTube(run, linkedCanvas({ linked: { youtubeVideoProjectId: PROJECT } }))

    expect(result).toBe('render_created')
    const jobDocs = [...store.entries()].filter(([k]) => k.startsWith(`${YOUTUBE_COLLECTIONS.renderJobs}/`))
    expect(jobDocs).toHaveLength(1)
    const [, job] = jobDocs[0]
    expect(job.status).toBe('rendered')
    expect(job.videoProjectId).toBe(PROJECT)
    expect((job.renderEngine as Record<string, unknown>)?.jobId).toBe('run-1')
    expect((job.output as Record<string, unknown>)?.downloadUrl).toBe('https://cdn.example.com/out.mp4')
  })

  it("completes a render job from a plain VIDEO run when the generating NODE declares youtube_render (the real generate-route path — run.input.outputKind is the model's registry kind)", async () => {
    stageProject()
    store.set(keyFor(YOUTUBE_COLLECTIONS.renderJobs, 'job-1'), {
      orgId: ORG, videoProjectId: PROJECT, channelWorkspaceId: 'ch-1',
      status: 'rendering', versionNumber: 1, deleted: false, createdAt: 100,
    })
    // Run kind is 'video' (what the generate route stamps from the model
    // registry); render intent lives on the node, as authored by the seeder.
    const run = baseRun({ nodeId: 'yt-proj-assembly' })
    const canvas = linkedCanvas({
      nodes: [{
        id: 'yt-proj-assembly', orgId: ORG, type: 'model', title: 'Final assembly',
        position: { x: 0, y: 0 },
        data: { outputKind: 'youtube_render' },
        edit: { operation: 'video_motion', outputKind: 'youtube_render' },
      }] as CreativeCanvas['nodes'],
    })

    const result = await syncCanvasRunOutputToYouTube(run, canvas)

    expect(result).toBe('render_completed')
    const job = store.get(keyFor(YOUTUBE_COLLECTIONS.renderJobs, 'job-1'))
    expect(job?.status).toBe('rendered')
    expect((job?.renderEngine as Record<string, unknown>)?.provider).toBe('creative_canvas')
  })

  it('a plain video run on a NON-assembly node stays asset_only', async () => {
    stageProject()
    const run = baseRun({ nodeId: 'scene-video-node' })
    const canvas = linkedCanvas({
      nodes: [{
        id: 'scene-video-node', orgId: ORG, type: 'model', title: 'Scene 1 visual',
        position: { x: 0, y: 0 },
        data: { outputKind: 'video' },
        edit: { operation: 'video_motion', outputKind: 'video' },
      }] as CreativeCanvas['nodes'],
    })
    expect(await syncCanvasRunOutputToYouTube(run, canvas)).toBe('asset_only')
    const jobDocs = [...store.keys()].filter((k) => k.startsWith(`${YOUTUBE_COLLECTIONS.renderJobs}/`))
    expect(jobDocs).toHaveLength(0)
  })

  it('skips (no writes) when the canvas is not linked to a video project', async () => {
    const result = await syncCanvasRunOutputToYouTube(baseRun(), linkedCanvas({ linked: {} }))
    expect(result).toBe('skipped')
    expect(store.size).toBe(0)
  })

  it('skips copy/text outputs (non-video kind)', async () => {
    const run = baseRun({
      input: { sourceNodeIds: [], sourceArtifactIds: [], outputKind: 'copy' },
      output: { outputNodeId: 'n', textPreview: 'hello', kind: 'copy' } as CreativeCanvasRun['output'],
    })
    const result = await syncCanvasRunOutputToYouTube(run, linkedCanvas())
    expect(result).toBe('skipped')
    expect(store.size).toBe(0)
  })

  it('skips a completed video run that has no output URL', async () => {
    const run = baseRun({ output: { outputNodeId: 'n', kind: 'video' } as CreativeCanvasRun['output'] })
    const result = await syncCanvasRunOutputToYouTube(run, linkedCanvas())
    expect(result).toBe('skipped')
    expect(store.size).toBe(0)
  })

  it('does not re-update a render job already stamped with this run id', async () => {
    stageProject()
    store.set(keyFor(YOUTUBE_COLLECTIONS.renderJobs, 'job-1'), {
      orgId: ORG, videoProjectId: PROJECT, channelWorkspaceId: 'ch-1',
      status: 'rendered', versionNumber: 1, deleted: false, createdAt: 100,
      renderEngine: { provider: 'creative_canvas', jobId: 'run-1', status: 'completed' },
      output: { previewUrl: 'https://old.example.com/v.mp4', downloadUrl: 'https://old.example.com/v.mp4' },
    })

    const run = baseRun({
      input: { sourceNodeIds: [], sourceArtifactIds: [], outputKind: 'youtube_render' },
      output: { outputNodeId: 'node-1-output', url: 'https://cdn.example.com/out.mp4', kind: 'youtube_render' } as CreativeCanvasRun['output'],
    })
    const result = await syncCanvasRunOutputToYouTube(run, linkedCanvas())

    // Still reports completion, but leaves the old output untouched (no double update).
    expect(result).toBe('render_completed')
    const job = store.get(keyFor(YOUTUBE_COLLECTIONS.renderJobs, 'job-1'))
    expect((job?.output as Record<string, unknown>)?.downloadUrl).toBe('https://old.example.com/v.mp4')
  })

  it('loads the canvas itself when not supplied', async () => {
    stageProject()
    mockGetCreativeCanvas.mockResolvedValue(linkedCanvas())
    const result = await syncCanvasRunOutputToYouTube(baseRun())
    expect(mockGetCreativeCanvas).toHaveBeenCalledWith('canvas-1', ORG)
    expect(result).toBe('asset_only')
  })

  it('skips when the loaded canvas is missing', async () => {
    mockGetCreativeCanvas.mockResolvedValue(null)
    const result = await syncCanvasRunOutputToYouTube(baseRun())
    expect(result).toBe('skipped')
    expect(store.size).toBe(0)
  })
})
