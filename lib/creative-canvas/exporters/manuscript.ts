import type { CreativeCanvas, CreativeCanvasEdge, CreativeCanvasNode } from '../types'

export interface CreativeCanvasManuscriptSection {
  nodeId: string
  title: string
  text: string
}

export interface CreativeCanvasManuscript {
  title: string
  chapters: CreativeCanvasManuscriptSection[]
  characters: CreativeCanvasManuscriptSection[]
  manuscriptText: string
  chapterCount: number
  characterCount: number
  wordCount: number
  /**
   * True when the chapter→chapter edge chain was ambiguous (branches, cycles,
   * multiple roots, disconnected chains) and we fell back to insertion order.
   */
  orderingFallback: boolean
  warnings: string[]
}

function presentationTypeOf(node: CreativeCanvasNode): string | undefined {
  const value = (node.data as Record<string, unknown> | undefined)?.presentationType
  return typeof value === 'string' ? value : undefined
}

function textOf(node: CreativeCanvasNode): string {
  const value = (node.data as Record<string, unknown> | undefined)?.text
  return typeof value === 'string' ? value.trim() : ''
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

interface ChapterOrdering {
  ordered: CreativeCanvasNode[]
  orderingFallback: boolean
  warnings: string[]
}

/**
 * Order chapter nodes by following the chapter→chapter edge chain
 * (chapter-1 → chapter-2 → chapter-3, the "story so far" links).
 *
 * Rules:
 * - Only edges whose BOTH endpoints are non-empty chapter nodes count
 *   (character → chapter "character context" edges are ignored).
 * - The start chapter is the one with no incoming edge from another chapter.
 * - A clean chain must have exactly one start, at most one outgoing chapter
 *   edge per chapter, no cycles, and must visit every chapter.
 * - Anything else (branches, cycles, multiple roots, disconnected chains)
 *   falls back to insertion order in `canvas.nodes` with a warning.
 */
function orderChapters(chapterNodes: CreativeCanvasNode[], edges: CreativeCanvasEdge[]): ChapterOrdering {
  if (chapterNodes.length <= 1) {
    return { ordered: chapterNodes, orderingFallback: false, warnings: [] }
  }

  const chapterIds = new Set(chapterNodes.map((node) => node.id))
  const byId = new Map(chapterNodes.map((node) => [node.id, node]))
  const outgoing = new Map<string, Set<string>>()
  const incomingCount = new Map<string, number>()

  for (const edge of edges) {
    if (!chapterIds.has(edge.sourceNodeId) || !chapterIds.has(edge.targetNodeId)) continue
    if (edge.sourceNodeId === edge.targetNodeId) continue
    const targets = outgoing.get(edge.sourceNodeId) ?? new Set<string>()
    if (targets.has(edge.targetNodeId)) continue
    targets.add(edge.targetNodeId)
    outgoing.set(edge.sourceNodeId, targets)
    incomingCount.set(edge.targetNodeId, (incomingCount.get(edge.targetNodeId) ?? 0) + 1)
  }

  const fallback = (reason: string): ChapterOrdering => ({
    ordered: chapterNodes,
    orderingFallback: true,
    warnings: [`${reason}; falling back to board insertion order.`],
  })

  const starts = chapterNodes.filter((node) => !(incomingCount.get(node.id) ?? 0))
  if (starts.length !== 1) {
    return fallback(
      starts.length === 0
        ? 'Chapter chain has no start chapter (cycle detected)'
        : 'Chapter chain has multiple start chapters (disconnected or ambiguous chain)',
    )
  }

  const ordered: CreativeCanvasNode[] = []
  const visited = new Set<string>()
  let currentId: string | undefined = starts[0].id

  while (currentId) {
    if (visited.has(currentId)) return fallback('Chapter chain contains a cycle')
    visited.add(currentId)
    ordered.push(byId.get(currentId) as CreativeCanvasNode)
    const nextIds: string[] = Array.from(outgoing.get(currentId) ?? [])
    if (nextIds.length > 1) return fallback('Chapter chain branches into multiple next chapters')
    currentId = nextIds[0]
  }

  if (ordered.length !== chapterNodes.length) {
    return fallback('Chapter chain does not connect all chapters')
  }

  return { ordered, orderingFallback: false, warnings: [] }
}

/**
 * Compile a book board into a single manuscript. Book boards persist
 * Character/Chapter cards as backend `prompt` nodes carrying
 * `data.presentationType: 'character' | 'chapter'` with the copy in
 * `data.text`; chapters are chained by chapter→chapter edges.
 *
 * Throws when the board has zero non-empty chapters.
 */
export function buildCreativeCanvasManuscript(canvas: CreativeCanvas): CreativeCanvasManuscript {
  const nodes = canvas.nodes ?? []

  const chapterNodes = nodes.filter((node) => presentationTypeOf(node) === 'chapter' && textOf(node))
  if (!chapterNodes.length) {
    throw new Error('Creative canvas manuscript export requires at least one chapter node with text')
  }

  const characters: CreativeCanvasManuscriptSection[] = nodes
    .filter((node) => presentationTypeOf(node) === 'character' && textOf(node))
    .map((node, index) => ({
      nodeId: node.id,
      title: node.title?.trim() || `Character ${index + 1}`,
      text: textOf(node),
    }))

  const { ordered, orderingFallback, warnings } = orderChapters(chapterNodes, canvas.edges ?? [])

  const chapters: CreativeCanvasManuscriptSection[] = ordered.map((node, index) => ({
    nodeId: node.id,
    title: node.title?.trim() || `Chapter ${index + 1}`,
    text: textOf(node),
  }))

  const manuscriptText = chapters
    .map((chapter) => `## ${chapter.title}\n\n${chapter.text}`)
    .join('\n\n')

  return {
    title: canvas.title?.trim() || 'Untitled manuscript',
    chapters,
    characters,
    manuscriptText,
    chapterCount: chapters.length,
    characterCount: characters.length,
    wordCount: chapters.reduce((sum, chapter) => sum + countWords(chapter.text), 0),
    orderingFallback,
    warnings,
  }
}
