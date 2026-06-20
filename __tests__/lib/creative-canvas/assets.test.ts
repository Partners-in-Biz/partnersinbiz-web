import { buildCreativeCanvasAssetGallery } from '@/lib/creative-canvas/assets'
import type { CreativeCanvasNode, CreativeCanvasRun } from '@/lib/creative-canvas/types'

describe('creative canvas asset gallery', () => {
  it('summarizes source nodes, reviewed outputs, and run outputs', () => {
    const nodes: CreativeCanvasNode[] = [
      {
        id: 'source-1',
        orgId: 'org-1',
        type: 'source',
        title: 'Product bottle',
        position: { x: 0, y: 0 },
        data: {},
        source: {
          kind: 'upload',
          refId: 'upload-1',
          url: 'https://cdn.example.com/product.png',
          thumbnailUrl: 'https://cdn.example.com/product-thumb.png',
          altText: 'Product angle',
          referenceRole: 'product',
        },
      },
      {
        id: 'output-1',
        orgId: 'org-1',
        type: 'output',
        title: 'Approved launch video',
        position: { x: 300, y: 0 },
        data: {},
        review: {
          status: 'passed',
          rightsStatus: 'cleared',
          brandStatus: 'passed',
          syntheticMediaDisclosure: true,
        },
        output: {
          kind: 'video',
          url: 'https://cdn.example.com/launch.mp4',
          thumbnailUrl: 'https://cdn.example.com/launch.jpg',
          textPreview: 'Reviewed launch video',
        },
      },
    ]
    const runs = [{
      id: 'run-1',
      orgId: 'org-1',
      canvasId: 'canvas-1',
      nodeId: 'model-1',
      providerKey: 'higgsfield',
      status: 'completed',
      input: { sourceNodeIds: [], sourceArtifactIds: [], outputKind: 'image' },
      provenance: { generatedBy: 'agent', promptStored: 'summary', syntheticMedia: true },
      output: {
        outputNodeId: 'output-2',
        url: 'https://cdn.example.com/render.png',
        thumbnailUrl: 'https://cdn.example.com/render-thumb.png',
        textPreview: 'Generated render',
      },
    }] as Array<CreativeCanvasRun & { id: string }>

    const assets = buildCreativeCanvasAssetGallery({ nodes, runs })

    expect(assets).toEqual([
      expect.objectContaining({
        id: 'source:source-1',
        origin: 'source_node',
        title: 'Product bottle',
        sourceKind: 'upload',
        referenceRole: 'product',
        readyForExport: false,
      }),
      expect.objectContaining({
        id: 'output:output-1',
        origin: 'output_node',
        outputKind: 'video',
        readyForExport: true,
      }),
      expect.objectContaining({
        id: 'run:run-1',
        origin: 'run_output',
        providerKey: 'higgsfield',
        outputKind: 'image',
        readyForExport: true,
      }),
    ])
  })

  it('omits nodes and runs without asset payloads', () => {
    const assets = buildCreativeCanvasAssetGallery({
      nodes: [{
        id: 'output-empty',
        orgId: 'org-1',
        type: 'output',
        title: 'Empty output',
        position: { x: 0, y: 0 },
        data: {},
        output: { kind: 'image' },
      }],
      runs: [],
    })

    expect(assets).toEqual([])
  })
})
