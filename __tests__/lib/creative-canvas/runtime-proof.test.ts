import { buildCreativeCanvasRuntimeProof } from '@/lib/creative-canvas/runtime-proof'
import type { CreativeCanvas, CreativeCanvasRun } from '@/lib/creative-canvas/types'

const canvas = {
  id: 'canvas-1',
  orgId: 'org-1',
  title: 'Launch Canvas',
  status: 'draft',
  purpose: 'Product launch',
  linked: { projectId: 'project-1' },
  activeVersion: 1,
  visibility: 'admin_agents',
  createdBy: 'agent:maya',
  createdByType: 'agent',
  updatedBy: 'agent:maya',
  updatedByType: 'agent',
  deleted: false,
  nodes: [
    {
      id: 'source-1',
      orgId: 'org-1',
      type: 'source',
      title: 'Product source',
      position: { x: 0, y: 0 },
      data: {},
      source: { kind: 'upload', url: 'https://cdn.example.com/source.png', referenceRole: 'product' },
    },
    {
      id: 'model-1',
      orgId: 'org-1',
      type: 'model',
      title: 'Higgsfield render',
      position: { x: 240, y: 0 },
      data: {},
      provider: { key: 'higgsfield', model: 'nano_banana_flash' },
    },
    {
      id: 'output-1',
      orgId: 'org-1',
      type: 'output',
      title: 'Approved output',
      position: { x: 480, y: 0 },
      data: { exportTarget: 'social_draft' },
      review: {
        status: 'passed',
        rightsStatus: 'cleared',
        brandStatus: 'passed',
        syntheticMediaDisclosure: true,
      },
      output: { kind: 'social_post_draft', url: 'https://cdn.example.com/output.mp4', textPreview: 'Ready draft' },
    },
  ],
  edges: [
    { id: 'source-model', orgId: 'org-1', sourceNodeId: 'source-1', targetNodeId: 'model-1' },
    { id: 'model-output', orgId: 'org-1', sourceNodeId: 'model-1', targetNodeId: 'output-1' },
  ],
} satisfies CreativeCanvas & { id: string }

const completedRun = {
  id: 'run-1',
  orgId: 'org-1',
  canvasId: 'canvas-1',
  nodeId: 'model-1',
  providerKey: 'higgsfield',
  status: 'completed',
  input: { sourceNodeIds: ['source-1'], sourceArtifactIds: [], outputKind: 'social_post_draft' },
  provenance: { generatedBy: 'agent', promptStored: 'summary', syntheticMedia: true, providerJobId: 'hf-job-1' },
  output: { outputNodeId: 'output-1', url: 'https://cdn.example.com/output.mp4' },
} satisfies CreativeCanvasRun & { id: string }

describe('creative canvas runtime proof', () => {
  it('passes when canvas has project linkage, runtime readiness, completed run, healthy queue, and exportable output', () => {
    const proof = buildCreativeCanvasRuntimeProof({
      canvas,
      runs: [completedRun],
      env: {
        HIGGSFIELD_RUNTIME_API_KEY: 'runtime-key',
        NEXT_PUBLIC_APP_URL: 'https://partnersinbiz.online',
        HIGGSFIELD_WEBHOOK_SECRET: 'hook-secret',
      } as NodeJS.ProcessEnv,
    })

    expect(proof).toMatchObject({
      status: 'passed',
      readyForLiveProof: true,
      checks: expect.arrayContaining([
        expect.objectContaining({ id: 'project_link', status: 'passed' }),
        expect.objectContaining({ id: 'runtime_readiness', status: 'passed' }),
        expect.objectContaining({ id: 'provider_runs', status: 'passed' }),
        expect.objectContaining({ id: 'output_assets', status: 'passed' }),
      ]),
    })
  })

  it('blocks proof when runtime, project, runs, and output evidence are missing', () => {
    const proof = buildCreativeCanvasRuntimeProof({
      canvas: { ...canvas, linked: {}, nodes: [], edges: [] },
      runs: [],
      env: {} as NodeJS.ProcessEnv,
    })

    expect(proof.status).toBe('blocked')
    expect(proof.readyForLiveProof).toBe(false)
    expect(proof.summary).toContain('blockers')
    expect(proof.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'project_link', status: 'blocked' }),
      expect.objectContaining({ id: 'runtime_readiness', status: 'blocked' }),
      expect.objectContaining({ id: 'provider_runs', status: 'blocked' }),
      expect.objectContaining({ id: 'output_assets', status: 'blocked' }),
    ]))
  })
})
