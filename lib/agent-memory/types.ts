import type { ApiUser } from '@/lib/api/types'

export const AGENT_MEMORY_COLLECTION = 'agent_memory_chunks'
export const AGENT_MEMORY_EMBEDDING_MODEL = 'openai/text-embedding-3-small'
export const AGENT_MEMORY_EMBEDDING_DIMENSION = 1536

export type AgentMemorySensitivity = 'public' | 'internal' | 'restricted' | 'sensitive'

export type AgentMemorySourceType =
  | 'organization'
  | 'company'
  | 'contact'
  | 'deal'
  | 'activity'
  | 'project'
  | 'task'
  | 'conversation'
  | 'conversation_message'
  | 'research_item'
  | 'research_source'
  | 'client_document'
  | 'support_ticket'
  | 'support_message'
  | 'mailbox_message'
  | 'social_post'
  | 'ad_connection'
  | 'ad_campaign'
  | 'knowledge_note'
  | string

export type AgentMemoryEntityType =
  | 'organization'
  | 'company'
  | 'contact'
  | 'deal'
  | 'project'
  | 'task'
  | 'conversation'
  | 'document'
  | 'research'
  | string

export interface AgentMemoryEntityRef {
  type: AgentMemoryEntityType
  id: string
  label?: string
  orgId?: string
}

export interface AgentMemorySource {
  orgId: string
  sourceType: AgentMemorySourceType
  sourceId: string
  sourcePath?: string
  title: string
  summary?: string
  text: string
  entityRefs?: AgentMemoryEntityRef[]
  sensitivity?: AgentMemorySensitivity
  allowedAgentIds?: string[]
  sourceUpdatedAt?: unknown
  metadata?: Record<string, unknown>
  deleted?: boolean
}

export interface AgentMemoryChunk extends Omit<AgentMemorySource, 'metadata' | 'deleted'> {
  id: string
  chunkIndex: number
  text: string
  sourceHash: string
  embeddingModel: string
  embeddingDimension: number
  distance?: number
  redacted?: boolean
}

export interface AgentEntityCandidate {
  type: AgentMemoryEntityType
  id: string
  orgId: string
  label: string
  subtitle?: string
  sourcePath?: string
  score: number
  matchReason: 'exact_name' | 'alias' | 'contains' | 'token_match'
  sourceType: AgentMemorySourceType
}

export interface AgentEntityResolutionResult {
  intent: 'entity_lookup' | 'memory_search'
  entityCandidates: AgentEntityCandidate[]
  selectedEntity: AgentEntityCandidate | null
  nextActions: string[]
}

export interface AgentLookupInput {
  query: string
  orgId: string
  sourceTypes?: string[]
  limit?: number
  user: ApiUser
}

export interface AgentMemoryCitation {
  sourceType: AgentMemorySourceType
  sourceId: string
  sourcePath?: string
  title: string
  orgId: string
}

export interface AgentMemoryRetrievalResult {
  memory: AgentMemoryChunk[]
  citations: AgentMemoryCitation[]
}

export interface AgentMemoryIndexSummary {
  sources: number
  chunks: number
  embedded: number
  skipped: number
  errors: Array<{ sourceId: string; sourceType: string; error: string }>
}
