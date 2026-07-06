import type {
  CreativeCanvasEdge,
  CreativeCanvasGraph,
  CreativeCanvasNode,
} from '@/lib/creative-canvas/types'
import type { BookFormat } from '@/lib/book-studio/format-registry'
import type { BookStudioRecord } from '@/lib/book-studio/types'

// ---------------------------------------------------------------------------
// Book Studio → Creative Canvas graph builder (Task 9).
//
// Seeds a canvas from a book project + its chapters/pages so the canvas can
// act as the production engine for the book (mirrors the YouTube Studio
// bridge in lib/youtube-studio/canvas-bridge.ts). Node/edge conventions follow
// lib/creative-canvas/starter-templates.ts:
//
//   * image generators are `type: 'model'` with `provider: { key: 'higgsfield', … }`
//   * copy generators are `type: 'model'` with `provider: { key: 'agent_task',
//     model: 'agent-llm' }` (same shape as the starter blog/email templates)
//   * every generation node is tagged `edit.outputKind: 'book_artifact'` so
//     downstream artifact routing can pick book outputs out of the run stream
//
// Pure & deterministic: no Firestore, no env, no Date/random. Node ids are
// `bk-<projectId>-…` so re-seeding is idempotent (the open-in-canvas route
// relies on this).
// ---------------------------------------------------------------------------

/**
 * Default image model — Soul 2.0 text-to-image (`text2image_soul_v2`), the
 * canvas registry's default/near-free Higgsfield-native image model (same one
 * the starter templates use for image generation).
 */
const IMAGE_MODEL = 'text2image_soul_v2'
const IMAGE_PROVIDER_KEY = 'higgsfield' as const
/**
 * Copy/prose model — the platform LLM assistant, executed inline as an
 * `agent_task` (same provider shape as the starter blog-draft / subject-line
 * nodes). Never a BYOK-only model.
 */
const COPY_MODEL = 'agent-llm'
const COPY_PROVIDER_KEY = 'agent_task' as const

const IMAGE_OWNER_AGENT_ID = 'maya'
const COPY_OWNER_AGENT_ID = 'pip'

/**
 * Hard cap on seeded generation nodes (cover INCLUDED) so pathological books
 * (hundreds of pages) can't explode the graph.
 */
const MAX_GENERATION_NODES = 24

const COL = 320
const ROW = 220
const COL_BRIEF = 0
const COL_GENERATOR = COL

/** Colouring-book line-art prompt prefix (KDP-safe: no grey fills). */
const COLOURING_PREFIX = 'Black and white line art for a colouring book page, clean bold outlines, no shading, no grey fill: '
const COMIC_PREFIX = 'Comic book page art: '

export interface BookCanvasChapter {
  id: string
  title?: string
  order?: number
  status?: string
}

export interface BookCanvasPage {
  id: string
  title?: string
  order?: number
  prompt?: string
  caption?: string
  imageUrl?: string
}

