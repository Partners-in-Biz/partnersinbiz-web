import { embedMany } from 'ai'
import { FieldValue } from 'firebase-admin/firestore'
import { callAgentPath } from '@/lib/agents/team'
import { adminDb } from '@/lib/firebase/admin'
import {
  AGENT_MEMORY_COLLECTION,
  AGENT_MEMORY_EMBEDDING_DIMENSION,
  AGENT_MEMORY_EMBEDDING_MODEL,
  type AgentMemoryEntityRef,
  type AgentMemoryIndexSummary,
  type AgentMemorySensitivity,
  type AgentMemorySource,
  type AgentMemorySourceType,
} from './types'
import { hashMemorySource, memoryDocId, sourceToChunkTexts } from './text'

type EmbedManyModel = Parameters<typeof embedMany>[0]['model']
type FirestoreMemoryDoc = {
  id: string
  data: () => Record<string, unknown>
  ref?: {
    path?: string
    delete?: () => Promise<unknown>
    collection?: (name: string) => FirestoreMemoryQuery
  }
}
type FirestoreMemoryQuery = {
  where: (field: string, op: string, value: unknown) => FirestoreMemoryQuery
  limit: (limit: number) => FirestoreMemoryQuery
  get: () => Promise<{ docs: FirestoreMemoryDoc[] }>
}
type KnowledgeListItem = {
  type?: string
  path: string
  name?: string
  updatedAt?: unknown
}
type PreparedChunk = {
  source: AgentMemorySource
  sourceHash: string
  index: number
  text: string
}

const DEFAULT_LIMIT = 500
const SENSITIVE_SOURCE_TYPES = new Set(['mailbox_message', 'support_ticket', 'support_message', 'social_post', 'ad_campaign', 'ad_connection'])

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function toMillis(value: unknown): number {
  if (!value) return 0
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') return Date.parse(value) || 0
  if (typeof value === 'object') {
    const source = value as { toDate?: () => Date; seconds?: number; _seconds?: number }
    if (typeof source.toDate === 'function') return source.toDate().getTime()
    const seconds = source.seconds ?? source._seconds
    if (typeof seconds === 'number') return seconds * 1000
  }
  return 0
}

