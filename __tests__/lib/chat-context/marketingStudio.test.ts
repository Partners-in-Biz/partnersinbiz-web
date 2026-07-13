import { buildMarketingStudioCanvasModel } from '@/lib/chat-context/adapters/marketingStudioArtifact'
import type { CreativeCanvas, CreativeCanvasRun } from '@/lib/creative-canvas/types'

const canvas = {
  id: 'canvas-1', orgId: 'org-1', title: 'Launch campaign', status: 'internal_review', purpose: 'Launch',
  linked: {}, activeVersion: 4, visibility: 'admin_agents_clients', createdBy: 'u1', createdByType: 'user',
  updatedBy: 'u1', updatedByType: 'user', deleted: false, edges: [],
  updatedAt: { toDate: () => new Date('2026-07-13T08:00:00Z') },
  nodes: [
    { id: 'source-1', orgId: 'org-1', type: 'source', title: 'Brand kit', position: { x: 0, y: 0 }, data: {}, source: { kind: 'brand_kit', url: 'https://cdn.test/brand.png' } },
    { id: 'image-1', orgId: 'org-1', type: 'output', title: 'Launch image', position: { x: 1, y: 1 }, data: {}, output: { kind: 'image', url: 'https://cdn.test/image.png' }, review: { status: 'needed', rightsStatus: 'needs_review', brandStatus: 'needs_review', approvalGateTaskId: 'approval-1' } },
  ],
} as CreativeCanvas & { id: string }

const run = {
  id: 'run-1', orgId: 'org-1', canvasId: 'canvas-1', nodeId: 'image-1', providerKey: 'higgsfield', model: 'soul-v2', status: 'completed',
  input: { sourceNodeIds: ['source-1'], sourceArtifactIds: [], outputKind: 'image' },
  output: { outputNodeId: 'image-1', url: 'https://cdn.test/provider.png' },
  provenance: { generatedBy: 'provider', model: 'soul-v2', promptStored: 'summary', syntheticMedia: true, costUnits: 8 },
} as CreativeCanvasRun & { id: string }

