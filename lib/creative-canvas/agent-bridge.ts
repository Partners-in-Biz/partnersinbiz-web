import type { CreativeCanvas, CreativeCanvasRun } from './types'

export interface CreativeCanvasAgentTaskDraft {
  title: string
  description: string
  assigneeAgentId: string
  agentStatus: 'pending'
  reviewStatus: 'pending'
  priority: 'high'
  labels: string[]
  agentInput: {
    source: 'creative_canvas'
    canvasId: string
    runId: string
    nodeId: string
    providerKey: string
    model?: string
    promptSummary?: string
    sourceNodeIds: string[]
    sourceArtifactIds: string[]
    expectedArtifacts: string[]
    guardrails: string[]
  }
}

function runAgentId(run: CreativeCanvasRun): string {
  return run.provenance.agentId || (run.providerKey === 'higgsfield' || run.providerKey === 'xai' ? 'maya' : 'pip')
}

export function buildCreativeCanvasAgentTask(
  run: CreativeCanvasRun & { id: string },
  canvas: Pick<CreativeCanvas, 'id' | 'orgId' | 'title' | 'purpose'>,
): CreativeCanvasAgentTaskDraft {
  return {
    title: `Creative Canvas run: ${canvas.title}`,
    description: [
      `Execute or prepare the Creative Canvas run ${run.id} for canvas ${canvas.id}.`,
      `Canvas purpose: ${canvas.purpose || 'No purpose supplied.'}`,
      `Provider: ${run.providerKey}${run.model ? ` / ${run.model}` : ''}.`,
      `Prompt summary: ${run.input.promptSummary || 'No prompt summary supplied.'}`,
      '',
      'Do not publish, schedule, share, launch ads, or expose outputs to clients.',
      'Return reviewable artifacts, provenance, synthetic-media status, and any blocker notes only.',
    ].join('\n'),
    assigneeAgentId: runAgentId(run),
    agentStatus: 'pending',
    reviewStatus: 'pending',
    priority: 'high',
    labels: ['creative-canvas', `provider:${run.providerKey}`],
    agentInput: {
      source: 'creative_canvas',
      canvasId: canvas.id ?? run.canvasId,
      runId: run.id,
      nodeId: run.nodeId,
      providerKey: run.providerKey,
      model: run.model,
      promptSummary: run.input.promptSummary,
      sourceNodeIds: run.input.sourceNodeIds,
      sourceArtifactIds: run.input.sourceArtifactIds,
      expectedArtifacts: ['creative_canvas_output'],
      guardrails: [
        'internal_output_only',
        'no_public_publish',
        'no_social_schedule',
        'no_ad_spend',
        'no_client_visible_without_approval',
      ],
    },
  }
}
