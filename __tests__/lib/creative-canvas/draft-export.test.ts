import {
  assertCanvasOutputCanExport,
  buildCreativeCanvasDraftExport,
} from '@/lib/creative-canvas/exporters/drafts'
import { buildCreativeCanvasExportPackage } from '@/lib/creative-canvas/exporters/package'
import type { CreativeCanvas, CreativeCanvasExport, CreativeCanvasNode } from '@/lib/creative-canvas/types'

const TARGETS: CreativeCanvasExport['target'][] = [
  'social_draft',
  'campaign_asset',
  'client_document',
  'blog_post',
  'research',
  'youtube_studio',
  'book_studio',
  'workspace_artifact',
]

function canvas(): CreativeCanvas & { id: string } {
  return {
    id: 'canvas-1',
    orgId: 'org-1',
    title: 'Launch Canvas',
    purpose: 'Product launch',
    status: 'draft',
    linked: {
      campaignId: 'campaign-1',
      clientDocumentId: 'doc-1',
      researchItemId: 'research-1',
      youtubeVideoProjectId: 'video-1',
      bookStudioProjectId: 'book-1',
      workspaceArtifactIds: ['artifact-1'],
    },
    activeVersion: 2,
    visibility: 'admin_agents',
    createdBy: 'user-1',
    createdByType: 'user',
    updatedBy: 'user-1',
    updatedByType: 'user',
    deleted: false,
    nodes: [],
    edges: [],
  }
}

function outputNode(overrides: Partial<CreativeCanvasNode> = {}): CreativeCanvasNode {
  return {
    id: 'output-1',
    orgId: 'org-1',
    type: 'output',
    title: 'Launch image',
    position: { x: 0, y: 0 },
    data: { caption: 'Launch caption' },
    review: {
      status: 'passed',
      rightsStatus: 'cleared',
      brandStatus: 'passed',
      syntheticMediaDisclosure: true,
    },
    output: {
      kind: 'image',
      artifactId: 'artifact-1',
      url: 'https://cdn.example.com/image.png',
      thumbnailUrl: 'https://cdn.example.com/thumb.png',
      textPreview: 'Launch caption',
    },
    ...overrides,
  }
}

