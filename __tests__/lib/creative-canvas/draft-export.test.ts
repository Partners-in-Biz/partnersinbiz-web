import {
  assertCanvasOutputCanExport,
  buildCreativeCanvasDraftExport,
} from '@/lib/creative-canvas/exporters/drafts'
import type { CreativeCanvas, CreativeCanvasExport, CreativeCanvasNode } from '@/lib/creative-canvas/types'

const TARGETS: CreativeCanvasExport['target'][] = [
  'social_draft',
  'campaign_asset',
  'client_document',
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
      })

      expect(draft.exportRecord).toMatchObject({
        orgId: 'org-1',
        canvasId: 'canvas-1',
        nodeId: 'output-1',
        target,
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

  it('blocks cross-org and review-blocked exports', () => {
    expect(() => assertCanvasOutputCanExport(outputNode({ orgId: 'org-2' }), 'campaign_asset', 'org-1'))
      .toThrow('Creative canvas output does not belong to organisation')

    expect(() => assertCanvasOutputCanExport(outputNode({
      review: { status: 'blocked', rightsStatus: 'blocked', brandStatus: 'passed' },
    }), 'client_document', 'org-1')).toThrow('Creative canvas output is blocked by review state')
  })

  it('adds module-specific draft metadata without enabling publishing', () => {
    const documentDraft = buildCreativeCanvasDraftExport({
      canvas: canvas(),
      node: outputNode({ output: { ...outputNode().output!, kind: 'document_block' } }),
      target: 'client_document',
      actor: { uid: 'agent:iris', type: 'agent' },
    })

    expect(documentDraft.payload).toMatchObject({
      target: 'client_document',
      status: 'internal_draft',
      clientVisible: false,
      publishEnabled: false,
      linked: { clientDocumentId: 'doc-1' },
    })
  })
})
