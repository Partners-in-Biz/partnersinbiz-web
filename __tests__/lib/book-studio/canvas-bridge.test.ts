import {
  buildCanvasGraphFromBookProject,
  type BookCanvasChapter,
  type BookCanvasPage,
  type BookCanvasSeedInput,
} from '@/lib/book-studio/canvas-bridge'
import { getBookFormat } from '@/lib/book-studio/format-registry'
import { getCanvasModel } from '@/lib/creative-canvas/model-registry'
import type { BookStudioRecord } from '@/lib/book-studio/types'

const ORG_ID = 'org-test-123'
const PROJECT_ID = 'bp-abc'

function makeProject(overrides: Partial<BookStudioRecord> = {}): BookStudioRecord & { id: string } {
  return {
    id: PROJECT_ID,
    orgId: ORG_ID,
    title: 'The Tiny Astronaut',
    status: 'draft',
    audience: 'Kids aged 4-7',
    stylePrompt: 'Soft watercolour, warm palette',
    deleted: false,
    ...overrides,
  }
}

function makePage(n: number, overrides: Partial<BookCanvasPage> = {}): BookCanvasPage {
  return {
    id: `page-${n}`,
    order: n,
    prompt: `A tiny astronaut floats past planet ${n}`,
    ...overrides,
  }
}

function makeChapter(n: number, overrides: Partial<BookCanvasChapter> = {}): BookCanvasChapter {
  return {
    id: `ch-${n}`,
    title: `Chapter ${n} title`,
    order: n,
    status: 'draft',
    ...overrides,
  }
}

function build(formatId: string, input: Partial<BookCanvasSeedInput> = {}) {
  return buildCanvasGraphFromBookProject({
    project: makeProject(),
    format: getBookFormat(formatId),
    chapters: [],
    pages: [],
    ...input,
  })
}

function generationNodes(graph: ReturnType<typeof buildCanvasGraphFromBookProject>) {
  return graph.nodes.filter((n) => n.type === 'model')
}

