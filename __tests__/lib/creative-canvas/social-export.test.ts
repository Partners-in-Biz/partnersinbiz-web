import {
  assertCanvasOutputCanExportToSocial,
  buildSocialDraftFromCanvasOutput,
} from '@/lib/creative-canvas/exporters/social'
import type { CreativeCanvasNode } from '@/lib/creative-canvas/types'

function outputNode(overrides: Partial<CreativeCanvasNode> = {}): CreativeCanvasNode {
  return {
    id: 'output-1',
    orgId: 'org-1',
    type: 'output',
    title: 'Output',
    position: { x: 0, y: 0 },
    data: { caption: 'Launch copy' },
    review: {
      status: 'passed',
      syntheticMediaDisclosure: true,
      rightsStatus: 'cleared',
      brandStatus: 'passed',
    },
    output: {
      kind: 'image',
      artifactId: 'artifact-1',
      url: 'https://example.com/image.png',
      thumbnailUrl: 'https://example.com/thumb.png',
      textPreview: 'Launch copy',
    },
    ...overrides,
  }
}

describe('creative canvas social export guard', () => {
  it('blocks outputs with blocked review state', () => {
    expect(() =>
      assertCanvasOutputCanExportToSocial(outputNode({
        review: { status: 'blocked', rightsStatus: 'blocked', brandStatus: 'passed' },
      })),
    ).toThrow('Creative canvas output is blocked by review state')
  })

  it('blocks nodes without output payloads', () => {
    const node = outputNode()
    delete node.output
    expect(() => assertCanvasOutputCanExportToSocial(node)).toThrow('Creative canvas node has no output payload')
  })

  it('blocks cross-org export attempts', () => {
    expect(() =>
      buildSocialDraftFromCanvasOutput({
        orgId: 'org-2',
        canvasId: 'canvas-1',
        node: outputNode(),
        platforms: ['instagram'],
      }),
    ).toThrow('Creative canvas output does not belong to organisation')
  })

  it('builds a draft social payload with canvas provenance', () => {
    const payload = buildSocialDraftFromCanvasOutput({
      orgId: 'org-1',
      canvasId: 'canvas-1',
      node: outputNode(),
      platforms: ['instagram', 'linkedin'],
      caption: 'Custom caption',
      hashtags: ['#Launch'],
    })

    expect(payload).toMatchObject({
      orgId: 'org-1',
      status: 'draft',
      platforms: ['instagram', 'linkedin'],
      content: {
        text: 'Custom caption',
      },
      media: [{
        mediaId: 'artifact-1',
        url: 'https://example.com/image.png',
        type: 'image',
        thumbnailUrl: 'https://example.com/thumb.png',
        sourceCanvasId: 'canvas-1',
        sourceNodeId: 'output-1',
        syntheticMedia: true,
      }],
      hashtags: ['#Launch'],
      source: 'creative_canvas',
      contextRefs: [{
        type: 'creative_canvas',
        id: 'canvas-1',
        label: 'Creative Canvas',
      }],
    })
  })
})
