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

function completedRunFor(id: string, outputKind: NonNullable<CreativeCanvasRun['input']['outputKind']>) {
  return {
    ...completedRun,
    id,
    input: { ...completedRun.input, outputKind },
    output: { outputNodeId: 'output-1', url: `https://cdn.example.com/${id}.png` },
  } satisfies CreativeCanvasRun & { id: string }
}

describe('creative canvas runtime proof', () => {
  it('passes when canvas has project linkage, runtime readiness, repeated jobs, healthy queue, and exportable output', () => {
    const proof = buildCreativeCanvasRuntimeProof({
      canvas,
      runs: [
        completedRunFor('run-image-1', 'image'),
        completedRunFor('run-image-2', 'campaign_asset'),
        completedRunFor('run-video-1', 'video'),
        completedRunFor('run-social-1', 'social_post_draft'),
        completedRunFor('run-blog-1', 'blog_draft'),
        completedRunFor('run-document-1', 'document_block'),
        completedRunFor('run-book-1', 'book_artifact'),
        completedRunFor('run-book-2', 'book_artifact'),
      ],
      env: {
        HIGGSFIELD_RUNTIME_API_KEY: 'runtime-key',
        NEXT_PUBLIC_APP_URL: 'https://partnersinbiz.online',
        HIGGSFIELD_WEBHOOK_SECRET: 'hook-secret',
      } as NodeJS.ProcessEnv,
    })

    expect(proof).toMatchObject({
      status: 'passed',
      readyForLiveProof: true,
      reliabilityCoverage: expect.arrayContaining([
        expect.objectContaining({ key: 'image', status: 'passed', completed: 2 }),
        expect.objectContaining({ key: 'video_social', status: 'passed', completed: 2 }),
        expect.objectContaining({ key: 'blog_document', status: 'passed', completed: 2 }),
        expect.objectContaining({ key: 'book', status: 'passed', completed: 2 }),
      ]),
      checks: expect.arrayContaining([
        expect.objectContaining({ id: 'project_link', status: 'passed' }),
        expect.objectContaining({ id: 'runtime_readiness', status: 'passed' }),
        expect.objectContaining({ id: 'provider_runs', status: 'passed' }),
        expect.objectContaining({ id: 'output_assets', status: 'passed' }),
        expect.objectContaining({ id: 'repeated_job_coverage', status: 'passed' }),
        expect.objectContaining({ id: 'repeated_job_reliability', status: 'passed' }),
      ]),
    })
  })

  it('blocks when only part of the repeated creative job mix has completed', () => {
    const proof = buildCreativeCanvasRuntimeProof({
      canvas,
      runs: [
        completedRunFor('run-image-1', 'image'),
        completedRunFor('run-video-1', 'video'),
        { ...completedRunFor('run-book-failed', 'book_artifact'), status: 'failed' },
        { ...completedRunFor('run-blog-active', 'blog_draft'), status: 'running' },
      ],
      env: {
        HIGGSFIELD_RUNTIME_API_KEY: 'runtime-key',
        NEXT_PUBLIC_APP_URL: 'https://partnersinbiz.online',
        HIGGSFIELD_WEBHOOK_SECRET: 'hook-secret',
      } as NodeJS.ProcessEnv,
    })

    expect(proof.status).toBe('blocked')
    expect(proof.readyForLiveProof).toBe(false)
    expect(proof.reliabilityCoverage).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'image', status: 'warning', completed: 1, requiredCompleted: 2 }),
      expect.objectContaining({ key: 'video_social', status: 'warning', completed: 1, requiredCompleted: 2 }),
      expect.objectContaining({ key: 'blog_document', status: 'warning', active: 1 }),
      expect.objectContaining({ key: 'book', status: 'blocked', failed: 1 }),
    ]))
    expect(proof.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'repeated_job_coverage', status: 'blocked' }),
      expect.objectContaining({ id: 'repeated_job_reliability', status: 'warning' }),
    ]))
  })

  it('does not pass repeated-job reliability until eight jobs are completed and the queue is drained', () => {
    const proof = buildCreativeCanvasRuntimeProof({
      canvas,
      runs: [
        completedRunFor('run-image-1', 'image'),
        completedRunFor('run-image-2', 'campaign_asset'),
        completedRunFor('run-video-1', 'video'),
        completedRunFor('run-social-1', 'social_post_draft'),
        { ...completedRunFor('run-blog-active-1', 'blog_draft'), status: 'running' },
        { ...completedRunFor('run-document-active-1', 'document_block'), status: 'queued' },
        { ...completedRunFor('run-book-active-1', 'book_artifact'), status: 'waiting_for_review' },
        { ...completedRunFor('run-book-active-2', 'book_artifact'), status: 'running' },
      ],
      env: {
        HIGGSFIELD_RUNTIME_API_KEY: 'runtime-key',
        NEXT_PUBLIC_APP_URL: 'https://partnersinbiz.online',
        HIGGSFIELD_WEBHOOK_SECRET: 'hook-secret',
      } as NodeJS.ProcessEnv,
    })

    expect(proof.readyForLiveProof).toBe(false)
    expect(proof.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'repeated_job_reliability',
        status: 'warning',
        evidence: '8 total runs, 4 completed, 4 active, 0 failed, 0% completed-job failure rate, 0 stale active.',
        nextAction: 'Complete at least 2 creative jobs in each category, 8 total, with <=10% failures and no active or stale runs.',
      }),
    ]))
  })

  it('does not pass when eight completed jobs are unevenly distributed across categories', () => {
    const proof = buildCreativeCanvasRuntimeProof({
      canvas,
      runs: [
        completedRunFor('run-image-1', 'image'),
        completedRunFor('run-image-2', 'campaign_asset'),
        completedRunFor('run-image-3', 'image'),
        completedRunFor('run-video-1', 'video'),
        completedRunFor('run-video-2', 'social_post_draft'),
        completedRunFor('run-blog-1', 'blog_draft'),
        completedRunFor('run-book-1', 'book_artifact'),
        completedRunFor('run-book-2', 'book_artifact'),
      ],
      env: {
        HIGGSFIELD_RUNTIME_API_KEY: 'runtime-key',
        NEXT_PUBLIC_APP_URL: 'https://partnersinbiz.online',
        HIGGSFIELD_WEBHOOK_SECRET: 'hook-secret',
      } as NodeJS.ProcessEnv,
    })

    expect(proof.readyForLiveProof).toBe(false)
    expect(proof.reliabilityCoverage).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'blog_document', status: 'warning', completed: 1, requiredCompleted: 2 }),
    ]))
    expect(proof.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'repeated_job_coverage',
        status: 'warning',
      }),
      expect.objectContaining({
        id: 'repeated_job_reliability',
        status: 'warning',
      }),
    ]))
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
    expect(proof.reliabilityCoverage).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'image', status: 'blocked', total: 0 }),
      expect.objectContaining({ key: 'video_social', status: 'blocked', total: 0 }),
      expect.objectContaining({ key: 'blog_document', status: 'blocked', total: 0 }),
      expect.objectContaining({ key: 'book', status: 'blocked', total: 0 }),
    ]))
    expect(proof.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'project_link', status: 'blocked' }),
      expect.objectContaining({ id: 'runtime_readiness', status: 'blocked' }),
      expect.objectContaining({ id: 'provider_runs', status: 'blocked' }),
      expect.objectContaining({ id: 'output_assets', status: 'blocked' }),
      expect.objectContaining({ id: 'repeated_job_coverage', status: 'blocked' }),
      expect.objectContaining({ id: 'repeated_job_reliability', status: 'blocked' }),
    ]))
  })
})
