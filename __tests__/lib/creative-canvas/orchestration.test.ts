import { buildCreativeCanvasOrchestrationPlan } from '@/lib/creative-canvas/orchestration'
import type { CreativeCanvas } from '@/lib/creative-canvas/types'

describe('creative canvas orchestration', () => {
  it('builds a graph-derived multi-agent handoff plan with approval gates', () => {
    const canvas = {
      id: 'canvas-1',
      orgId: 'org-1',
      nodes: [
        {
          id: 'source-1',
          orgId: 'org-1',
          type: 'source',
          title: 'Product source',
          position: { x: 0, y: 0 },
          data: { requiredInputs: ['product_image'] },
          source: { kind: 'upload', referenceRole: 'product' },
        },
        {
          id: 'prompt-1',
          orgId: 'org-1',
          type: 'prompt',
          title: 'Launch prompt',
          position: { x: 220, y: 0 },
          data: { agentId: 'maya', requiredOutputs: ['ugc_script'] },
        },
        {
          id: 'model-1',
          orgId: 'org-1',
          type: 'model',
          title: 'Higgsfield render',
          position: { x: 440, y: 0 },
          data: { ownerAgentId: 'maya' },
          provider: { key: 'higgsfield', model: 'nano_banana_flash' },
          edit: { operation: 'video_motion', outputKind: 'video' },
        },
        {
          id: 'review-1',
          orgId: 'org-1',
          type: 'review',
          title: 'Brand review',
          position: { x: 660, y: 0 },
          data: {},
          review: {
            status: 'needed',
            requiredReviewerAgentId: 'quinn',
            syntheticMediaDisclosure: true,
            rightsStatus: 'needs_review',
            brandStatus: 'needs_review',
          },
        },
        {
          id: 'output-1',
          orgId: 'org-1',
          type: 'output',
          title: 'Social draft',
          position: { x: 880, y: 0 },
          data: {},
          output: { kind: 'social_post_draft' },
        },
      ],
      edges: [
        { id: 'e1', orgId: 'org-1', sourceNodeId: 'source-1', targetNodeId: 'prompt-1' },
        { id: 'e2', orgId: 'org-1', sourceNodeId: 'prompt-1', targetNodeId: 'model-1' },
        { id: 'e3', orgId: 'org-1', sourceNodeId: 'model-1', targetNodeId: 'review-1' },
        { id: 'e4', orgId: 'org-1', sourceNodeId: 'review-1', targetNodeId: 'output-1' },
      ],
    } as Pick<CreativeCanvas, 'id' | 'orgId' | 'nodes' | 'edges'>

    const plan = buildCreativeCanvasOrchestrationPlan(canvas)

    expect(plan).toMatchObject({
      canvasId: 'canvas-1',
      orgId: 'org-1',
      handoffSummary: 'pip:source_curator -> maya:prompt_engineer -> maya:generation_operator -> quinn:reviewer -> pip:publisher',
      blockers: [],
      approvalGates: [{
        nodeId: 'review-1',
        reviewerAgentId: 'quinn',
        syntheticMediaDisclosure: true,
        rightsStatus: 'needs_review',
        brandStatus: 'needs_review',
      }],
    })
    expect(plan.agents).toEqual(expect.arrayContaining([
      expect.objectContaining({ agentId: 'maya', roles: expect.arrayContaining(['prompt_engineer', 'generation_operator']), stepCount: 2 }),
      expect.objectContaining({ agentId: 'quinn', roles: ['reviewer'], stepCount: 1 }),
      expect.objectContaining({ agentId: 'pip', roles: expect.arrayContaining(['source_curator', 'publisher']), stepCount: 2 }),
    ]))
    expect(plan.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        nodeId: 'model-1',
        role: 'generation_operator',
        agentId: 'maya',
        status: 'waiting',
        dependsOnNodeIds: ['prompt-1'],
        providerKey: 'higgsfield',
        outputKind: 'video',
        guardrails: expect.arrayContaining(['synthetic_media_disclosure_required']),
      }),
    ]))
  })

  it('reports graph blockers that would break an agent handoff', () => {
    const plan = buildCreativeCanvasOrchestrationPlan({
      id: 'canvas-1',
      orgId: 'org-1',
      nodes: [{
        id: 'model-1',
        orgId: 'org-1',
        type: 'model',
        title: 'Unconfigured model',
        position: { x: 0, y: 0 },
        data: {},
      }],
      edges: [{ id: 'bad-edge', orgId: 'org-1', sourceNodeId: 'missing-source', targetNodeId: 'model-1' }],
    })

    expect(plan.blockers).toEqual([
      'Missing source node for edge bad-edge',
      'Unconfigured model has no provider',
    ])
    expect(plan.steps[0]).toMatchObject({ status: 'waiting', dependsOnNodeIds: ['missing-source'] })
  })
})
