import type { CreativeCanvas, CreativeCanvasRun } from './types'
import {
  buildHiggsfieldExecutionManifest,
  type HiggsfieldExecutionManifest,
} from './higgsfield-execution'
import { buildCreativeCanvasOrchestrationPlan } from './orchestration'
import type { CreativeCanvasOrchestrationPlan } from './types'

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
    generationSettings: {
      outputKind?: string
      operation?: string
      aspectRatio?: string
      durationSeconds?: number
      variantCount?: number
      seed?: string
      stylePreset?: string
      cameraMotion?: string
      negativePrompt?: string
      editMask?: CreativeCanvasRun['input']['editMask']
    }
    expectedArtifacts: string[]
    guardrails: string[]
    providerExecution?: HiggsfieldExecutionManifest
    orchestration: CreativeCanvasOrchestrationPlan
  }
}

function runAgentId(run: CreativeCanvasRun): string {
  return run.provenance.agentId || (run.providerKey === 'higgsfield' || run.providerKey === 'xai' ? 'maya' : 'pip')
}

export function buildCreativeCanvasAgentTask(
  run: CreativeCanvasRun & { id: string },
  canvas: Pick<CreativeCanvas, 'id' | 'orgId' | 'title' | 'purpose'> & Partial<Pick<CreativeCanvas, 'nodes' | 'edges'>>,
): CreativeCanvasAgentTaskDraft {
  const canvasId = canvas.id ?? run.canvasId
  const providerExecution = buildHiggsfieldExecutionManifest(run, {
    id: canvasId,
    orgId: canvas.orgId,
    nodes: canvas.nodes ?? [],
  })
  const orchestration = buildCreativeCanvasOrchestrationPlan({
    id: canvasId,
    orgId: canvas.orgId,
    nodes: canvas.nodes ?? [],
    edges: canvas.edges ?? [],
  })

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
      canvasId,
      runId: run.id,
      nodeId: run.nodeId,
      providerKey: run.providerKey,
      model: run.model,
      promptSummary: run.input.promptSummary,
      sourceNodeIds: run.input.sourceNodeIds,
      sourceArtifactIds: run.input.sourceArtifactIds,
      generationSettings: {
        outputKind: run.input.outputKind,
        operation: run.input.operation,
        aspectRatio: run.input.aspectRatio,
        durationSeconds: run.input.durationSeconds,
        variantCount: run.input.variantCount,
        seed: run.input.seed,
        stylePreset: run.input.stylePreset,
        cameraMotion: run.input.cameraMotion,
        negativePrompt: run.input.negativePrompt,
        editMask: run.input.editMask,
      },
      expectedArtifacts: ['creative_canvas_output'],
      guardrails: [
        'internal_output_only',
        'no_public_publish',
        'no_social_schedule',
        'no_ad_spend',
        'no_client_visible_without_approval',
      ],
      providerExecution,
      orchestration,
    },
  }
}
