import type {
  CreativeCanvasPresence,
  CreativeCanvasRemoteMutationEvidence,
  CreativeCanvasRemoteMutationOperation,
  CreativeCanvasRemoteMutationSource,
} from './types'
import {
  creativeCanvasRemoteMutationOperations,
  creativeCanvasRemoteMutationSources,
} from './types'

/**
 * Live collaboration activity helpers — extracted from the retired
 * workspace-proof-evidence module. These feed the workspace activity feed
 * ("Remote graph mutation" entries) and presence latestMutation payloads.
 */

export interface CreativeCanvasActivityEvent {
  id: string
  actorLabel: string
  action: string
  detail: string
  nodeId?: string
  operation?: 'node_add' | 'node_move' | 'node_remove' | 'edge_add' | 'edge_remove' | 'workflow_add' | 'template_apply' | 'variant_create' | 'node_duplicate' | 'inpaint_branch' | 'node_configure' | 'draft_apply' | 'version_restore'
  atMs: number
  source: 'local' | 'stream' | 'draft'
  remoteMutation?: CreativeCanvasRemoteMutationEvidence
}

const remoteMutationOperationSet = new Set<string>(creativeCanvasRemoteMutationOperations)
const remoteMutationSourceSet = new Set<string>(creativeCanvasRemoteMutationSources)

export function isRemoteMutationOperation(value: unknown): value is CreativeCanvasRemoteMutationOperation {
  return typeof value === 'string' && remoteMutationOperationSet.has(value)
}

export function isRemoteMutationSource(value: unknown): value is CreativeCanvasRemoteMutationSource {
  return typeof value === 'string' && remoteMutationSourceSet.has(value)
}

function cleanMutationIdList(value: unknown, limit: number): string[] {
  return Array.isArray(value)
    ? value
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map((item) => item.trim())
      .slice(0, limit)
    : []
}

export function objectToRemoteMutationEvidence(input: unknown): CreativeCanvasRemoteMutationEvidence | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const record = input as Record<string, unknown>
  if (!isRemoteMutationOperation(record.operation) || !isRemoteMutationSource(record.source)) return undefined
  const touchedNodeIds = cleanMutationIdList(record.touchedNodeIds, 40)
  const touchedEdgeIds = cleanMutationIdList(record.touchedEdgeIds, 80)
  if (!touchedNodeIds.length && !touchedEdgeIds.length) return undefined
  const actorUid = typeof record.actorUid === 'string' && record.actorUid.trim() ? record.actorUid.trim() : ''
  const actorType = record.actorType === 'agent' || record.actorType === 'system' ? record.actorType : 'user'
  const occurredAt = typeof record.occurredAt === 'string' && record.occurredAt.trim()
    ? record.occurredAt.trim()
    : new Date().toISOString()
  if (!actorUid) return undefined

  return {
    actorUid,
    actorType,
    operation: record.operation,
    touchedNodeIds,
    touchedEdgeIds,
    source: record.source,
    occurredAt,
  }
}

export function latestLocalActivityMutation(event: CreativeCanvasActivityEvent | undefined): CreativeCanvasPresence['latestMutation'] | undefined {
  if (!event || event.source !== 'local' || !isRemoteMutationOperation(event.operation)) return undefined
  const touchedNodeIds = event.nodeId ? [event.nodeId] : []
  if (!touchedNodeIds.length) return undefined

  return {
    operation: event.operation,
    touchedNodeIds,
    touchedEdgeIds: [],
    source: 'stream',
    occurredAt: new Date(event.atMs).toISOString(),
  }
}
