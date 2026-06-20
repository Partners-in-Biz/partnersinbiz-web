import { buildHiggsfieldExecutionManifest } from '@/lib/creative-canvas/higgsfield-execution'
import type { CreativeCanvas, CreativeCanvasRun } from '@/lib/creative-canvas/types'

describe('creative canvas Higgsfield execution manifest', () => {
  const run = {
    id: 'run-1',
    orgId: 'org-1',
    canvasId: 'canvas-1',
    nodeId: 'model-1',
    providerKey: 'higgsfield',
    model: 'nano_banana_flash',
    status: 'queued',
    input: {
      promptSummary: 'Create a vertical product demo video',
      sourceNodeIds: ['source-image', 'source-video'],
      sourceArtifactIds: ['artifact-1'],
      outputKind: 'video',
      operation: 'video_motion',
      aspectRatio: '9:16',
      durationSeconds: 6,
      variantCount: 2,
      stylePreset: 'ugc_social',
      cameraMotion: 'camera_push',
      negativePrompt: 'blurry, distorted hands',
    },
    provenance: {
      generatedBy: 'agent',
      agentId: 'maya',
      model: 'nano_banana_flash',
      promptStored: 'summary',
      syntheticMedia: true,
    },
  } as CreativeCanvasRun & { id: string }

  const canvas = {
    id: 'canvas-1',
    orgId: 'org-1',
    nodes: [
      {
        id: 'source-image',
        orgId: 'org-1',
        type: 'source',
        title: 'Product shot',
        position: { x: 0, y: 0 },
        data: {},
        source: {
          kind: 'upload',
          storagePath: '/tmp/product.png',
          mimeType: 'image/png',
          referenceRole: 'product',
        },
      },
      {
        id: 'source-video',
        orgId: 'org-1',
        type: 'source',
        title: 'Demo clip',
        position: { x: 0, y: 0 },
        data: {},
        source: {
          kind: 'upload',
          storagePath: '/tmp/demo.mp4',
          mimeType: 'video/mp4',
          referenceRole: 'motion',
        },
      },
    ],
  } as Pick<CreativeCanvas, 'id' | 'orgId' | 'nodes'>

  it('builds a Higgsfield CLI command and canvas lifecycle endpoints', () => {
    const manifest = buildHiggsfieldExecutionManifest(run, canvas)

    expect(manifest).toMatchObject({
      providerKey: 'higgsfield',
      cli: {
        command: 'higgsfield',
        args: expect.arrayContaining([
          'generate',
          'create',
          'nano_banana_flash',
          '--prompt',
          'Create a vertical product demo video',
          '--json',
          '--image',
          '/tmp/product.png',
          '--video',
          '/tmp/demo.mp4',
        ]),
      },
      dispatch: {
        method: 'PUT',
        path: '/api/v1/creative-canvas/canvas-1/runs/run-1/provider-dispatch?orgId=org-1',
      },
      statusRefresh: {
        method: 'PUT',
        path: '/api/v1/creative-canvas/canvas-1/runs/run-1/provider-status?orgId=org-1',
      },
      callback: {
        method: 'POST',
        path: '/api/v1/creative-canvas/provider-callbacks/higgsfield',
        requiredHeader: 'x-creative-canvas-provider-secret',
      },
      generationSettings: {
        outputKind: 'video',
        aspectRatio: '9:16',
        durationSeconds: 6,
      },
    })
    expect(manifest?.sourceMedia).toEqual([
      { nodeId: 'source-image', flag: '--image', value: '/tmp/product.png', role: 'product' },
      { nodeId: 'source-video', flag: '--video', value: '/tmp/demo.mp4', role: 'motion' },
    ])
    expect(manifest?.cli.display).toContain('higgsfield generate create nano_banana_flash --prompt')
    expect(manifest?.instructions.join('\n')).toContain('higgsfield model get nano_banana_flash --json')
    expect(manifest?.instructions.join('\n')).toContain('provider-status endpoint')
  })

  it('skips non-Higgsfield runs', () => {
    expect(buildHiggsfieldExecutionManifest({
      ...run,
      providerKey: 'agent_task',
    }, canvas)).toBeUndefined()
  })
})
