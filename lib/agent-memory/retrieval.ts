import { embed } from 'ai'
import type { ApiPermission, ApiUser } from '@/lib/api/types'
import { adminDb } from '@/lib/firebase/admin'
import {
  AGENT_MEMORY_COLLECTION,
  AGENT_MEMORY_EMBEDDING_MODEL,
  type AgentEntityCandidate,
  type AgentMemoryChunk,
  type AgentMemoryCitation,
  type AgentMemoryRetrievalResult,
  type AgentMemorySensitivity,
} from './types'

type EmbedModel = Parameters<typeof embed>[0]['model']
type FirestoreVectorDoc = { id: string; data: () => Record<string, unknown> }
type FirestoreVectorQuery = {
  where: (field: string, op: string, value: unknown) => FirestoreVectorQuery
  findNearest: (options: {
    vectorField: string
    queryVector: number[]
    limit: number
    distanceMeasure: 'COSINE'
    distanceResultField: string
  }) => { get: () => Promise<{ docs: FirestoreVectorDoc[] }> }
}

interface RetrieveAgentMemoryInput {
  query: string
  orgId: string
  limit?: number
  sourceTypes?: string[]
  selectedEntity?: AgentEntityCandidate | null
  user: ApiUser
}

function sensitivityFrom(value: unknown): AgentMemorySensitivity {
  return value === 'public' || value === 'internal' || value === 'restricted' || value === 'sensitive'
    ? value
    : 'internal'
}

function permissionMatches(permission: ApiPermission, resource: string, action = 'read') {
  const allowed = permission.actions.includes(action) || permission.actions.includes('*')
  if (!allowed) return false
  if (permission.resource === resource || permission.resource === '*') return true
  if (permission.resource.endsWith(':*')) return resource.startsWith(permission.resource.slice(0, -1))
  return false
}

function canReadChunk(user: ApiUser, chunk: Pick<AgentMemoryChunk, 'orgId' | 'sourceType' | 'sensitivity' | 'allowedAgentIds'>) {
  const sensitivity: AgentMemorySensitivity = chunk.sensitivity ?? 'internal'
  if (user.role === 'admin') return true
  if (user.role === 'client') return sensitivity === 'public'
  const agentId = user.agentId ?? user.uid.replace(/^agent:/, '')
  if (chunk.allowedAgentIds?.includes(agentId)) return true
  const hasAgentAllowList = Boolean(chunk.allowedAgentIds?.length)
  const resources = [
    'agent_memory',
    `agent_memory:${chunk.orgId}`,
    String(chunk.sourceType),
    `${String(chunk.sourceType)}:${chunk.orgId}`,
  ]
  if (String(chunk.sourceType).startsWith('mailbox')) resources.push(`mailbox:${chunk.orgId}:*`)
  if (String(chunk.sourceType).startsWith('support')) resources.push(`support:${chunk.orgId}`)
  if (String(chunk.sourceType).startsWith('social')) resources.push(`social:${chunk.orgId}`)
  if (String(chunk.sourceType).startsWith('ad_')) resources.push(`ads:${chunk.orgId}`)
  const hasDelegatedPermission = resources.some((resource) => user.permissions?.some((permission) => permissionMatches(permission, resource)))
  if (hasDelegatedPermission) return true
  if (hasAgentAllowList) return false
  return sensitivity === 'public' || sensitivity === 'internal'
}

function shouldHideUnreadableChunk(user: ApiUser) {
  return user.role === 'client'
}

function selectedEntityMatches(chunk: AgentMemoryChunk, selectedEntity?: AgentEntityCandidate | null) {
  if (!selectedEntity) return true
  if (selectedEntity.type === 'organization') return chunk.orgId === selectedEntity.id || chunk.orgId === selectedEntity.orgId
  if (chunk.sourceId === selectedEntity.id || chunk.sourceType === selectedEntity.sourceType) {
    return chunk.sourceId === selectedEntity.id
  }
  return (chunk.entityRefs ?? []).some((ref) => ref.id === selectedEntity.id && ref.type === selectedEntity.type)
}