describe('Marketing Studio chat context mapping', () => {
  it('keeps provider completion in review instead of marking the campaign complete', () => {
    const model = buildMarketingStudioCanvasModel({ canvas, runs: [run], versions: [{ version: 4 }], exports: [], credits: { used: 8, limit: 10 }, role: 'client' })

    expect(model.context.href).toBe('/portal/creative-canvas?canvasId=canvas-1&orgId=org-1')
    expect(model.pulse.label).toBe('Internal review')
    expect(model.artifacts.find((item) => item.resourceId === 'image-1')).toEqual(expect.objectContaining({
      artifactKind: 'image', state: 'review', statusLabel: 'Review needed · Rights review · Brand review', version: 'v4',
      preview: expect.objectContaining({ kind: 'image', url: 'https://cdn.test/image.png' }),
      provenance: expect.objectContaining({ provider: 'higgsfield', model: 'soul-v2', sourceIds: ['source-1'] }),
    }))
    expect(model.attention).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'review:image-1', state: 'review' }),
    ]))
    expect(model.attention.some((item) => item.id === 'spend:canvas-1')).toBe(false)
    expect(model.artifacts.find((item) => item.resourceId === 'image-1')?.actions.map((action) => action.id)).toEqual(['open'])
    expect(model.pulse.metrics).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'export-ready', value: 0 })]))
  })

  it('maps run output, review gates, failed exports, and executable retry/export contracts', () => {
    const waitingRun = { ...run, id: 'run-waiting', nodeId: 'generator-1', status: 'waiting_for_review' as const, output: { url: 'https://cdn.test/preview.mp4' }, input: { ...run.input, outputKind: 'video' as const } }
    const failedRun = { ...run, id: 'run-failed', status: 'failed' as const, error: { code: 'provider', message: 'Provider unavailable', retryable: true } }
    const gatedCanvas = { ...canvas, nodes: canvas.nodes.map((node) => node.id === 'image-1' ? { ...node, review: { ...node.review!, requiredReviewerAgentId: 'vera', approvalGateTaskId: 'approval-1' } } : node) }
    const model = buildMarketingStudioCanvasModel({
      canvas: gatedCanvas,
      runs: [waitingRun, failedRun],
      versions: [{ version: 3 }, { version: 4 }],
      exports: [{ id: 'export-failed', nodeId: 'image-1', status: 'failed', target: 'campaign_asset' }],
      credits: { used: 10, limit: 10 }, role: 'admin',
    })

    expect(model.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ resourceType: 'run_output', resourceId: 'run-waiting', artifactKind: 'video', state: 'review' }),
    ]))
    expect(model.attention).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'run-review:run-waiting', state: 'review' }),
      expect.objectContaining({ id: 'failure:run-failed', actions: [expect.objectContaining({ id: 'retry', method: 'PUT' })] }),
      expect.objectContaining({ id: 'export:export-failed', state: 'blocked' }),
      expect.objectContaining({ id: 'spend:canvas-1', state: 'needs_approval' }),
    ]))
    expect(model.artifacts.find((item) => item.resourceId === 'image-1')?.review).toEqual(expect.objectContaining({ reviewer: 'vera', approvalGateTaskId: 'approval-1' }))
  })

  it('only marks reviewed, rights-cleared, brand-passed output export-ready', () => {
    const readyCanvas = { ...canvas, status: 'approved' as const, nodes: canvas.nodes.map((node) => node.id === 'image-1' ? { ...node, review: { status: 'passed' as const, rightsStatus: 'cleared' as const, brandStatus: 'passed' as const } } : node) }
    const model = buildMarketingStudioCanvasModel({ canvas: readyCanvas, runs: [run], versions: [{ version: 4 }], exports: [{ id: 'export-1', nodeId: 'image-1', status: 'completed' }], credits: { used: 8, limit: 10 }, role: 'admin' })

    expect(model.context.href).toBe('/admin/creative-canvas?canvasId=canvas-1&orgId=org-1')
    expect(model.artifacts.find((item) => item.resourceId === 'image-1')).toEqual(expect.objectContaining({ state: 'complete', statusLabel: 'Export ready' }))
    expect(model.artifacts.find((item) => item.resourceId === 'image-1')?.actions.find((action) => action.id === 'export')).toEqual(expect.objectContaining({
      href: '/api/v1/creative-canvas/canvas-1/exports/draft?orgId=org-1',
      body: { nodeId: 'image-1', target: 'campaign_asset' },
    }))
    expect(model.attention.some((item) => item.id === 'review:image-1')).toBe(false)
  })

  it('scopes every mutation to the canvas organisation and treats a zero limit as exhausted', () => {
    const model = buildMarketingStudioCanvasModel({ canvas, runs: [{ ...run, status: 'failed', error: { code: 'x', message: 'Nope', retryable: true } }], versions: [], exports: [], credits: { used: 0, limit: 0 }, role: 'client' })
    const output = model.artifacts.find((item) => item.resourceId === 'image-1')!
    expect(output.actions.filter((action) => action.method).every((action) => action.href?.includes('orgId=org-1'))).toBe(true)
    expect(model.attention.find((item) => item.id === 'failure:run-1')?.actions?.[0].href).toBe('/api/v1/creative-canvas/canvas-1/runs/run-1/retry?orgId=org-1')
    expect(model.attention).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'spend:canvas-1', label: 'Creative credits exhausted' })]))
  })

  it('renders URL-backed copy outputs as documents rather than empty text previews', () => {
    const documentCanvas = { ...canvas, nodes: canvas.nodes.map((node) => node.id === 'image-1' ? { ...node, output: { kind: 'copy' as const, url: 'https://cdn.test/brief.pdf' } } : node) }
    const model = buildMarketingStudioCanvasModel({ canvas: documentCanvas, runs: [], versions: [], exports: [], credits: { used: 0, limit: null }, role: 'admin' })
    expect(model.artifacts.find((item) => item.resourceId === 'image-1')?.preview).toEqual(expect.objectContaining({ kind: 'document', url: 'https://cdn.test/brief.pdf' }))
  })

  it('maps every provider run status distinctly and only offers retry for retryable failures', () => {
    const statuses = ['queued', 'running', 'waiting_for_review', 'completed', 'failed', 'cancelled'] as const
    const expected = { queued: 'waiting', running: 'running', waiting_for_review: 'review', completed: 'ready', failed: 'blocked', cancelled: 'archived' }
    const runs = statuses.map((status) => ({ ...run, id: `run-${status}`, nodeId: `generator-${status}`, status, output: { url: `https://cdn.test/${status}.png` }, error: status === 'failed' ? { code: 'fatal', message: 'No retry', retryable: false } : undefined }))
    const model = buildMarketingStudioCanvasModel({ canvas, runs, versions: [], exports: [], credits: { used: 2, limit: 10 }, role: 'admin' })
    for (const status of statuses) expect(model.artifacts.find((item) => item.resourceId === `run-${status}`)?.state).toBe(expected[status])
    expect(model.attention.find((item) => item.id === 'failure:run-failed')?.actions).toBeUndefined()
    expect(model.pulse.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'credits-used', value: 2 }), expect.objectContaining({ id: 'credits-limit', value: 10 }), expect.objectContaining({ id: 'credits-remaining', value: 8 }),
    ]))
  })

  it.each([
    ['book_artifact', 'document'], ['youtube_render', 'video'], ['campaign_asset', 'image'], ['social_post_draft', 'document'],
  ] as const)('maps %s URL outputs to a useful %s preview', (kind, expectedPreview) => {
    const kindCanvas = { ...canvas, nodes: canvas.nodes.map((node) => node.id === 'image-1' ? { ...node, output: { kind, url: `https://cdn.test/${kind}` } } : node) }
    const model = buildMarketingStudioCanvasModel({ canvas: kindCanvas, runs: [], versions: [], exports: [], credits: { used: 0, limit: null }, role: 'admin' })
    expect(model.artifacts.find((item) => item.resourceId === 'image-1')?.preview?.kind).toBe(expectedPreview)
  })

  it('surfaces missing source input and client approval as distinct attention moments', () => {
    const inputCanvas = { ...canvas, status: 'client_review' as const, nodes: canvas.nodes.filter((node) => node.type !== 'source') }
    const model = buildMarketingStudioCanvasModel({ canvas: inputCanvas, runs: [], versions: [], exports: [], credits: { used: 0, limit: null }, role: 'client' })

    expect(model.attention).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'input:canvas-1', state: 'needs_input' }),
      expect.objectContaining({ id: 'approval:canvas-1', state: 'needs_approval' }),
    ]))
  })

  it.each(['draft', 'internal_review'] as const)('does not offer client review actions while canvas is %s', (status) => {
    const model = buildMarketingStudioCanvasModel({ canvas: { ...canvas, status }, runs: [run], versions: [], exports: [], credits: { used: 0, limit: null }, role: 'client' })
    expect(model.artifacts.find((item) => item.resourceId === 'image-1')?.actions.map((action) => action.id)).toEqual(['open'])
  })

  it('offers client decisions only for an unblocked client-review gate without an agent reviewer', () => {
    const reviewCanvas = { ...canvas, status: 'client_review' as const }
    const allowed = buildMarketingStudioCanvasModel({ canvas: reviewCanvas, runs: [run], versions: [], exports: [], credits: { used: 0, limit: null }, role: 'client' })
    expect(allowed.artifacts.find((item) => item.resourceId === 'image-1')?.actions.map((action) => action.id)).toEqual(['open', 'review', 'request-changes'])
    for (const review of [
      { ...canvas.nodes[1].review!, status: 'blocked' as const },
      { ...canvas.nodes[1].review!, rightsStatus: 'blocked' as const },
      { ...canvas.nodes[1].review!, brandStatus: 'blocked' as const },
      { ...canvas.nodes[1].review!, requiredReviewerAgentId: 'vera' },
      { ...canvas.nodes[1].review!, approvalGateTaskId: undefined },
    ]) {
      const blockedCanvas = { ...reviewCanvas, nodes: canvas.nodes.map((node) => node.id === 'image-1' ? { ...node, review } : node) }
      const model = buildMarketingStudioCanvasModel({ canvas: blockedCanvas, runs: [run], versions: [], exports: [], credits: { used: 0, limit: null }, role: 'client' })
      expect(model.artifacts.find((item) => item.resourceId === 'image-1')?.actions.map((action) => action.id)).toEqual(['open'])
    }
  })
})