function compactText(parts: unknown[]) {
  return parts
    .flatMap((part) => {
      if (Array.isArray(part)) return part
      return [part]
    })
    .map((part) => {
      if (typeof part === 'string') return part.trim()
      if (typeof part === 'number' || typeof part === 'boolean') return String(part)
      if (part && typeof part === 'object') return JSON.stringify(part)
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function vectorValue(embedding: number[]) {
  const maybeVector = (FieldValue as unknown as { vector?: (values: number[]) => unknown }).vector
  return typeof maybeVector === 'function' ? maybeVector(embedding) : embedding
}

function sourceSensitivity(sourceType: AgentMemorySourceType): AgentMemorySensitivity {
  return SENSITIVE_SOURCE_TYPES.has(String(sourceType)) ? 'sensitive' : 'internal'
}

function baseEntityRefs(sourceType: AgentMemorySourceType, sourceId: string, title: string, orgId: string): AgentMemoryEntityRef[] {
  const type = sourceType === 'client_document' ? 'document' : sourceType === 'research_item' ? 'research' : sourceType.replace(/_message$/, '') as AgentMemoryEntityRef['type']
  return [{ type, id: sourceId, label: title, orgId }]
}

function isKnowledgeListItem(value: unknown): value is KnowledgeListItem {
  return Boolean(
    value &&
    typeof value === 'object' &&
    (value as { type?: unknown }).type === 'file' &&
    typeof (value as { path?: unknown }).path === 'string',
  )
}

async function existingChunkDocs(source: Pick<AgentMemorySource, 'orgId' | 'sourceType' | 'sourceId'>): Promise<FirestoreMemoryDoc[]> {
  const snap = await (adminDb.collection(AGENT_MEMORY_COLLECTION) as unknown as FirestoreMemoryQuery)
    .where('orgId', '==', source.orgId)
    .where('sourceType', '==', source.sourceType)
    .where('sourceId', '==', source.sourceId)
    .limit(500)
    .get()
  return snap.docs
}

async function deleteChunkDocs(docs: FirestoreMemoryDoc[], shouldDelete: (doc: FirestoreMemoryDoc) => boolean): Promise<number> {
  const deletes = docs
    .filter(shouldDelete)
    .map((doc) => doc.ref?.delete?.())
    .filter((operation): operation is Promise<unknown> => Boolean(operation))
  await Promise.all(deletes)
  return deletes.length
}

async function deleteSourceChunks(source: AgentMemorySource): Promise<number> {
  return deleteChunkDocs(await existingChunkDocs(source), () => true)
}

async function deleteStaleSourceChunks(source: AgentMemorySource, sourceHash: string, chunkCount: number): Promise<number> {
  return deleteChunkDocs(await existingChunkDocs(source), (doc) => {
    const data = doc.data()
    return data.sourceHash !== sourceHash || (typeof data.chunkIndex === 'number' && data.chunkIndex >= chunkCount)
  })
}

interface FirestoreSourceConfig {
  collection: string
  sourceType: AgentMemorySourceType
  titleFields: string[]
  textFields: string[]
  orgFromId?: boolean
}

const FIRESTORE_SOURCE_CONFIGS: FirestoreSourceConfig[] = [
  { collection: 'organizations', sourceType: 'organization', titleFields: ['name', 'displayName', 'slug'], textFields: ['name', 'slug', 'industry', 'description', 'brandProfile'], orgFromId: true },
  { collection: 'companies', sourceType: 'company', titleFields: ['name'], textFields: ['name', 'website', 'industry', 'description', 'notes', 'tags'] },
  { collection: 'contacts', sourceType: 'contact', titleFields: ['name', 'email'], textFields: ['name', 'email', 'company', 'phone', 'notes', 'tags'] },
  { collection: 'deals', sourceType: 'deal', titleFields: ['title', 'name'], textFields: ['title', 'description', 'value', 'stageId', 'pipelineId', 'notes'] },
  { collection: 'activities', sourceType: 'activity', titleFields: ['title', 'description', 'type'], textFields: ['type', 'description', 'entityTitle', 'metadata'] },
  { collection: 'projects', sourceType: 'project', titleFields: ['name', 'title'], textFields: ['name', 'title', 'description', 'brief', 'status'] },
  { collection: 'conversations', sourceType: 'conversation', titleFields: ['title'], textFields: ['title', 'lastMessagePreview', 'participants', 'scope', 'scopeRefId'] },
  { collection: 'research_items', sourceType: 'research_item', titleFields: ['title'], textFields: ['title', 'summary', 'notesMarkdown', 'findings', 'recommendations', 'tags'] },
  { collection: 'client_documents', sourceType: 'client_document', titleFields: ['title'], textFields: ['title', 'type', 'status', 'linked', 'summary'] },
  { collection: 'support_tickets', sourceType: 'support_ticket', titleFields: ['subject', 'title'], textFields: ['subject', 'title', 'summary', 'description', 'status', 'priority'] },
  { collection: 'mailbox_messages', sourceType: 'mailbox_message', titleFields: ['subject'], textFields: ['subject', 'from', 'to', 'snippet', 'bodyText', 'folder'] },
  { collection: 'social_posts', sourceType: 'social_post', titleFields: ['title', 'platform'], textFields: ['title', 'content', 'caption', 'platform', 'status'] },
  { collection: 'ad_connections', sourceType: 'ad_connection', titleFields: ['platform', 'accountName'], textFields: ['platform', 'accountName', 'status', 'metadata'] },
  { collection: 'ad_campaigns', sourceType: 'ad_campaign', titleFields: ['name', 'campaignName'], textFields: ['name', 'campaignName', 'platform', 'status', 'objective', 'budget'] },
]

function docToSource(
  sourceType: AgentMemorySourceType,
  doc: FirestoreMemoryDoc,
  config: FirestoreSourceConfig,
  requestedOrgId?: string,
): AgentMemorySource | null {
  const data = doc.data()
  if (data.deleted === true || data.archived === true) return null
  const orgId = config.orgFromId ? doc.id : asString(data.orgId) || requestedOrgId || ''
  if (!orgId) return null
  const title = config.titleFields.map((field) => asString(data[field])).find(Boolean) ?? `${sourceType} ${doc.id}`
  const text = compactText(config.textFields.map((field) => data[field]))
  if (!text && !title) return null
  return {
    orgId,
    sourceType,
    sourceId: doc.id,
    sourcePath: doc.ref?.path,
    title,
    summary: asString(data.summary) || undefined,
    text,
    entityRefs: baseEntityRefs(sourceType, doc.id, title, orgId),
    sensitivity: sourceSensitivity(sourceType),
    sourceUpdatedAt: data.updatedAt ?? data.createdAt ?? null,
    metadata: { collection: config.collection },
  }
}

async function getCollectionDocs(config: FirestoreSourceConfig, orgId: string, limit: number) {
  let query = adminDb.collection(config.collection) as unknown as FirestoreMemoryQuery
  if (!config.orgFromId) query = query.where('orgId', '==', orgId)
  const snap = await query.limit(limit).get()
  return snap.docs
    .map((doc) => docToSource(config.sourceType, doc, config, orgId))
    .filter((source): source is AgentMemorySource => Boolean(source))
}

async function collectTaskSources(orgId: string, limit: number): Promise<AgentMemorySource[]> {
  const db = adminDb as unknown as { collectionGroup: (collectionId: string) => FirestoreMemoryQuery }
  const snap = await db.collectionGroup('tasks').where('orgId', '==', orgId).limit(limit).get()
  return snap.docs
    .map((doc) => docToSource('task', doc, {
      collection: 'tasks',
      sourceType: 'task',
      titleFields: ['title', 'name'],
      textFields: ['title', 'description', 'status', 'priority', 'agentInput', 'agentOutput'],
    }, orgId))
    .filter((source): source is AgentMemorySource => Boolean(source))
}

async function collectConversationMessageSources(orgId: string, limit: number): Promise<AgentMemorySource[]> {
  const convSnap = await (adminDb.collection('conversations') as unknown as FirestoreMemoryQuery)
    .where('orgId', '==', orgId)
    .limit(Math.min(limit, 100))
    .get()
  const sources: AgentMemorySource[] = []
  for (const conv of convSnap.docs) {
    const messagesQuery = conv.ref?.collection?.('messages')
    if (!messagesQuery) continue
    const messages = await messagesQuery.limit(50).get()
    for (const message of messages.docs) {
      const data = message.data()
      const content = asString(data.content)
      if (!content) continue
      sources.push({
        orgId,
        sourceType: 'conversation_message',
        sourceId: `${conv.id}/${message.id}`,
        sourcePath: message.ref?.path,
        title: `Conversation message ${conv.id}`,
        text: compactText([data.authorDisplayName, data.role, content]),
        entityRefs: [
          { type: 'conversation', id: conv.id, orgId },
          { type: 'conversation_message', id: message.id, orgId },
        ],
        sensitivity: 'internal',
        sourceUpdatedAt: data.createdAt ?? null,
      })
    }
  }
  return sources.slice(0, limit)
}

async function collectResearchSourceSources(orgId: string, limit: number): Promise<AgentMemorySource[]> {
  const items = await (adminDb.collection('research_items') as unknown as FirestoreMemoryQuery)
    .where('orgId', '==', orgId)
    .limit(Math.min(limit, 100))
    .get()
  const sources: AgentMemorySource[] = []
  for (const item of items.docs) {
    const sourcesQuery = item.ref?.collection?.('sources')
    if (!sourcesQuery) continue
    const sourceSnap = await sourcesQuery.limit(50).get()
    for (const sourceDoc of sourceSnap.docs) {
      const data = sourceDoc.data()
      const title = asString(data.title) || `Research source ${sourceDoc.id}`
      sources.push({
        orgId,
        sourceType: 'research_source',
        sourceId: `${item.id}/${sourceDoc.id}`,
        sourcePath: sourceDoc.ref?.path,
        title,
        text: compactText([title, data.excerpt, data.rawText, data.url, data.publisher, data.metadata]),
        entityRefs: [
          { type: 'research', id: item.id, orgId },
          { type: 'research_source', id: sourceDoc.id, label: title, orgId },
        ],
        sensitivity: 'internal',
        sourceUpdatedAt: data.updatedAt ?? data.createdAt ?? null,
      })
    }
  }
  return sources.slice(0, limit)
}

export async function collectFirestoreMemorySources(input: { orgId: string; sourceTypes?: string[]; limit?: number }): Promise<AgentMemorySource[]> {
  const limit = input.limit ?? DEFAULT_LIMIT
  const allowed = input.sourceTypes?.length ? new Set(input.sourceTypes) : null
  const configs = FIRESTORE_SOURCE_CONFIGS.filter((config) => !allowed || allowed.has(String(config.sourceType)))
  const sources = (await Promise.all(configs.map((config) => getCollectionDocs(config, input.orgId, limit)))).flat()
  if (!allowed || allowed.has('task')) sources.push(...await collectTaskSources(input.orgId, limit))
  if (!allowed || allowed.has('conversation_message')) sources.push(...await collectConversationMessageSources(input.orgId, limit))
  if (!allowed || allowed.has('research_source')) sources.push(...await collectResearchSourceSources(input.orgId, limit))
  return sources
}

async function listKnowledgeSection(agent: string, section: string) {
  const upstream = await callAgentPath('pip', `/admin/knowledge?scope=agent&agent=${encodeURIComponent(agent)}&section=${encodeURIComponent(section)}`)
  if (!upstream.response.ok) return []
  const data = upstream.data as { items?: unknown; data?: { items?: unknown } }
  const items = data.items ?? data.data?.items ?? []
  return Array.isArray(items) ? items.filter(isKnowledgeListItem) : []
}

async function readKnowledgeNote(agent: string, section: string, path: string) {
  const search = new URLSearchParams({ scope: 'agent', agent, section, path })
  const upstream = await callAgentPath('pip', `/admin/knowledge?${search.toString()}`)
  if (!upstream.response.ok) return null
  const data = upstream.data as { content?: unknown; data?: { content?: unknown } }
  return typeof data.content === 'string' ? data.content : typeof data.data?.content === 'string' ? data.data.content : null
}

export async function collectKnowledgeMemorySources(input: { orgId: string; agentSlug: string; sections?: string[]; limit?: number }): Promise<AgentMemorySource[]> {
  const sections = input.sections ?? ['index', 'wiki', 'raw', 'logs']
  const limit = input.limit ?? 200
  const sources: AgentMemorySource[] = []
  for (const section of sections) {
    const items = await listKnowledgeSection(input.agentSlug, section)
    for (const item of items.slice(0, limit)) {
      const content = await readKnowledgeNote(input.agentSlug, section, item.path)
      if (!content) continue
      sources.push({
        orgId: input.orgId,
        sourceType: 'knowledge_note',
        sourceId: `${section}/${item.path}`,
        sourcePath: `${input.agentSlug}/${section}/${item.path}`,
        title: item.name ?? item.path,
        text: content,
        entityRefs: [{ type: 'organization', id: input.orgId, orgId: input.orgId, label: input.agentSlug }],
        sensitivity: section === 'raw' || section === 'logs' ? 'restricted' : 'internal',
        sourceUpdatedAt: item.updatedAt ?? null,
        metadata: { section, agent: input.agentSlug },
      })
    }
  }
  return sources.slice(0, limit)
}

export async function indexAgentMemorySources(sources: AgentMemorySource[]): Promise<AgentMemoryIndexSummary> {
  const summary: AgentMemoryIndexSummary = { sources: sources.length, chunks: 0, embedded: 0, skipped: 0, errors: [] }
  const prepared: PreparedChunk[] = []
  for (const source of sources) {
    if (!source.orgId || !source.sourceId) {
      summary.skipped += 1
      continue
    }
    if (source.deleted) {
      await deleteSourceChunks(source)
      summary.skipped += 1
      continue
    }
    if (!source.text.trim()) {
      summary.skipped += 1
      continue
    }
    const sourceHash = hashMemorySource(source)
    const chunks = sourceToChunkTexts(source)
    await deleteStaleSourceChunks(source, sourceHash, chunks.length)
    prepared.push(...chunks.map((chunk) => ({ source, sourceHash, ...chunk })))
  }
  summary.chunks = prepared.length
  if (prepared.length === 0) return summary

  const { embeddings } = await embedMany({
    model: AGENT_MEMORY_EMBEDDING_MODEL as EmbedManyModel,
    values: prepared.map((chunk) => chunk.text),
  })

  await Promise.all(prepared.map(async (chunk, index) => {
    const embedding = embeddings[index]
    if (!embedding) {
      summary.errors.push({ sourceId: chunk.source.sourceId, sourceType: String(chunk.source.sourceType), error: 'missing embedding' })
      return
    }
    await adminDb.collection(AGENT_MEMORY_COLLECTION).doc(memoryDocId(chunk.source, chunk.index)).set({
      orgId: chunk.source.orgId,
      sourceType: chunk.source.sourceType,
      sourceId: chunk.source.sourceId,
      sourcePath: chunk.source.sourcePath,
      title: chunk.source.title,
      summary: chunk.source.summary ?? '',
      text: chunk.text,
      entityRefs: chunk.source.entityRefs ?? [],
      sensitivity: chunk.source.sensitivity ?? sourceSensitivity(chunk.source.sourceType),
      allowedAgentIds: chunk.source.allowedAgentIds ?? [],
      sourceUpdatedAt: chunk.source.sourceUpdatedAt ?? null,
      sourceUpdatedAtMillis: toMillis(chunk.source.sourceUpdatedAt),
      sourceHash: chunk.sourceHash,
      chunkIndex: chunk.index,
      embedding: vectorValue(embedding),
      embeddingModel: AGENT_MEMORY_EMBEDDING_MODEL,
      embeddingDimension: AGENT_MEMORY_EMBEDDING_DIMENSION,
      indexedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    summary.embedded += 1
  }))

  return summary
}

export async function reindexAgentMemory(input: {
  orgId: string
  agentSlug?: string
  sourceTypes?: string[]
  includeKnowledge?: boolean
  limit?: number
}): Promise<AgentMemoryIndexSummary> {
  const sources = await collectFirestoreMemorySources({
    orgId: input.orgId,
    sourceTypes: input.sourceTypes,
    limit: input.limit,
  })
  if (input.includeKnowledge !== false && input.agentSlug) {
    sources.push(...await collectKnowledgeMemorySources({
      orgId: input.orgId,
      agentSlug: input.agentSlug,
      limit: input.limit,
    }))
  }
  return indexAgentMemorySources(sources)
}
