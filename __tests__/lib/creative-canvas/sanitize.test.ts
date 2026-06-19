import {
  sanitizeCreativeCanvasGraph,
  sanitizeCreativeCanvasInput,
} from '@/lib/creative-canvas/sanitize'

describe('creative canvas sanitizers', () => {
  it('normalizes a canvas input with org and actor metadata', () => {
    const input = sanitizeCreativeCanvasInput(
      { title: ' Launch Pack ', purpose: 'Product launch', visibility: 'admin_agents_clients' },
      'org-1',
      { uid: 'user-1', type: 'user' },
    )

    expect(input).toMatchObject({
      orgId: 'org-1',
      title: 'Launch Pack',
      purpose: 'Product launch',
      status: 'draft',
      visibility: 'admin_agents_clients',
      createdBy: 'user-1',
      createdByType: 'user',
      updatedBy: 'user-1',
      updatedByType: 'user',
      activeVersion: 1,
      deleted: false,
    })
  })

  it('rejects cross-org graph nodes before accepting their source data', () => {
    expect(() =>
      sanitizeCreativeCanvasGraph({
        nodes: [{
          id: 'source-1',
          orgId: 'other-org',
          type: 'source',
          title: 'Source',
          position: { x: 0, y: 0 },
          data: {},
          source: { kind: 'url', url: 'https://example.com/product' },
        }],
        edges: [],
      }, 'org-1'),
    ).toThrow('node source-1 does not belong to organisation')
  })

  it('rejects unsafe source urls', () => {
    expect(() =>
      sanitizeCreativeCanvasGraph({
        nodes: [{
          id: 'source-1',
          type: 'source',
          title: 'Source',
          position: { x: 0, y: 0 },
          data: {},
          source: { kind: 'url', url: 'javascript:alert(1)' },
        }],
        edges: [],
      }, 'org-1'),
    ).toThrow('node source-1 source.url must be a safe http(s) URL')
  })

  it('keeps graph nodes and edges tenant-scoped', () => {
    const graph = sanitizeCreativeCanvasGraph({
      nodes: [
        { id: 'source-1', type: 'source', title: 'Source', position: { x: 10, y: 20 }, data: { note: 'brief' } },
        { id: 'prompt-1', type: 'prompt', title: 'Prompt', position: { x: 300, y: 20 }, data: { promptSummary: 'Create a launch image' } },
      ],
      edges: [{ id: 'edge-1', sourceNodeId: 'source-1', targetNodeId: 'prompt-1', label: 'context' }],
    }, 'org-1')

    expect(graph.nodes).toHaveLength(2)
    expect(graph.nodes[0]).toMatchObject({ orgId: 'org-1', type: 'source' })
    expect(graph.edges[0]).toMatchObject({ orgId: 'org-1', sourceNodeId: 'source-1', targetNodeId: 'prompt-1' })
  })

  it('rejects graph edges that point to missing nodes', () => {
    expect(() =>
      sanitizeCreativeCanvasGraph({
        nodes: [{ id: 'source-1', type: 'source', title: 'Source', position: { x: 0, y: 0 }, data: {} }],
        edges: [{ id: 'edge-1', sourceNodeId: 'source-1', targetNodeId: 'missing-node' }],
      }, 'org-1'),
    ).toThrow('edge edge-1 targetNodeId does not exist in graph')
  })
})