describe('creative canvas generic draft exports', () => {
  it('builds draft export payloads for every supported target', () => {
    for (const target of TARGETS) {
      const draft = buildCreativeCanvasDraftExport({
        canvas: canvas(),
        node: outputNode(),
        target,
        actor: { uid: 'user-1', type: 'user' },
        lineageSourceNodeIds: ['source-1'],
        downstreamDraftId: `${target}-draft-1`,
      })

      expect(draft.exportRecord).toMatchObject({
        orgId: 'org-1',
        canvasId: 'canvas-1',
        nodeId: 'output-1',
        target,
        downstreamDraftId: `${target}-draft-1`,
        lineageSourceNodeIds: ['source-1'],
        outputNodeId: 'output-1',
        outputKind: 'image',
        reviewStatus: 'passed',
        status: 'drafted',
        createdBy: 'user-1',
        createdByType: 'user',
      })
      expect(draft.payload).toMatchObject({
        source: 'creative_canvas',
        status: 'internal_draft',
        target,
        sourceCanvasId: 'canvas-1',
        sourceNodeId: 'output-1',
        syntheticMedia: true,
      })
    }
  })

  it('requires category lineage for every world-class export target', () => {
    const targets = [
      ['social_draft', 'video_social'],
      ['campaign_asset', 'image'],
      ['client_document', 'blog_document'],
      ['blog_post', 'blog_document'],
      ['youtube_studio', 'video_social'],
      ['book_studio', 'book'],
      ['workspace_artifact', 'image'],
    ] as const

    for (const [target, categoryKey] of targets) {
      const exportRecord = buildCreativeCanvasDraftExport({
        canvas: canvas(),
        node: outputNode(),
        target,
        actor: { uid: 'user-1', type: 'user' },
        lineageSourceNodeIds: ['source-1', 'source-2'],
        downstreamDraftId: `${target}-draft-1`,
      }).exportRecord

      expect(exportRecord).toMatchObject({
        orgId: 'org-1',
        canvasId: 'canvas-1',
        nodeId: 'output-1',
        target,
        categoryKey,
        downstreamDraftId: `${target}-draft-1`,
        lineageSourceNodeIds: ['source-1', 'source-2'],
        status: 'drafted',
      })
    }
  })

  it('blocks cross-org and review-blocked exports', () => {
    expect(() => assertCanvasOutputCanExport(outputNode({ orgId: 'org-2' }), 'campaign_asset', 'org-1'))
      .toThrow('Creative canvas output does not belong to organisation')

    expect(() => assertCanvasOutputCanExport(outputNode({
      review: { status: 'blocked', rightsStatus: 'blocked', brandStatus: 'passed' },
    }), 'client_document', 'org-1')).toThrow('Creative canvas output is blocked by review state')
  })

  it('rejects missing lineage, missing downstream draft ids, unreviewed outputs, and unsafe urls', () => {
    const baseInput = {
      canvas: canvas(),
      node: outputNode(),
      target: 'campaign_asset' as const,
      actor: { uid: 'user-1', type: 'user' as const },
      lineageSourceNodeIds: ['source-1'],
      downstreamDraftId: 'draft-1',
    }

    expect(() => buildCreativeCanvasDraftExport({ ...baseInput, lineageSourceNodeIds: [] }))
      .toThrow('requires lineage source node ids')
    expect(() => buildCreativeCanvasDraftExport({ ...baseInput, downstreamDraftId: '' }))
      .toThrow('requires downstream draft id')
    expect(() => buildCreativeCanvasDraftExport({
      ...baseInput,
      node: outputNode({ review: { status: 'needed', rightsStatus: 'cleared', brandStatus: 'passed' } }),
    })).toThrow('must pass review before export')
    expect(() => buildCreativeCanvasDraftExport({
      ...baseInput,
      node: outputNode({ output: { ...outputNode().output!, url: 'javascript:alert(1)' } }),
    })).toThrow('unsafe url')

    expect(buildCreativeCanvasDraftExport({
      ...baseInput,
      node: outputNode({ review: { status: 'warning', rightsStatus: 'cleared', brandStatus: 'passed' } }),
    }).exportRecord.reviewStatus).toBe('warning')
  })

  it('adds module-specific draft metadata without enabling publishing', () => {
    const documentDraft = buildCreativeCanvasDraftExport({
      canvas: canvas(),
      node: outputNode({ output: { ...outputNode().output!, kind: 'document_block' } }),
      target: 'client_document',
      actor: { uid: 'agent:iris', type: 'agent' },
      lineageSourceNodeIds: ['source-1'],
      downstreamDraftId: 'doc-draft-1',
    })

    expect(documentDraft.payload).toMatchObject({
      target: 'client_document',
      status: 'internal_draft',
      clientVisible: false,
      publishEnabled: false,
      linked: { clientDocumentId: 'doc-1' },
    })
  })

  it('builds a guarded multi-asset package manifest', () => {
    const pack = buildCreativeCanvasExportPackage({
      canvas: {
        ...canvas(),
        nodes: [
          {
            id: 'source-1',
            orgId: 'org-1',
            type: 'source',
            title: 'Product reference',
            position: { x: 0, y: 0 },
            data: {},
          },
          outputNode({
            id: 'output-social',
            title: 'Social video',
            data: { downstreamDraftId: 'social-draft-1' },
            output: { ...outputNode().output!, kind: 'social_post_draft' },
          }),
          outputNode({ id: 'output-book', title: 'Book cover', output: { ...outputNode().output!, kind: 'book_artifact' } }),
        ],
        edges: [
          { id: 'edge-1', orgId: 'org-1', sourceNodeId: 'source-1', targetNodeId: 'output-social', label: 'reference' },
          { id: 'edge-2', orgId: 'org-1', sourceNodeId: 'source-1', targetNodeId: 'output-book', label: 'reference' },
        ],
      },
      nodeIds: ['output-social', 'output-book'],
      actor: { uid: 'user-1', type: 'user' },
    })

    expect(pack.exportRecord).toMatchObject({
      canvasId: 'canvas-1',
      nodeIds: ['output-social', 'output-book'],
      packageAssetCount: 2,
      target: 'workspace_artifact',
      status: 'drafted',
    })
    expect(pack.payload).toMatchObject({
      status: 'internal_package',
      assetCount: 2,
      readyAssetCount: 2,
      targets: ['social_draft', 'book_studio'],
      clientVisible: false,
      publishEnabled: false,
    })
    expect(pack.payload.manifest).toMatchObject({
      format: 'creative_canvas_export_package_manifest_v1',
      canvas: {
        id: 'canvas-1',
        title: 'Launch Canvas',
        activeVersion: 2,
        nodeCount: 3,
        edgeCount: 2,
      },
      review: {
        readyAssetCount: 2,
        blockedAssetCount: 0,
        needsReviewAssetCount: 0,
        syntheticMediaAssetCount: 2,
      },
      proof: {
        requiredOutputKinds: ['social_post_draft', 'book_artifact'],
        packageTargets: ['social_draft', 'book_studio'],
        sourceNodeIds: ['source-1'],
        outputNodeIds: ['output-social', 'output-book'],
        coveredCategories: ['video_social', 'book'],
        categoryCoverage: expect.arrayContaining([
          expect.objectContaining({ key: 'video_social', passed: true, assetNodeIds: ['output-social'] }),
          expect.objectContaining({ key: 'book', passed: true, assetNodeIds: ['output-book'] }),
          expect.objectContaining({ key: 'image', passed: false, assetNodeIds: [] }),
          expect.objectContaining({ key: 'audio', passed: false, assetNodeIds: [] }),
        ]),
      },
      lineage: [
        expect.objectContaining({
          outputNodeId: 'output-social',
          sourceNodeIds: ['source-1'],
          upstreamNodeIds: ['source-1'],
        }),
        expect.objectContaining({
          outputNodeId: 'output-book',
          sourceNodeIds: ['source-1'],
        }),
      ],
    })
    expect(pack.payload.downstreamDrafts).toEqual([
      expect.objectContaining({ target: 'social_draft', sourceNodeId: 'output-social', publishEnabled: false }),
      expect.objectContaining({ target: 'book_studio', sourceNodeId: 'output-book', publishEnabled: false }),
    ])
    expect(pack.payload.manifest.graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'source-1', type: 'source', title: 'Product reference' }),
      expect.objectContaining({ id: 'output-social', outputKind: 'social_post_draft', target: 'social_draft' }),
      expect.objectContaining({ id: 'output-book', outputKind: 'book_artifact', target: 'book_studio' }),
    ]))
    expect(pack.payload.manifest.graph.edges).toEqual([
      expect.objectContaining({ id: 'edge-1', sourceNodeId: 'source-1', targetNodeId: 'output-social' }),
      expect.objectContaining({ id: 'edge-2', sourceNodeId: 'source-1', targetNodeId: 'output-book' }),
    ])
    expect(pack.payload.guardrails.join(' ')).toContain('Do not publish')
  })

  it('rejects package exports when assets have no real downstream draft id', () => {
    expect(() => buildCreativeCanvasExportPackage({
      canvas: {
        ...canvas(),
        linked: {},
        nodes: [
          { id: 'source-1', orgId: 'org-1', type: 'source', title: 'Brand source', position: { x: 0, y: 0 }, data: {} },
          outputNode({ id: 'output-image', title: 'Campaign image', output: { ...outputNode().output!, kind: 'campaign_asset' } }),
        ],
        edges: [
          { id: 'edge-image', orgId: 'org-1', sourceNodeId: 'source-1', targetNodeId: 'output-image' },
        ],
      },
      actor: { uid: 'agent:maya', type: 'agent' },
    })).toThrow('Creative canvas draft export requires downstream draft id')
  })

  it('proves full export coverage for image, video/social, audio, blog/document, and book packages', () => {
    const pack = buildCreativeCanvasExportPackage({
      canvas: {
        ...canvas(),
        nodes: [
          { id: 'source-1', orgId: 'org-1', type: 'source', title: 'Brand source', position: { x: 0, y: 0 }, data: {} },
          outputNode({ id: 'output-image', title: 'Campaign image', output: { ...outputNode().output!, kind: 'campaign_asset' } }),
          outputNode({ id: 'output-social', title: 'Social video', output: { ...outputNode().output!, kind: 'youtube_render' } }),
          outputNode({ id: 'output-audio', title: 'Audio bed', output: { ...outputNode().output!, kind: 'audio' } }),
          outputNode({ id: 'output-blog', title: 'Blog section', output: { ...outputNode().output!, kind: 'blog_draft' } }),
          outputNode({ id: 'output-book', title: 'Book spread', output: { ...outputNode().output!, kind: 'book_artifact' } }),
        ],
        edges: [
          { id: 'edge-image', orgId: 'org-1', sourceNodeId: 'source-1', targetNodeId: 'output-image' },
          { id: 'edge-social', orgId: 'org-1', sourceNodeId: 'source-1', targetNodeId: 'output-social' },
          { id: 'edge-audio', orgId: 'org-1', sourceNodeId: 'source-1', targetNodeId: 'output-audio' },
          { id: 'edge-blog', orgId: 'org-1', sourceNodeId: 'source-1', targetNodeId: 'output-blog' },
          { id: 'edge-book', orgId: 'org-1', sourceNodeId: 'source-1', targetNodeId: 'output-book' },
        ],
      },
      actor: { uid: 'agent:maya', type: 'agent' },
    })

    expect(pack.payload.assetCount).toBe(5)
    expect(pack.payload.downstreamDrafts).toHaveLength(5)
    expect(pack.payload.manifest.proof.coveredCategories).toEqual(['image', 'video_social', 'audio', 'blog_document', 'book'])
    expect(pack.payload.manifest.proof.categoryCoverage).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'image', passed: true, assetNodeIds: ['output-image'] }),
      expect.objectContaining({ key: 'video_social', passed: true, assetNodeIds: ['output-social'] }),
      expect.objectContaining({ key: 'audio', passed: true, assetNodeIds: ['output-audio'] }),
      expect.objectContaining({ key: 'blog_document', passed: true, assetNodeIds: ['output-blog'] }),
      expect.objectContaining({ key: 'book', passed: true, assetNodeIds: ['output-book'] }),
    ]))
    expect(pack.exportRecords).toEqual(expect.arrayContaining([
      expect.objectContaining({ categoryKey: 'image', downstreamDraftId: 'campaign-1', lineageSourceNodeIds: ['source-1'], outputNodeId: 'output-image' }),
      expect.objectContaining({ categoryKey: 'audio', downstreamDraftId: 'campaign-1', lineageSourceNodeIds: ['source-1'], outputNodeId: 'output-audio' }),
      expect.objectContaining({ categoryKey: 'book', downstreamDraftId: 'book-1', lineageSourceNodeIds: ['source-1'], outputNodeId: 'output-book' }),
    ]))
    expect(pack.payload.manifest.lineage).toEqual(expect.arrayContaining([
      expect.objectContaining({ outputNodeId: 'output-image', sourceNodeIds: ['source-1'] }),
      expect.objectContaining({ outputNodeId: 'output-audio', sourceNodeIds: ['source-1'] }),
      expect.objectContaining({ outputNodeId: 'output-book', sourceNodeIds: ['source-1'] }),
    ]))
  })
})
