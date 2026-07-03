import { buildCreativeCanvasManuscript } from '@/lib/creative-canvas/exporters/manuscript'
import type { CreativeCanvas, CreativeCanvasEdge, CreativeCanvasNode } from '@/lib/creative-canvas/types'

function textNode(id: string, presentationType: 'character' | 'chapter', title: string, text: string): CreativeCanvasNode {
  return {
    id,
    orgId: 'org-1',
    type: 'prompt',
    title,
    position: { x: 0, y: 0 },
    data: { presentationType, text },
  } as CreativeCanvasNode
}

function edge(id: string, from: string, to: string): CreativeCanvasEdge {
  return { id, orgId: 'org-1', sourceNodeId: from, targetNodeId: to } as CreativeCanvasEdge
}

function canvasWith(nodes: CreativeCanvasNode[], edges: CreativeCanvasEdge[] = []): CreativeCanvas {
  return {
    orgId: 'org-1',
    title: 'My Book',
    status: 'draft',
    purpose: '',
    data: {},
    linked: {},
    activeVersion: 1,
    visibility: 'admin_agents',
    createdBy: 'u',
    createdByType: 'user',
    updatedBy: 'u',
    updatedByType: 'user',
    deleted: false,
    nodes,
    edges,
  } as CreativeCanvas
}

describe('buildCreativeCanvasManuscript', () => {
  it('orders chapters along the edge chain and assembles the manuscript', () => {
    const canvas = canvasWith([
      textNode('char-1', 'character', 'Mira', 'A wary cartographer'),
      // Insertion order deliberately scrambled vs chain order.
      textNode('ch-2', 'chapter', 'Chapter Two', 'The storm hits'),
      textNode('ch-1', 'chapter', 'Chapter One', 'Mira finds the map'),
      textNode('ch-3', 'chapter', 'Chapter Three', 'Landfall'),
    ], [
      edge('e1', 'char-1', 'ch-1'),
      edge('e2', 'ch-1', 'ch-2'),
      edge('e3', 'ch-2', 'ch-3'),
    ])

    const manuscript = buildCreativeCanvasManuscript(canvas)

    expect(manuscript.chapters.map((chapter) => chapter.nodeId)).toEqual(['ch-1', 'ch-2', 'ch-3'])
    expect(manuscript.orderingFallback).toBe(false)
    expect(manuscript.chapterCount).toBe(3)
    expect(manuscript.characterCount).toBe(1)
    expect(manuscript.manuscriptText).toContain('## Chapter One\n\nMira finds the map')
    expect(manuscript.manuscriptText.indexOf('Chapter One')).toBeLessThan(manuscript.manuscriptText.indexOf('Chapter Two'))
    expect(manuscript.wordCount).toBeGreaterThan(0)
    expect(manuscript.title).toBe('My Book')
  })

  it('falls back to insertion order when the chain branches', () => {
    const canvas = canvasWith([
      textNode('ch-1', 'chapter', 'One', 'a'),
      textNode('ch-2', 'chapter', 'Two', 'b'),
      textNode('ch-3', 'chapter', 'Three', 'c'),
    ], [
      edge('e1', 'ch-1', 'ch-2'),
      edge('e2', 'ch-1', 'ch-3'),
    ])

    const manuscript = buildCreativeCanvasManuscript(canvas)

    expect(manuscript.orderingFallback).toBe(true)
    expect(manuscript.warnings.length).toBeGreaterThan(0)
    expect(manuscript.chapters.map((chapter) => chapter.nodeId)).toEqual(['ch-1', 'ch-2', 'ch-3'])
  })

  it('falls back on cycles instead of looping forever', () => {
    const canvas = canvasWith([
      textNode('ch-1', 'chapter', 'One', 'a'),
      textNode('ch-2', 'chapter', 'Two', 'b'),
    ], [
      edge('e1', 'ch-1', 'ch-2'),
      edge('e2', 'ch-2', 'ch-1'),
    ])

    const manuscript = buildCreativeCanvasManuscript(canvas)
    expect(manuscript.orderingFallback).toBe(true)
  })

  it('ignores empty chapters and character edges when ordering', () => {
    const canvas = canvasWith([
      textNode('char-1', 'character', 'Mira', 'context'),
      textNode('ch-empty', 'chapter', 'Empty', '   '),
      textNode('ch-1', 'chapter', 'One', 'text'),
    ], [
      edge('e1', 'char-1', 'ch-1'),
    ])

    const manuscript = buildCreativeCanvasManuscript(canvas)
    expect(manuscript.chapterCount).toBe(1)
    expect(manuscript.chapters[0].nodeId).toBe('ch-1')
  })

  it('throws on a board with no non-empty chapters', () => {
    const canvas = canvasWith([textNode('char-1', 'character', 'Mira', 'context')])
    expect(() => buildCreativeCanvasManuscript(canvas)).toThrow(/at least one chapter/)
  })
})
