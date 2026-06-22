import type {
  CreativeCanvas,
  CreativeCanvasEdge,
  CreativeCanvasNode,
  CreativeCanvasOrchestrationPlan,
  CreativeCanvasOrchestrationRole,
  CreativeCanvasOrchestrationStep,
} from './types'

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function cleanStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? Array.from(new Set(value.map(cleanString).filter((entry): entry is string => Boolean(entry))))
    : []
}

function dataStringArray(node: CreativeCanvasNode, key: string): string[] {
  return cleanStringArray(asRecord(node.data)[key])
}

function roleForNode(node: CreativeCanvasNode): CreativeCanvasOrchestrationRole {
  if (node.type === 'source') return 'source_curator'
  if (node.type === 'brief') return 'strategist'
  if (node.type === 'prompt') return 'prompt_engineer'
  if (node.type === 'model') return 'generation_operator'
  if (node.type === 'edit') return 'editor'
  if (node.type === 'review') return 'reviewer'
  return 'publisher'
}

function agentForNode(node: CreativeCanvasNode): string {
  const data = asRecord(node.data)
  const explicit = cleanString(data.agentId)
    ?? cleanString(data.ownerAgentId)
    ?? cleanString(data.requiredReviewerAgentId)
    ?? cleanString(node.review?.requiredReviewerAgentId)
  if (explicit) return explicit
  if (node.type === 'source' || node.type === 'brief' || node.type === 'output') return 'pip'
  if (node.type === 'review') return 'quinn'
  if (node.provider?.key === 'higgsfield' || node.provider?.key === 'xai') return 'maya'
  if (node.provider?.key === 'document_generation') return 'iris'
  return 'pip'
}

function deliverablesForNode(node: CreativeCanvasNode): string[] {
  const dataDeliverables = [
    ...dataStringArray(node, 'requiredInputs').map((item) => `source:${item}`),
    ...dataStringArray(node, 'requiredOutputs').map((item) => `output:${item}`),
    ...dataStringArray(node, 'checks').map((item) => `check:${item}`),
  ]
  if (dataDeliverables.length) return dataDeliverables
  if (node.type === 'source') return ['source_manifest']
  if (node.type === 'brief') return ['creative_brief']
  if (node.type === 'prompt') return ['generation_prompt']
  if (node.type === 'model') return [node.edit?.outputKind ? `${node.edit.outputKind}_generation` : 'provider_generation']
  if (node.type === 'edit') return [node.edit?.operation ? `${node.edit.operation}_edit` : 'canvas_edit']
  if (node.type === 'review') return ['rights_review', 'brand_review', 'synthetic_media_disclosure']
  return [node.output?.kind ? `${node.output.kind}_export` : 'draft_export']
}

function guardrailsForNode(node: CreativeCanvasNode): string[] {
  const guardrails = new Set<string>([
    'internal_output_only',
    'no_client_visible_without_approval',
  ])
  if (node.type === 'model' || node.type === 'edit' || node.provider?.key === 'higgsfield') {
    guardrails.add('preserve_source_provenance')
    guardrails.add('synthetic_media_disclosure_required')
  }
  if (node.type === 'review') {
    guardrails.add('rights_and_brand_gate_required')
  }
  if (node.type === 'output') {
    guardrails.add('export_only_after_review_passes')
  }
  return Array.from(guardrails)
}

function dependencyMap(edges: CreativeCanvasEdge[]): Map<string, string[]> {
  const map = new Map<string, string[]>()
  edges.forEach((edge) => {
    const current = map.get(edge.targetNodeId) ?? []
    current.push(edge.sourceNodeId)
    map.set(edge.targetNodeId, Array.from(new Set(current)))
  })
  return map
}

function stepStatus(node: CreativeCanvasNode, dependsOnNodeIds: string[]): CreativeCanvasOrchestrationStep['status'] {
  if (node.review?.status === 'blocked' || node.review?.rightsStatus === 'blocked' || node.review?.brandStatus === 'blocked') {
    return 'blocked'
  }
  return dependsOnNodeIds.length ? 'waiting' : 'ready'
}

