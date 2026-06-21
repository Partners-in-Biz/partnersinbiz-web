import {
  sanitizeCreativeCanvasData,
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

  it('keeps bounded visual proof metadata on canvas input', () => {
    const input = sanitizeCreativeCanvasInput(
      {
        title: ' Launch Pack ',
        data: {
          visualProof: {
            desktop_1440: {
              screenshotUrl: ' https://proof.example.com/desktop.png ',
              notes: ' Graph, sources, and inspector are visible. ',
              capturedAt: '2026-06-20T10:00:00.000Z',
              capturedBy: 'Pip',
              signedIn: true,
              sessionEvidence: ' Signed-in admin header visible. ',
              viewportSize: ' 1440x900 ',
              visiblePanels: ' Graph, Sources, Inspector ',
            },
            empty: {},
          },
        },
      },
      'org-1',
      { uid: 'user-1', type: 'user' },
    )

    expect(input.data).toEqual({
      visualProof: {
        desktop_1440: {
          screenshotUrl: 'https://proof.example.com/desktop.png',
          notes: 'Graph, sources, and inspector are visible.',
          capturedAt: '2026-06-20T10:00:00.000Z',
          capturedBy: 'Pip',
          signedIn: true,
          sessionEvidence: 'Signed-in admin header visible.',
          viewportSize: '1440x900',
          visiblePanels: 'Graph, Sources, Inspector',
        },
      },
    })
  })

  it('sanitizes visual proof patches without accepting unrelated canvas metadata', () => {
    expect(sanitizeCreativeCanvasData({
      arbitrary: { value: true },
      visualProof: {
        mobile_390: {
          screenshotUrl: 'https://proof.example.com/mobile.png',
          notes: 'Mobile canvas is legible.',
          signedIn: false,
          sessionEvidence: 'Signed-in mobile header visible.',
          viewportSize: '390x844',
          visiblePanels: 'Canvas panel',
        },
      },
    })).toEqual({
      visualProof: {
        mobile_390: {
          screenshotUrl: 'https://proof.example.com/mobile.png',
          notes: 'Mobile canvas is legible.',
          capturedAt: undefined,
          capturedBy: undefined,
          signedIn: false,
          sessionEvidence: 'Signed-in mobile header visible.',
          viewportSize: '390x844',
          visiblePanels: 'Canvas panel',
        },
      },
    })
  })

  it('sanitizes direct benchmark proof patches', () => {
    expect(sanitizeCreativeCanvasData({
      benchmarkProof: {
        editing_ergonomics: {
          proofUrl: ' https://proof.example.com/editing.mp4 ',
          notes: ' Node editing, branching, and recovery were captured. ',
          capturedAt: '2026-06-20T11:00:00.000Z',
          capturedBy: 'Pip',
          sourceTitle: ' Higgsfield AI Canvas node workflow ',
          sourceUrl: ' https://higgsfield.ai/canvas-intro ',
          sourceCheckedAt: '2026-06-21T09:00:00.000Z',
          sourceSignals: [' Drop a node ', 'Chain your flow', 'Drop a node'],
          higgsfieldUiEvidenceUrl: ' https://higgsfield.ai/canvas-intro ',
          canvasEvidenceUrl: ' https://partnersinbiz.example.com/canvas#proof ',
          directComparisonAt: '2026-06-21T09:05:00.000Z',
          directComparisonVerdict: 'pass',
          directComparisonNotes: ' Direct comparison passed. ',
        },
        empty: {},
      },
    })).toEqual({
      benchmarkProof: {
        editing_ergonomics: {
          proofUrl: 'https://proof.example.com/editing.mp4',
          notes: 'Node editing, branching, and recovery were captured.',
          capturedAt: '2026-06-20T11:00:00.000Z',
          capturedBy: 'Pip',
          sourceTitle: 'Higgsfield AI Canvas node workflow',
          sourceUrl: 'https://higgsfield.ai/canvas-intro',
          sourceCheckedAt: '2026-06-21T09:00:00.000Z',
          sourceSignals: ['Drop a node', 'Chain your flow'],
          higgsfieldUiEvidenceUrl: 'https://higgsfield.ai/canvas-intro',
          canvasEvidenceUrl: 'https://partnersinbiz.example.com/canvas#proof',
          directComparisonAt: '2026-06-21T09:05:00.000Z',
          directComparisonVerdict: 'pass',
          directComparisonNotes: 'Direct comparison passed.',
        },
      },
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

  it('keeps visual source reference metadata for media workflows', () => {
    const graph = sanitizeCreativeCanvasGraph({
      nodes: [{
        id: 'source-1',
        type: 'source',
        title: 'Product reference',
        position: { x: 0, y: 0 },
        data: {},
        source: {
          kind: 'upload',
          refId: 'artifact-1',
          url: 'https://cdn.example.com/product.png',
          thumbnailUrl: 'https://cdn.example.com/product-thumb.png',
          previewUrl: 'https://cdn.example.com/product-preview.png',
          storagePath: 'org-1/canvas/product.png',
          mimeType: 'image/png',
          altText: 'Red product bottle',
          referenceRole: 'product',
          weight: 0.75,
        },
      }],
      edges: [],
    }, 'org-1')

    expect(graph.nodes[0].source).toMatchObject({
      kind: 'upload',
      refId: 'artifact-1',
      url: 'https://cdn.example.com/product.png',
      thumbnailUrl: 'https://cdn.example.com/product-thumb.png',
      previewUrl: 'https://cdn.example.com/product-preview.png',
      storagePath: 'org-1/canvas/product.png',
      mimeType: 'image/png',
      altText: 'Red product bottle',
      referenceRole: 'product',
      weight: 0.75,
    })
  })

  it('rejects unsafe source thumbnail and preview urls', () => {
    expect(() =>
      sanitizeCreativeCanvasGraph({
        nodes: [{
          id: 'source-1',
          type: 'source',
          title: 'Source',
          position: { x: 0, y: 0 },
          data: {},
          source: {
            kind: 'upload',
            thumbnailUrl: 'data:text/html,unsafe',
            previewUrl: 'javascript:alert(1)',
          },
        }],
        edges: [],
      }, 'org-1'),
    ).toThrow('node source-1 source.thumbnailUrl must be a safe http(s) URL')
  })

  it('keeps edit masks, references, strength, motion, and output intent', () => {
    const graph = sanitizeCreativeCanvasGraph({
      nodes: [{
        id: 'edit-1',
        type: 'edit',
        title: 'Studio background edit',
        position: { x: 120, y: 80 },
        data: {},
        edit: {
          operation: 'inpaint',
          intent: 'reference_blend',
          prompt: 'Replace background with a clean studio set',
          mask: {
            sourceNodeId: 'mask-source',
            url: 'https://cdn.example.com/mask.png',
            storagePath: 'org-1/masks/mask.png',
            invert: false,
            region: { x: 12, y: 18, width: 44, height: 52, unit: 'percent', feather: 6 },
            brush: {
              strokes: [{
                id: 'stroke-1',
                points: [{ x: 40, y: 44 }, { x: 45, y: 48 }],
                size: 9,
                opacity: 0.6,
                mode: 'paint',
                unit: 'percent',
              }],
            },
          },
          references: [
            { sourceNodeId: 'source-1', role: 'style', weight: 0.6 },
            { sourceNodeId: 'product-1', role: 'product', weight: 0.9 },
          ],
          strength: 0.65,
          blendControls: {
            lightMatch: true,
            textureAdaptive: true,
            autoShadows: true,
            perspectiveMatch: true,
            preserveSubject: false,
          },
          motion: { mode: 'camera_push', durationSeconds: 5 },
          outputKind: 'image',
        },
      }],
      edges: [],
    }, 'org-1')

    expect(graph.nodes[0].edit).toMatchObject({
      operation: 'inpaint',
      intent: 'reference_blend',
      prompt: 'Replace background with a clean studio set',
      mask: {
        sourceNodeId: 'mask-source',
        url: 'https://cdn.example.com/mask.png',
        storagePath: 'org-1/masks/mask.png',
        invert: false,
        region: { x: 12, y: 18, width: 44, height: 52, unit: 'percent', feather: 6 },
        brush: {
          strokes: [{
            id: 'stroke-1',
            points: [{ x: 40, y: 44 }, { x: 45, y: 48 }],
            size: 9,
            opacity: 0.6,
            mode: 'paint',
            unit: 'percent',
          }],
        },
      },
      references: [
        { sourceNodeId: 'source-1', role: 'style', weight: 0.6 },
        { sourceNodeId: 'product-1', role: 'product', weight: 0.9 },
      ],
      strength: 0.65,
      blendControls: {
        lightMatch: true,
        textureAdaptive: true,
        autoShadows: true,
        perspectiveMatch: true,
        preserveSubject: false,
      },
      motion: { mode: 'camera_push', durationSeconds: 5 },
      outputKind: 'image',
    })
  })

  it('rejects unsafe edit mask urls', () => {
    expect(() =>
      sanitizeCreativeCanvasGraph({
        nodes: [{
          id: 'edit-1',
          type: 'edit',
          title: 'Edit',
          position: { x: 0, y: 0 },
          data: {},
          edit: {
            operation: 'inpaint',
            mask: { url: 'javascript:alert(1)' },
          },
        }],
        edges: [],
      }, 'org-1'),
    ).toThrow('node edit-1 edit.mask.url must be a safe http(s) URL')
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