describe('buildCanvasGraphFromBookProject', () => {
  test('is deterministic — two calls deep-equal', () => {
    const pages = [makePage(1), makePage(2), makePage(3)]
    const a = build('kids_picture', { pages })
    const b = build('kids_picture', { pages })
    expect(a).toEqual(b)
  })

  test('node ids are namespaced bk-<projectId>- and stable', () => {
    const graph = build('kids_picture', { pages: [makePage(1), makePage(2)] })
    for (const node of graph.nodes) {
      expect(node.id.startsWith(`bk-${PROJECT_ID}-`)).toBe(true)
    }
    const ids = graph.nodes.map((n) => n.id)
    expect(ids).toContain(`bk-${PROJECT_ID}-brief`)
    expect(ids).toContain(`bk-${PROJECT_ID}-cover`)
    expect(ids).toContain(`bk-${PROJECT_ID}-page-page-1`)
    expect(ids).toContain(`bk-${PROJECT_ID}-page-page-2`)
  })

  test('brief node carries title, format label, audience, and style prompt', () => {
    const graph = build('kids_picture', { pages: [makePage(1)] })
    const brief = graph.nodes.find((n) => n.type === 'brief')!
    const text = String(brief.data.prompt)
    expect(text).toContain('The Tiny Astronaut')
    expect(text).toContain('Kids Picture Book')
    expect(text).toContain('Kids aged 4-7')
    expect(text).toContain('Soft watercolour, warm palette')
  })

  test('cover node is an image generator tagged book_artifact with bookRole cover', () => {
    const graph = build('kids_picture', { pages: [makePage(1)] })
    const cover = graph.nodes.find((n) => n.id === `bk-${PROJECT_ID}-cover`)!
    expect(cover.type).toBe('model')
    expect(cover.edit?.outputKind).toBe('book_artifact')
    expect(cover.data.bookRole).toBe('cover')
    expect(getCanvasModel(cover.provider!.model!)?.kind).toBe('image')
    expect(String(cover.edit?.prompt)).toContain('Book cover for "The Tiny Astronaut"')
    expect(String(cover.edit?.prompt)).toContain('Soft watercolour, warm palette')
  })

  test('every generation node is tagged edit.outputKind book_artifact', () => {
    const graph = build('kids_picture', { pages: [makePage(1), makePage(2)] })
    for (const node of generationNodes(graph)) {
      expect(node.edit?.outputKind).toBe('book_artifact')
    }
  })

  test('brief is wired to the cover and every generator', () => {
    const graph = build('kids_picture', { pages: [makePage(1), makePage(2)] })
    const briefId = `bk-${PROJECT_ID}-brief`
    for (const gen of generationNodes(graph)) {
      expect(graph.edges.some((e) => e.sourceNodeId === briefId && e.targetNodeId === gen.id)).toBe(true)
    }
    expect(graph.edges).toHaveLength(generationNodes(graph).length)
  })

  test('picture_book: one illustration node per page, carrying bookPageId', () => {
    const graph = build('kids_picture', { pages: [makePage(1), makePage(2), makePage(3)] })
    // cover + 3 page illustrations
    expect(generationNodes(graph)).toHaveLength(4)
    const page1 = graph.nodes.find((n) => n.id === `bk-${PROJECT_ID}-page-page-1`)!
    expect(page1.data.bookRole).toBe('page_illustration')
    expect(page1.data.bookPageId).toBe('page-1')
    expect(String(page1.edit?.prompt)).toContain('A tiny astronaut floats past planet 1')
    expect(String(page1.edit?.prompt)).toContain('Soft watercolour, warm palette')
  })

  test('picture_book: pages that already have imageUrl are skipped', () => {
    const graph = build('kids_picture', {
      pages: [
        makePage(1, { imageUrl: 'https://cdn.example.com/page-1.png' }),
        makePage(2),
      ],
    })
    const ids = graph.nodes.map((n) => n.id)
    expect(ids).not.toContain(`bk-${PROJECT_ID}-page-page-1`)
    expect(ids).toContain(`bk-${PROJECT_ID}-page-page-2`)
  })

  test('picture_book: pages fall back to caption then generic prompt', () => {
    const graph = build('kids_picture', {
      pages: [
        makePage(1, { prompt: undefined, caption: 'The rocket lands on the moon' }),
        makePage(2, { prompt: undefined, caption: undefined }),
      ],
    })
    const p1 = graph.nodes.find((n) => n.id === `bk-${PROJECT_ID}-page-page-1`)!
    const p2 = graph.nodes.find((n) => n.id === `bk-${PROJECT_ID}-page-page-2`)!
    expect(String(p1.edit?.prompt)).toContain('The rocket lands on the moon')
    expect(String(p2.edit?.prompt)).toContain('Illustration for page 2')
  })

  test('colouring_book: page prompts carry the line-art prefix', () => {
    const graph = build('colouring', { pages: [makePage(1)] })
    const page = graph.nodes.find((n) => n.id === `bk-${PROJECT_ID}-page-page-1`)!
    expect(String(page.edit?.prompt).startsWith(
      'Black and white line art for a colouring book page, clean bold outlines, no shading, no grey fill: ',
    )).toBe(true)
  })

  test('comic_book: page prompts carry the comic prefix', () => {
    const graph = build('comic', { pages: [makePage(1)] })
    const page = graph.nodes.find((n) => n.id === `bk-${PROJECT_ID}-page-page-1`)!
    expect(String(page.edit?.prompt).startsWith('Comic book page art: ')).toBe(true)
  })

  test('text_book: draft/generated chapters yield copy nodes with bookChapterId', () => {
    const graph = build('story', {
      chapters: [makeChapter(1), makeChapter(2, { status: 'generated' })],
    })
    // cover + 2 chapter copy nodes
    expect(generationNodes(graph)).toHaveLength(3)
    const ch1 = graph.nodes.find((n) => n.id === `bk-${PROJECT_ID}-chapter-ch-1`)!
    expect(ch1.provider?.key).toBe('agent_task')
    expect(ch1.provider?.model).toBe('agent-llm')
    expect(ch1.data.bookRole).toBe('chapter_text')
    expect(ch1.data.bookChapterId).toBe('ch-1')
    expect(ch1.edit?.outputKind).toBe('book_artifact')
    expect(String(ch1.edit?.prompt)).toContain('Write the full prose for chapter "Chapter 1 title" of "The Tiny Astronaut".')
    expect(String(ch1.edit?.prompt)).toContain('Kids aged 4-7')
  })

  test('text_book: edited and approved chapters are skipped', () => {
    const graph = build('story', {
      chapters: [
        makeChapter(1, { status: 'edited' }),
        makeChapter(2, { status: 'approved' }),
        makeChapter(3, { status: 'draft' }),
      ],
    })
    const ids = graph.nodes.map((n) => n.id)
    expect(ids).not.toContain(`bk-${PROJECT_ID}-chapter-ch-1`)
    expect(ids).not.toContain(`bk-${PROJECT_ID}-chapter-ch-2`)
    expect(ids).toContain(`bk-${PROJECT_ID}-chapter-ch-3`)
  })

  test("puzzle format ('none' recipe) yields exactly brief + cover", () => {
    const graph = build('puzzle_sudoku', {
      pages: [makePage(1), makePage(2)],
      chapters: [makeChapter(1)],
    })
    expect(graph.nodes).toHaveLength(2)
    expect(graph.nodes.map((n) => n.id).sort()).toEqual([
      `bk-${PROJECT_ID}-brief`,
      `bk-${PROJECT_ID}-cover`,
    ])
    expect(graph.edges).toHaveLength(1)
  })

  test('no-content fallback: brief + cover only', () => {
    const graph = build('kids_picture')
    expect(graph.nodes).toHaveLength(2)
    expect(generationNodes(graph)).toHaveLength(1)
  })

  test('cap: 30 pages collapse to 24 generation nodes total including the cover', () => {
    const pages = Array.from({ length: 30 }, (_, i) => makePage(i + 1))
    const graph = build('kids_picture', { pages })
    expect(generationNodes(graph)).toHaveLength(24)
    // Lowest-order pages win the slots: pages 1..23 seeded, 24..30 dropped.
    const ids = graph.nodes.map((n) => n.id)
    expect(ids).toContain(`bk-${PROJECT_ID}-page-page-1`)
    expect(ids).toContain(`bk-${PROJECT_ID}-page-page-23`)
    expect(ids).not.toContain(`bk-${PROJECT_ID}-page-page-24`)
  })

  test('cap: 30 chapters collapse to 24 generation nodes total including the cover', () => {
    const chapters = Array.from({ length: 30 }, (_, i) => makeChapter(i + 1))
    const graph = build('story', { chapters })
    expect(generationNodes(graph)).toHaveLength(24)
  })

  test('orgId is stamped on every node and edge', () => {
    const graph = build('kids_picture', { pages: [makePage(1), makePage(2)] })
    for (const node of graph.nodes) expect(node.orgId).toBe(ORG_ID)
    for (const edge of graph.edges) expect(edge.orgId).toBe(ORG_ID)
    expect(graph.edges.length).toBeGreaterThan(0)
  })

  test('edge ids are unique and namespaced', () => {
    const graph = build('kids_picture', { pages: [makePage(1), makePage(2), makePage(3)] })
    const ids = graph.edges.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id.startsWith(`bk-${PROJECT_ID}-`)).toBe(true)
  })

  test('pages are seeded in ascending order regardless of input order', () => {
    const graph = build('kids_picture', { pages: [makePage(3), makePage(1), makePage(2)] })
    const pageNodes = graph.nodes.filter((n) => n.data.bookRole === 'page_illustration')
    expect(pageNodes.map((n) => n.data.bookPageId)).toEqual(['page-1', 'page-2', 'page-3'])
  })

  test('null format behaves like the none recipe (brief + cover)', () => {
    const graph = buildCanvasGraphFromBookProject({
      project: makeProject(),
      format: null,
      chapters: [makeChapter(1)],
      pages: [makePage(1)],
    })
    expect(graph.nodes).toHaveLength(2)
  })
})
