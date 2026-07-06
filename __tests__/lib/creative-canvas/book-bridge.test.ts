const mockDoc = jest.fn()
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

import { syncCanvasRunOutputToBookStudio } from '@/lib/creative-canvas/book-bridge'
import type { CreativeCanvas, CreativeCanvasRun } from '@/lib/creative-canvas/types'

// In-memory Firestore keyed by `${collection}/${id}` so set/get/update share state.
const store = new Map<string, Record<string, unknown>>()

function keyFor(collection: string, id: string) {
  return `${collection}/${id}`
}

beforeEach(() => {
  jest.clearAllMocks()
  store.clear()

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

    return {
      doc: (id: string) => {
        mockDoc(id)
        return doc(id)
      },
    }
  })
})

const ORG = 'org-1'
const PROJECT = 'bookproj-1'

/** Stage the linked book project doc — the bridge's tenant guard requires it to exist in-org. */
function stageProject(overrides: Record<string, unknown> = {}) {
  store.set(keyFor('book_studio_projects', PROJECT), {
    orgId: ORG,
    title: 'Test book project',
    deleted: false,
    ...overrides,
  })
}

function stagePage(id: string, overrides: Record<string, unknown> = {}) {
  store.set(keyFor('book_studio_pages', id), {
    orgId: ORG,
    projectId: PROJECT,
    status: 'draft',
    deleted: false,
    ...overrides,
  })
}