function sortNodesByGraph(nodes: CreativeCanvasNode[], edges: CreativeCanvasEdge[]): CreativeCanvasNode[] {
  const indexById = new Map(nodes.map((node, index) => [node.id, index]))
  const visited = new Set<string>()
  const visiting = new Set<string>()
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const incoming = dependencyMap(edges)
  const sorted: CreativeCanvasNode[] = []

  const visit = (node: CreativeCanvasNode) => {
    if (visited.has(node.id)) return
    if (visiting.has(node.id)) return
    visiting.add(node.id)
    ;(incoming.get(node.id) ?? [])
      .map((id) => byId.get(id))
      .filter((item): item is CreativeCanvasNode => Boolean(item))
      .sort((a, b) => (indexById.get(a.id) ?? 0) - (indexById.get(b.id) ?? 0))
      .forEach(visit)
    visiting.delete(node.id)
    visited.add(node.id)
    sorted.push(node)
  }

  nodes.forEach(visit)
  return sorted
}

export function buildCreativeCanvasOrchestrationPlan(
  canvas: Pick<CreativeCanvas, 'id' | 'orgId' | 'nodes' | 'edges'>,
): CreativeCanvasOrchestrationPlan {
  const canvasId = canvas.id ?? 'pending-canvas'
  const incoming = dependencyMap(canvas.edges)
  const nodes = sortNodesByGraph(canvas.nodes, canvas.edges)
  const steps = nodes.map((node): CreativeCanvasOrchestrationStep => {
    const dependsOnNodeIds = incoming.get(node.id) ?? []
    return {
      id: `step-${node.id}`,
      nodeId: node.id,
      title: node.title,
      role: roleForNode(node),
      agentId: agentForNode(node),
      status: stepStatus(node, dependsOnNodeIds),
      dependsOnNodeIds,
      deliverables: deliverablesForNode(node),
      guardrails: guardrailsForNode(node),
      providerKey: node.provider?.key,
      outputKind: node.edit?.outputKind ?? node.output?.kind,
    }
  })

  const agentMap = new Map<string, Set<CreativeCanvasOrchestrationRole>>()
  steps.forEach((step) => {
    const roles = agentMap.get(step.agentId) ?? new Set<CreativeCanvasOrchestrationRole>()
    roles.add(step.role)
    agentMap.set(step.agentId, roles)
  })

  const agents = Array.from(agentMap.entries()).map(([agentId, roles]) => ({
    agentId,
    roles: Array.from(roles),
    stepCount: steps.filter((step) => step.agentId === agentId).length,
  }))

  const approvalGates = nodes
    .filter((node) => node.review)
    .map((node) => ({
      nodeId: node.id,
      title: node.title,
      reviewerAgentId: node.review?.requiredReviewerAgentId ?? agentForNode(node),
      syntheticMediaDisclosure: node.review?.syntheticMediaDisclosure === true,
      rightsStatus: node.review?.rightsStatus ?? 'unknown',
      brandStatus: node.review?.brandStatus ?? 'unknown',
    }))

  const blockers: string[] = []
  const nodeIds = new Set(nodes.map((node) => node.id))
  canvas.edges.forEach((edge) => {
    if (!nodeIds.has(edge.sourceNodeId)) blockers.push(`Missing source node for edge ${edge.id}`)
    if (!nodeIds.has(edge.targetNodeId)) blockers.push(`Missing target node for edge ${edge.id}`)
  })
  nodes.forEach((node) => {
    if (node.type === 'model' && !node.provider?.key) blockers.push(`${node.title} has no provider`)
    if (node.type === 'review' && node.review?.status === 'blocked') blockers.push(`${node.title} is blocked`)
  })

  const handoffSummary = steps.length
    ? steps.map((step) => `${step.agentId}:${step.role}`).join(' -> ')
    : 'No orchestration steps yet'

  return {
    canvasId,
    orgId: canvas.orgId,
    steps,
    agents,
    approvalGates,
    blockers,
    handoffSummary,
  }
}
