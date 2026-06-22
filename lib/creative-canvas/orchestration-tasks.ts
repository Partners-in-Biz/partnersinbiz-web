import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { buildProjectTaskCreateData } from '@/lib/projects/taskPayload'
import { buildCreativeCanvasOrchestrationPlan } from './orchestration'
import { CREATIVE_CANVAS_COLLECTION } from './store'
import type {
  CreativeCanvas,
  CreativeCanvasActor,
  CreativeCanvasOrchestrationStep,
} from './types'

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function stepCapability(step: CreativeCanvasOrchestrationStep): string {
  if (step.role === 'reviewer') return 'qa'
  if (step.role === 'source_curator') return 'research'
  if (step.role === 'strategist' || step.role === 'prompt_engineer' || step.role === 'publisher') return 'content'
  return 'content'
}

function stepDescription(canvas: CreativeCanvas & { id: string }, step: CreativeCanvasOrchestrationStep): string {
  return [
    `Creative Canvas: ${canvas.title}`,
    `Canvas purpose: ${canvas.purpose || 'No purpose supplied.'}`,
    `Step: ${step.title}`,
    `Role: ${step.role.replaceAll('_', ' ')}`,
    `Deliverables: ${step.deliverables.join(', ') || 'reviewable canvas artifact'}`,
    `Depends on canvas nodes: ${step.dependsOnNodeIds.join(', ') || 'none'}`,
    '',
    'Do not publish, schedule, spend, message clients, or expose outputs outside internal review.',
    'Return provenance, blocker notes, and review-ready artifacts only.',
  ].join('\n')
}

function buildTaskInput(canvas: CreativeCanvas & { id: string }, step: CreativeCanvasOrchestrationStep, projectId: string) {
  return {
    orgId: canvas.orgId,
    projectId,
    columnId: 'todo',
    title: `Creative Canvas: ${step.title}`,
    description: stepDescription(canvas, step),
    priority: step.role === 'reviewer' || step.providerKey === 'higgsfield' ? 'high' : 'medium',
    labels: [
      'creative-canvas',
      `canvas:${canvas.id}`,
      `role:${step.role}`,
      `agent:${step.agentId}`,
      ...(step.providerKey ? [`provider:${step.providerKey}`] : []),
    ],
    assigneeAgentId: step.agentId,
    agentStatus: 'pending',
    internalOnly: true,
    requiredCapability: stepCapability(step),
    expectedArtifacts: step.deliverables,
    agentInput: {
      spec: stepDescription(canvas, step),
      constraints: step.guardrails,
      context: {
        source: 'creative_canvas_orchestration',
        canvasId: canvas.id,
        canvasTitle: canvas.title,
        orgId: canvas.orgId,
        nodeId: step.nodeId,
        stepId: step.id,
        role: step.role,
        providerKey: step.providerKey,
        outputKind: step.outputKind,
        dependsOnNodeIds: step.dependsOnNodeIds,
        deliverables: step.deliverables,
        guardrails: step.guardrails,
      },
    },
  }
}

function mergeAgentTaskIdsIntoNodes(
  nodes: CreativeCanvas['nodes'],
  taskIdsByNodeId: Map<string, string>,
): { changed: boolean; nodes: CreativeCanvas['nodes'] } {
  let changed = false
  const mergedNodes = nodes.map((node) => {
    const taskId = taskIdsByNodeId.get(node.id)
    if (!taskId) return node
    const existingTaskIds = Array.isArray(node.data.agentTaskIds)
      ? node.data.agentTaskIds.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
      : []
    const agentTaskIds = Array.from(new Set([...existingTaskIds, taskId]))
    if (agentTaskIds.length === existingTaskIds.length && agentTaskIds.every((item, index) => item === existingTaskIds[index])) {
      return node
    }
    changed = true
    return {
      ...node,
      data: {
        ...node.data,
        agentTaskIds,
      },
    }
  })

  return { changed, nodes: mergedNodes }
}