export interface BookCanvasSeedInput {
  project: BookStudioRecord & { id: string }
  format: BookFormat | null
  chapters: BookCanvasChapter[]
  pages: BookCanvasPage[]
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function byOrderAsc<T extends { order?: number; id: string }>(a: T, b: T): number {
  const orderDelta = (a.order ?? 0) - (b.order ?? 0)
  if (orderDelta !== 0) return orderDelta
  // Stable tie-break on id so equal orders can't reshuffle between calls.
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

function briefText(input: BookCanvasSeedInput): string {
  const { project, format } = input
  const parts: string[] = []
  const title = cleanText(project.title)
  if (title) parts.push(`Title: ${title}`)
  if (format) parts.push(`Format: ${format.label}`)
  const audience = cleanText(project.audience)
  if (audience) parts.push(`Audience: ${audience}`)
  const stylePrompt = cleanText(project.stylePrompt)
  if (stylePrompt) parts.push(`Style: ${stylePrompt}`)
  return parts.join('\n').trim() || 'Book project brief.'
}

function coverPrompt(input: BookCanvasSeedInput): string {
  const { project, format } = input
  const title = cleanText(project.title) || 'Untitled book'
  const parts: string[] = [`Book cover for "${title}".`]
  switch (format?.canvasRecipe) {
    case 'picture_book':
      parts.push("Children's picture book cover illustration, warm and inviting.")
      break
    case 'colouring_book':
      parts.push('Playful colouring book cover, bold friendly artwork.')
      break
    case 'comic_book':
      parts.push('Comic book cover art, dynamic composition.')
      break
    case 'text_book':
      parts.push(`Professional ${format.label.toLowerCase()} book cover design with strong typography.`)
      break
    default:
      if (format) parts.push(`${format.label} cover design.`)
      break
  }
  const stylePrompt = cleanText(input.project.stylePrompt)
  if (stylePrompt) parts.push(stylePrompt)
  return parts.join(' ')
}

function pageIllustrationPrompt(input: BookCanvasSeedInput, page: BookCanvasPage): string {
  const recipe = input.format?.canvasRecipe
  const base = cleanText(page.prompt)
    || cleanText(page.caption)
    || `Illustration for page ${page.order ?? 0}`
  const stylePrompt = cleanText(input.project.stylePrompt)
  const styled = [stylePrompt, base].filter(Boolean).join(' ')
  if (recipe === 'colouring_book') return `${COLOURING_PREFIX}${styled}`
  if (recipe === 'comic_book') return `${COMIC_PREFIX}${styled}`
  return styled
}

function chapterCopyPrompt(input: BookCanvasSeedInput, chapter: BookCanvasChapter): string {
  const { project } = input
  const chapterTitle = cleanText(chapter.title) || `Chapter ${chapter.order ?? 0}`
  const bookTitle = cleanText(project.title) || 'Untitled book'
  const parts: string[] = [`Write the full prose for chapter "${chapterTitle}" of "${bookTitle}".`]
  const audience = cleanText(project.audience)
  if (audience) parts.push(`Audience: ${audience}.`)
  const stylePrompt = cleanText(project.stylePrompt)
  if (stylePrompt) parts.push(`Style: ${stylePrompt}.`)
  return parts.join(' ')
}

/** text_book only seeds chapters that still need prose (draft/generated/unset). */
function chapterNeedsProse(chapter: BookCanvasChapter): boolean {
  return chapter.status === undefined || chapter.status === 'draft' || chapter.status === 'generated'
}

function imageGenerationNode(args: {
  id: string
  orgId: string
  title: string
  y: number
  prompt: string
  briefId: string
  data: Record<string, unknown>
}): CreativeCanvasNode {
  return {
    id: args.id,
    orgId: args.orgId,
    type: 'model',
    title: args.title,
    position: { x: COL_GENERATOR, y: args.y },
    data: {
      workflowRole: 'generation',
      ownerAgentId: IMAGE_OWNER_AGENT_ID,
      outputKind: 'book_artifact',
      ...args.data,
    },
    provider: { key: IMAGE_PROVIDER_KEY, model: IMAGE_MODEL, mode: 'book_illustration' },
    edit: {
      operation: 'variation',
      outputKind: 'book_artifact',
      prompt: args.prompt,
      references: [{ sourceNodeId: args.briefId, role: 'general', weight: 1 }],
    },
  }
}

export function buildCanvasGraphFromBookProject(input: BookCanvasSeedInput): CreativeCanvasGraph {
  const { project, format } = input
  const orgId = project.orgId
  const projectId = project.id
  const idPrefix = `bk-${projectId}`

  const nodes: CreativeCanvasNode[] = []
  const edges: CreativeCanvasEdge[] = []

  const briefId = `${idPrefix}-brief`
  nodes.push({
    id: briefId,
    orgId,
    type: 'brief',
    title: 'Book brief',
    position: { x: COL_BRIEF, y: 0 },
    data: {
      workflowRole: 'prompt',
      agentId: COPY_OWNER_AGENT_ID,
      promptType: 'book_brief',
      prompt: briefText(input),
    },
  })

  // Cover is always seeded and always counts against the generation cap.
  const coverId = `${idPrefix}-cover`
  nodes.push(imageGenerationNode({
    id: coverId,
    orgId,
    title: 'Book cover',
    y: 0,
    prompt: coverPrompt(input),
    briefId,
    data: { bookRole: 'cover' },
  }))
  edges.push({ id: `${idPrefix}-edge-brief-cover`, orgId, sourceNodeId: briefId, targetNodeId: coverId, label: 'cover' })

  let remaining = MAX_GENERATION_NODES - 1 // cover already used one slot
  const recipe = format?.canvasRecipe ?? 'none'

  if (recipe === 'picture_book' || recipe === 'colouring_book' || recipe === 'comic_book') {
    const pendingPages = [...input.pages]
      .sort(byOrderAsc)
      .filter((page) => !cleanText(page.imageUrl))
      .slice(0, remaining)

    pendingPages.forEach((page, index) => {
      const nodeId = `${idPrefix}-page-${page.id}`
      nodes.push(imageGenerationNode({
        id: nodeId,
        orgId,
        title: `Page ${page.order ?? index + 1} illustration`,
        y: (index + 1) * ROW,
        prompt: pageIllustrationPrompt(input, page),
        briefId,
        data: { bookRole: 'page_illustration', bookPageId: page.id },
      }))
      edges.push({
        id: `${idPrefix}-edge-brief-page-${page.id}`,
        orgId,
        sourceNodeId: briefId,
        targetNodeId: nodeId,
        label: 'illustration',
      })
    })
    remaining -= pendingPages.length
  } else if (recipe === 'text_book') {
    const pendingChapters = [...input.chapters]
      .sort(byOrderAsc)
      .filter(chapterNeedsProse)
      .slice(0, remaining)

    pendingChapters.forEach((chapter, index) => {
      const nodeId = `${idPrefix}-chapter-${chapter.id}`
      nodes.push({
        id: nodeId,
        orgId,
        type: 'model',
        title: cleanText(chapter.title) || `Chapter ${chapter.order ?? index + 1}`,
        position: { x: COL_GENERATOR, y: (index + 1) * ROW },
        data: {
          workflowRole: 'generation',
          ownerAgentId: COPY_OWNER_AGENT_ID,
          outputKind: 'book_artifact',
          bookRole: 'chapter_text',
          bookChapterId: chapter.id,
        },
        provider: { key: COPY_PROVIDER_KEY, model: COPY_MODEL, mode: 'chapter_prose' },
        edit: {
          operation: 'variation',
          outputKind: 'book_artifact',
          prompt: chapterCopyPrompt(input, chapter),
          references: [{ sourceNodeId: briefId, role: 'general', weight: 1 }],
        },
      })
      edges.push({
        id: `${idPrefix}-edge-brief-chapter-${chapter.id}`,
        orgId,
        sourceNodeId: briefId,
        targetNodeId: nodeId,
        label: 'prose',
      })
    })
    remaining -= pendingChapters.length
  }
  // recipe 'none' (puzzle/activity formats) → brief + cover only; puzzle
  // interiors are generated deterministically by lib/book-studio/puzzles,
  // never by canvas models.

  return { nodes, edges }
}