function stageChapter(id: string, overrides: Record<string, unknown> = {}) {
  store.set(keyFor('book_studio_chapters', id), {
    orgId: ORG,
    projectId: PROJECT,
    status: 'draft',
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
    input: { sourceNodeIds: [], sourceArtifactIds: [], outputKind: 'image' },
    output: { outputNodeId: 'node-1-output', url: 'https://cdn.example.com/out.png', kind: 'image' } as CreativeCanvasRun['output'],
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
    linked: { bookStudioProjectId: PROJECT },
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

function coverNode(overrides: Record<string, unknown> = {}) {
  return {
    id: 'node-1',
    orgId: ORG,
    type: 'model',
    title: 'Cover art',
    position: { x: 0, y: 0 },
    data: { bookRole: 'cover', ...overrides },
  } as CreativeCanvas['nodes'][number]
}

function pageNode(bookPageId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: 'node-1',
    orgId: ORG,
    type: 'model',
    title: 'Page illustration',
    position: { x: 0, y: 0 },
    data: { bookRole: 'page_illustration', bookPageId, ...overrides },
  } as CreativeCanvas['nodes'][number]
}

function chapterNode(bookChapterId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: 'node-1',
    orgId: ORG,
    type: 'model',
    title: 'Chapter text',
    position: { x: 0, y: 0 },
    data: { bookRole: 'chapter_text', bookChapterId, ...overrides },
  } as CreativeCanvas['nodes'][number]
}

describe('syncCanvasRunOutputToBookStudio', () => {
  it('sets the cover image and creates a deterministic artifact link', async () => {
    stageProject()
    const canvas = linkedCanvas({ nodes: [coverNode()] })
    const result = await syncCanvasRunOutputToBookStudio(baseRun(), canvas)

    expect(result).toBe('cover_set')
    const project = store.get(keyFor('book_studio_projects', PROJECT))
    expect(project?.coverImageUrl).toBe('https://cdn.example.com/out.png')

    const artifactLink = store.get(keyFor('book_studio_artifact_links', 'canvas-run-run-1'))
    expect(artifactLink).toBeDefined()
    expect(artifactLink?.orgId).toBe(ORG)
    expect(artifactLink?.projectId).toBe(PROJECT)
    expect(artifactLink?.href).toBe('https://cdn.example.com/out.png')
    expect(artifactLink?.type).toBe('canvas_output')
    expect(artifactLink?.label).toBe('Canvas: nano_banana_flash cover')
    expect(artifactLink?.deleted).toBe(false)
    expect(artifactLink?.createdByType).toBe('agent')
  })

  it('replay is idempotent — second call does not churn createdAt on the artifact link', async () => {
    stageProject()
    const canvas = linkedCanvas({ nodes: [coverNode()] })
    await syncCanvasRunOutputToBookStudio(baseRun(), canvas)

    const linkKey = keyFor('book_studio_artifact_links', 'canvas-run-run-1')
    store.set(linkKey, { ...(store.get(linkKey) ?? {}), createdAt: 'ORIGINAL_TS' })

    const result = await syncCanvasRunOutputToBookStudio(baseRun(), canvas)
    expect(result).toBe('cover_set')
    const link = store.get(linkKey)
    expect(link?.createdAt).toBe('ORIGINAL_TS')
    expect(link?.updatedAt).toBe('SERVER_TIMESTAMP')

    // Still only one artifact-link doc for this run.
    const linkDocs = [...store.keys()].filter((k) => k.startsWith('book_studio_artifact_links/'))
    expect(linkDocs).toEqual([linkKey])
  })

  it('sets a page illustration', async () => {
    stageProject()
    stagePage('page-1')
    const canvas = linkedCanvas({ nodes: [pageNode('page-1')] })
    const result = await syncCanvasRunOutputToBookStudio(baseRun(), canvas)

    expect(result).toBe('page_set')
    const page = store.get(keyFor('book_studio_pages', 'page-1'))
    expect(page?.imageUrl).toBe('https://cdn.example.com/out.png')
    expect(page?.canvasRunId).toBe('run-1')
    expect(page?.status).toBe('generated')
  })

  it('sets chapter text with a computed word count', async () => {
    stageProject()
    stageChapter('chapter-1')
    const run = baseRun({
      input: { sourceNodeIds: [], sourceArtifactIds: [], outputKind: 'copy' },
      output: { outputNodeId: 'node-1-output', textPreview: 'one two three four five', kind: 'copy' } as CreativeCanvasRun['output'],
    })
    const canvas = linkedCanvas({ nodes: [chapterNode('chapter-1')] })
    const result = await syncCanvasRunOutputToBookStudio(run, canvas)

    expect(result).toBe('chapter_set')
    const chapter = store.get(keyFor('book_studio_chapters', 'chapter-1'))
    expect(chapter?.body).toBe('one two three four five')
    expect(chapter?.wordCount).toBe(5)
    expect(chapter?.canvasRunId).toBe('run-1')
    expect(chapter?.status).toBe('generated')
  })

  it('never clobbers a chapter already edited by a human', async () => {
    stageProject()
    stageChapter('chapter-1', { status: 'edited', body: 'human-written body' })
    const run = baseRun({
      input: { sourceNodeIds: [], sourceArtifactIds: [], outputKind: 'copy' },
      output: { outputNodeId: 'node-1-output', textPreview: 'agent generated text', kind: 'copy' } as CreativeCanvasRun['output'],
    })
    const canvas = linkedCanvas({ nodes: [chapterNode('chapter-1')] })
    const result = await syncCanvasRunOutputToBookStudio(run, canvas)

    expect(result).toBe('skipped')
    const chapter = store.get(keyFor('book_studio_chapters', 'chapter-1'))
    expect(chapter?.body).toBe('human-written body')
    expect(chapter?.status).toBe('edited')
  })

  it('never clobbers an approved chapter', async () => {
    stageProject()
    stageChapter('chapter-1', { status: 'approved', body: 'approved body' })
    const run = baseRun({
      input: { sourceNodeIds: [], sourceArtifactIds: [], outputKind: 'copy' },
      output: { outputNodeId: 'node-1-output', textPreview: 'agent generated text', kind: 'copy' } as CreativeCanvasRun['output'],
    })
    const canvas = linkedCanvas({ nodes: [chapterNode('chapter-1')] })
    const result = await syncCanvasRunOutputToBookStudio(run, canvas)

    expect(result).toBe('skipped')
    const chapter = store.get(keyFor('book_studio_chapters', 'chapter-1'))
    expect(chapter?.body).toBe('approved body')
  })

  it('skips when the linked project belongs to another org (tenant guard)', async () => {
    stageProject({ orgId: 'org-EVIL' })
    const canvas = linkedCanvas({ nodes: [coverNode()] })
    const result = await syncCanvasRunOutputToBookStudio(baseRun(), canvas)
    expect(result).toBe('skipped')
    expect(store.has(keyFor('book_studio_projects', PROJECT))).toBe(true)
    expect(store.get(keyFor('book_studio_projects', PROJECT))?.coverImageUrl).toBeUndefined()
    expect(store.has(keyFor('book_studio_artifact_links', 'canvas-run-run-1'))).toBe(false)
  })

  it('skips when the linked project is deleted or missing', async () => {
    stageProject({ deleted: true })
    const canvas = linkedCanvas({ nodes: [coverNode()] })
    expect(await syncCanvasRunOutputToBookStudio(baseRun(), canvas)).toBe('skipped')
    store.delete(keyFor('book_studio_projects', PROJECT))
    expect(await syncCanvasRunOutputToBookStudio(baseRun(), canvas)).toBe('skipped')
  })

  it('REALISTIC PATH: run.input.outputKind is the registry kind (image), not book_artifact — node data.bookRole still drives the sync', async () => {
    stageProject()
    stagePage('page-1')
    // The generate route stamps outputKind from the model registry ('image'),
    // never 'book_artifact'. Intent must come from the generating node.
    const run = baseRun({ input: { sourceNodeIds: [], sourceArtifactIds: [], outputKind: 'image' } })
    const canvas = linkedCanvas({ nodes: [pageNode('page-1')] })
    const result = await syncCanvasRunOutputToBookStudio(run, canvas)
    expect(result).toBe('page_set')
  })

  it('skips when the generating node is missing from canvas.nodes', async () => {
    stageProject()
    const canvas = linkedCanvas({ nodes: [] })
    const result = await syncCanvasRunOutputToBookStudio(baseRun(), canvas)
    expect(result).toBe('skipped')
  })

  it('skips when the node has no data.bookRole', async () => {
    stageProject()
    const canvas = linkedCanvas({
      nodes: [{
        id: 'node-1', orgId: ORG, type: 'model', title: 'Unrelated node',
        position: { x: 0, y: 0 }, data: {},
      } as CreativeCanvas['nodes'][number]],
    })
    const result = await syncCanvasRunOutputToBookStudio(baseRun(), canvas)
    expect(result).toBe('skipped')
  })

  it('skips a run that is not completed', async () => {
    stageProject()
    const canvas = linkedCanvas({ nodes: [coverNode()] })
    const run = baseRun({ status: 'running' })
    const result = await syncCanvasRunOutputToBookStudio(run, canvas)
    expect(result).toBe('skipped')
  })

  it('skips a completed cover run with no output URL', async () => {
    stageProject()
    const canvas = linkedCanvas({ nodes: [coverNode()] })
    const run = baseRun({ output: { outputNodeId: 'n', kind: 'image' } as CreativeCanvasRun['output'] })
    const result = await syncCanvasRunOutputToBookStudio(run, canvas)
    expect(result).toBe('skipped')
  })

  it('skips when the canvas is not linked to a book project', async () => {
    const canvas = linkedCanvas({ linked: {}, nodes: [coverNode()] })
    const result = await syncCanvasRunOutputToBookStudio(baseRun(), canvas)
    expect(result).toBe('skipped')
  })

  it('skips a page_illustration run missing bookPageId', async () => {
    stageProject()
    const canvas = linkedCanvas({
      nodes: [{
        id: 'node-1', orgId: ORG, type: 'model', title: 'Page illustration',
        position: { x: 0, y: 0 }, data: { bookRole: 'page_illustration' },
      } as CreativeCanvas['nodes'][number]],
    })
    const result = await syncCanvasRunOutputToBookStudio(baseRun(), canvas)
    expect(result).toBe('skipped')
  })

  it('skips a page_illustration run whose page belongs to another project', async () => {
    stageProject()
    stagePage('page-1', { projectId: 'other-project' })
    const canvas = linkedCanvas({ nodes: [pageNode('page-1')] })
    const result = await syncCanvasRunOutputToBookStudio(baseRun(), canvas)
    expect(result).toBe('skipped')
  })

  it('skips a chapter_text run missing bookChapterId', async () => {
    stageProject()
    const canvas = linkedCanvas({
      nodes: [{
        id: 'node-1', orgId: ORG, type: 'model', title: 'Chapter text',
        position: { x: 0, y: 0 }, data: { bookRole: 'chapter_text' },
      } as CreativeCanvas['nodes'][number]],
    })
    const run = baseRun({
      input: { sourceNodeIds: [], sourceArtifactIds: [], outputKind: 'copy' },
      output: { outputNodeId: 'n', textPreview: 'hello world', kind: 'copy' } as CreativeCanvasRun['output'],
    })
    const result = await syncCanvasRunOutputToBookStudio(run, canvas)
    expect(result).toBe('skipped')
  })

  it('skips a chapter_text run with no textPreview', async () => {
    stageProject()
    stageChapter('chapter-1')
    const run = baseRun({
      input: { sourceNodeIds: [], sourceArtifactIds: [], outputKind: 'copy' },
      output: { outputNodeId: 'n', kind: 'copy' } as CreativeCanvasRun['output'],
    })
    const canvas = linkedCanvas({ nodes: [chapterNode('chapter-1')] })
    const result = await syncCanvasRunOutputToBookStudio(run, canvas)
    expect(result).toBe('skipped')
  })

  it('skips an unknown bookRole', async () => {
    stageProject()
    const canvas = linkedCanvas({
      nodes: [{
        id: 'node-1', orgId: ORG, type: 'model', title: 'Mystery node',
        position: { x: 0, y: 0 }, data: { bookRole: 'something_else' },
      } as CreativeCanvas['nodes'][number]],
    })
    const result = await syncCanvasRunOutputToBookStudio(baseRun(), canvas)
    expect(result).toBe('skipped')
  })

  it('loads the canvas itself when not supplied', async () => {
    stageProject()
    mockGetCreativeCanvas.mockResolvedValue(linkedCanvas({ nodes: [coverNode()] }))
    const result = await syncCanvasRunOutputToBookStudio(baseRun())
    expect(mockGetCreativeCanvas).toHaveBeenCalledWith('canvas-1', ORG)
    expect(result).toBe('cover_set')
  })

  it('skips when the loaded canvas is missing', async () => {
    mockGetCreativeCanvas.mockResolvedValue(null)
    const result = await syncCanvasRunOutputToBookStudio(baseRun())
    expect(result).toBe('skipped')
  })
})