async function persistNodeTaskLineage(
  canvas: CreativeCanvas & { id: string },
  actor: CreativeCanvasActor,
  nodeTaskLineage: Array<{ nodeId: string; taskId: string; projectId: string; agentId: string }>,
): Promise<void> {
  const taskIdsByNodeId = new Map(nodeTaskLineage.map((item) => [item.nodeId, item.taskId]))
  const canvasRef = adminDb.collection(CREATIVE_CANVAS_COLLECTION).doc(canvas.id)
  const updatePayloadForNodes = (nodes: CreativeCanvas['nodes']) => {
    const merged = mergeAgentTaskIdsIntoNodes(nodes, taskIdsByNodeId)
    if (!merged.changed) return null
    return {
      nodes: merged.nodes,
      updatedBy: actor.uid,
      updatedByType: actor.type,
      updatedAt: FieldValue.serverTimestamp(),
    }
  }

  const runTransaction = typeof adminDb.runTransaction === 'function' ? adminDb.runTransaction.bind(adminDb) : null
  if (runTransaction) {
    await runTransaction(async (transaction) => {
      const snap = await transaction.get(canvasRef)
      const data = snap.exists ? snap.data() : undefined
      const currentNodes = Array.isArray(data?.nodes) ? data.nodes as CreativeCanvas['nodes'] : canvas.nodes
      const updatePayload = updatePayloadForNodes(currentNodes)
      if (updatePayload) transaction.update(canvasRef, updatePayload)
    })
    return
  }

  const snap = await canvasRef.get()
  const data = snap.exists ? snap.data() : undefined
  const currentNodes = Array.isArray(data?.nodes) ? data.nodes as CreativeCanvas['nodes'] : canvas.nodes
  const updatePayload = updatePayloadForNodes(currentNodes)
  if (updatePayload) await canvasRef.update(updatePayload)
}

export async function createCreativeCanvasOrchestrationTasks(
  canvas: CreativeCanvas & { id: string },
  input: unknown,
  actor: CreativeCanvasActor,
): Promise<{
  projectId: string
  createdTasks: Array<{ id: string; nodeId: string; agentId: string; title: string }>
  nodeTaskLineage: Array<{ nodeId: string; taskId: string; projectId: string; agentId: string }>
  skippedSteps: Array<{ nodeId: string; reason: string }>
}> {
  const body = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {}
  const projectId = cleanString(body.projectId) ?? canvas.linked?.projectId
  if (!projectId) throw new Error('Creative Canvas needs linked.projectId or projectId to create orchestration tasks')

  const plan = buildCreativeCanvasOrchestrationPlan(canvas)
  if (plan.blockers.length) {
    throw new Error(`Creative Canvas orchestration has blockers: ${plan.blockers.join('; ')}`)
  }

  const requestedNodeIds = Array.isArray(body.nodeIds)
    ? new Set(body.nodeIds.map(cleanString).filter((item): item is string => Boolean(item)))
    : null
  const steps = plan.steps.filter((step) => !requestedNodeIds || requestedNodeIds.has(step.nodeId))
  const createdTasks: Array<{ id: string; nodeId: string; agentId: string; title: string }> = []
  const nodeTaskLineage: Array<{ nodeId: string; taskId: string; projectId: string; agentId: string }> = []
  const skippedSteps: Array<{ nodeId: string; reason: string }> = []
  const nodeTaskIds = new Map<string, string>()

  for (const step of steps) {
    if (step.status === 'blocked') {
      skippedSteps.push({ nodeId: step.nodeId, reason: 'blocked_step' })
      continue
    }

    const taskInput = buildTaskInput(canvas, step, projectId)
    const dependsOn = step.dependsOnNodeIds
      .map((nodeId) => nodeTaskIds.get(nodeId))
      .filter((taskId): taskId is string => Boolean(taskId))
    const taskData = buildProjectTaskCreateData({
      ...taskInput,
      dependsOn,
    }, projectId, canvas.orgId)
    if (!taskData.ok) throw new Error(taskData.error)

    const doc = {
      ...taskData.value,
      reporterId: actor.uid,
      createdBy: actor.uid,
      createdByType: actor.type,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }
    const ref = await adminDb.collection('projects').doc(projectId).collection('tasks').add(doc)
    nodeTaskIds.set(step.nodeId, ref.id)
    createdTasks.push({
      id: ref.id,
      nodeId: step.nodeId,
      agentId: step.agentId,
      title: String(taskData.value.title ?? step.title),
    })
    nodeTaskLineage.push({
      nodeId: step.nodeId,
      taskId: ref.id,
      projectId,
      agentId: step.agentId,
    })
  }

  if (nodeTaskLineage.length) {
    await persistNodeTaskLineage(canvas, actor, nodeTaskLineage)
  }

  return { projectId, createdTasks, nodeTaskLineage, skippedSteps }
}