function citationFor(chunk: AgentMemoryChunk): AgentMemoryCitation {
  return {
    orgId: chunk.orgId,
    sourceType: chunk.sourceType,
    sourceId: chunk.sourceId,
    sourcePath: chunk.sourcePath,
    title: chunk.title,
  }
}

function serializeDoc(id: string, data: Record<string, unknown>): AgentMemoryChunk {
  return {
    id,
    orgId: String(data.orgId ?? ''),
    sourceType: String(data.sourceType ?? 'unknown'),
    sourceId: String(data.sourceId ?? id),
    sourcePath: typeof data.sourcePath === 'string' ? data.sourcePath : undefined,
    title: typeof data.title === 'string' ? data.title : 'Untitled memory',
    summary: typeof data.summary === 'string' ? data.summary : undefined,
    text: typeof data.text === 'string' ? data.text : '',
    entityRefs: Array.isArray(data.entityRefs) ? data.entityRefs : [],
    sensitivity: sensitivityFrom(data.sensitivity),
    allowedAgentIds: Array.isArray(data.allowedAgentIds) ? data.allowedAgentIds : [],
    sourceUpdatedAt: data.sourceUpdatedAt,
    sourceHash: typeof data.sourceHash === 'string' ? data.sourceHash : '',
    chunkIndex: typeof data.chunkIndex === 'number' ? data.chunkIndex : 0,
    embeddingModel: typeof data.embeddingModel === 'string' ? data.embeddingModel : AGENT_MEMORY_EMBEDDING_MODEL,
    embeddingDimension: typeof data.embeddingDimension === 'number' ? data.embeddingDimension : 0,
    distance: typeof data.distance === 'number' ? data.distance : undefined,
  }
}

export async function retrieveAgentMemory(input: RetrieveAgentMemoryInput): Promise<AgentMemoryRetrievalResult> {
  const limit = Math.min(Math.max(input.limit ?? 8, 1), 30)
  const { embedding } = await embed({
    model: AGENT_MEMORY_EMBEDDING_MODEL as EmbedModel,
    value: input.query,
  })

  const baseQuery = (adminDb.collection(AGENT_MEMORY_COLLECTION) as unknown as FirestoreVectorQuery)
    .where('orgId', '==', input.orgId)
  const vectorQuery = baseQuery.findNearest({
    vectorField: 'embedding',
    queryVector: embedding,
    limit: Math.min(limit * 4, 100),
    distanceMeasure: 'COSINE',
    distanceResultField: 'distance',
  })
  const snap = await vectorQuery.get()
  const sourceTypeSet = input.sourceTypes?.length ? new Set(input.sourceTypes) : null
  const memory: AgentMemoryChunk[] = []

  for (const doc of snap.docs) {
    const chunk = serializeDoc(doc.id, doc.data())
    if (sourceTypeSet && !sourceTypeSet.has(String(chunk.sourceType))) continue
    if (!selectedEntityMatches(chunk, input.selectedEntity)) continue
    if (!canReadChunk(input.user, chunk)) {
      if (shouldHideUnreadableChunk(input.user)) continue
      memory.push({
        ...chunk,
        text: `Redacted sensitive memory. Source: ${chunk.title}.`,
        summary: chunk.summary ? 'Redacted sensitive memory.' : undefined,
        redacted: true,
      })
    } else {
      memory.push(chunk)
    }
    if (memory.length >= limit) break
  }

  const seen = new Set<string>()
  const citations = memory.flatMap((chunk) => {
    const key = `${chunk.sourceType}:${chunk.sourceId}`
    if (seen.has(key)) return []
    seen.add(key)
    return [citationFor(chunk)]
  })

  return { memory, citations }
}
