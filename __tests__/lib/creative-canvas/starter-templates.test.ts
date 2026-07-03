import { starterCanvasTemplates, getStarterCanvasTemplate } from '@/lib/creative-canvas/starter-templates'
import { getCanvasModel } from '@/lib/creative-canvas/model-registry'
import type { CreativeCanvasNodeType } from '@/lib/creative-canvas/types'

// Kept in sync with the `CreativeCanvasNodeType` union in lib/creative-canvas/types.ts.
const VALID_NODE_TYPES: CreativeCanvasNodeType[] = ['source', 'brief', 'prompt', 'model', 'edit', 'review', 'output']

test('there are at least 6 starter templates', () => {
  expect(starterCanvasTemplates.length).toBeGreaterThanOrEqual(6)
})

test('every starter template id is unique and namespaced with starter-', () => {
  const ids = starterCanvasTemplates.map((template) => template.id)
  expect(ids.every((id): id is string => typeof id === 'string' && id.startsWith('starter-'))).toBe(true)
  expect(new Set(ids).size).toBe(ids.length)
})

test('every starter template has a title, description, and category', () => {
  for (const template of starterCanvasTemplates) {
    expect(typeof template.title).toBe('string')
    expect(template.title.length).toBeGreaterThan(0)
    expect(typeof template.description).toBe('string')
    expect(template.description!.length).toBeGreaterThan(0)
    expect(template.category).toBe('starter')
  }
})

test('every node has an id, valid type, title, and position', () => {
  for (const template of starterCanvasTemplates) {
    expect(template.nodes.length).toBeGreaterThanOrEqual(3)
    expect(template.nodes.length).toBeLessThanOrEqual(7)
    for (const node of template.nodes) {
      expect(typeof node.id).toBe('string')
      expect(node.id.length).toBeGreaterThan(0)
      expect(VALID_NODE_TYPES).toContain(node.type)
      expect(typeof node.title).toBe('string')
      expect(node.title.length).toBeGreaterThan(0)
      expect(typeof node.position.x).toBe('number')
      expect(typeof node.position.y).toBe('number')
      expect(typeof node.data).toBe('object')
    }
  }
})

test('every node id is unique within its template', () => {
  for (const template of starterCanvasTemplates) {
    const ids = template.nodes.map((node) => node.id)
    expect(new Set(ids).size).toBe(ids.length)
  }
})

test('every provider.model referenced exists in the model registry', () => {
  for (const template of starterCanvasTemplates) {
    for (const node of template.nodes) {
      if (node.provider?.model) {
        const model = getCanvasModel(node.provider.model)
        expect(model).toBeTruthy()
      }
    }
  }
})

test('every edge references node ids that exist in the same template', () => {
  for (const template of starterCanvasTemplates) {
    const nodeIds = new Set(template.nodes.map((node) => node.id))
    expect(template.edges.length).toBeGreaterThan(0)
    for (const edge of template.edges) {
      expect(nodeIds.has(edge.sourceNodeId)).toBe(true)
      expect(nodeIds.has(edge.targetNodeId)).toBe(true)
    }
  }
})

test('every edit.references[].sourceNodeId points at a real node in the same template', () => {
  for (const template of starterCanvasTemplates) {
    const nodeIds = new Set(template.nodes.map((node) => node.id))
    for (const node of template.nodes) {
      for (const reference of node.edit?.references ?? []) {
        expect(nodeIds.has(reference.sourceNodeId)).toBe(true)
      }
    }
  }
})

test('getStarterCanvasTemplate resolves a known id and returns undefined for unknown ids', () => {
  const known = starterCanvasTemplates[0]
  expect(getStarterCanvasTemplate(known.id!)).toEqual(known)
  expect(getStarterCanvasTemplate('starter-does-not-exist')).toBeUndefined()
})

test('expected starter templates are present by title', () => {
  const titles = starterCanvasTemplates.map((template) => template.title)
  expect(titles).toEqual(
    expect.arrayContaining([
      'UGC product ad',
      'Product hero shot',
      'Blog + social pack',
      'YouTube short pipeline',
      'Brand carousel',
      'Podcast audiogram',
    ])
  )
})
