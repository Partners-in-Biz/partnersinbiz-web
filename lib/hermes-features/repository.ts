/**
 * Durable Hermes Features repository.
 * Memory backend for unit tests; Firestore backend for production (survives cold starts).
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type {
  BatchJobResult,
  CheckpointSnapshot,
  CredentialPool,
  CronJobSpec,
  CuratedMemoryDoc,
  DelegationChild,
  EventHookConfig,
  McpServerConfig,
  MemoryProviderBinding,
  PluginRecord,
  ProgressiveSkillMeta,
  ProviderRoutingPolicy,
  ToolsetPolicy,
} from './types'
import { defaultToolsetPolicy } from './toolsets'
import { emptyMemory } from './memory-curated'

export const HERMES_FEATURES_COLLECTION = 'hermes_features'

export interface DelegationRecord {
  id: string
  orgId: string
  agentId: string
  conversationId?: string
  /** System message in the parent thread that holds the branch rich part. */
  branchMessageId?: string
  parentRunHint: string
  maxConcurrent: number
  children: Array<DelegationChild & { runId?: string; runDocId?: string }>
  createdAt: string
  updatedAt: string
}

export interface HermesFeaturesRepository {
  reset?(): void | Promise<void>
  getToolsetPolicy(orgId: string, agentId: string, conversationId?: string): Promise<ToolsetPolicy>
  setToolsetPolicy(policy: ToolsetPolicy): Promise<ToolsetPolicy>
  getMemory(orgId: string, agentId: string): Promise<CuratedMemoryDoc>
  setMemory(doc: CuratedMemoryDoc): Promise<CuratedMemoryDoc>
  getSkills(orgId: string, agentId: string): Promise<ProgressiveSkillMeta[]>
  setSkills(orgId: string, agentId: string, skills: ProgressiveSkillMeta[]): Promise<ProgressiveSkillMeta[]>
  listCheckpoints(orgId: string, conversationId: string): Promise<CheckpointSnapshot[]>
  addCheckpoint(snapshot: CheckpointSnapshot): Promise<CheckpointSnapshot>
  getCheckpoint(orgId: string, conversationId: string, id: string): Promise<CheckpointSnapshot | null>
  getWorkspaceFiles(orgId: string, conversationId: string): Promise<Record<string, string>>
  setWorkspaceFiles(orgId: string, conversationId: string, files: Record<string, string>): Promise<void>
  listCron(orgId: string): Promise<CronJobSpec[]>
  upsertCron(job: CronJobSpec): Promise<CronJobSpec>
  listHooks(orgId: string): Promise<EventHookConfig[]>
  upsertHook(hook: EventHookConfig): Promise<EventHookConfig>
  listBatchJobs(orgId: string): Promise<BatchJobResult[]>
  addBatchJob(job: BatchJobResult): Promise<BatchJobResult>
  listMcp(orgId: string): Promise<McpServerConfig[]>
  upsertMcp(server: McpServerConfig): Promise<McpServerConfig>
  getRouting(orgId: string): Promise<ProviderRoutingPolicy>
  setRouting(policy: ProviderRoutingPolicy): Promise<ProviderRoutingPolicy>
  listCredentialPools(orgId: string): Promise<CredentialPool[]>
  upsertCredentialPool(pool: CredentialPool): Promise<CredentialPool>
  listMemoryProviders(orgId: string, agentId?: string): Promise<MemoryProviderBinding[]>
  upsertMemoryProvider(binding: MemoryProviderBinding): Promise<MemoryProviderBinding>
  listPlugins(orgId: string): Promise<PluginRecord[]>
  setPlugins(orgId: string, plugins: PluginRecord[]): Promise<PluginRecord[]>
  getAppliedPersonality(orgId: string, agentId: string): Promise<string | null>
  applyPersonality(orgId: string, agentId: string, presetId: string): Promise<string>
  saveDelegation(record: DelegationRecord): Promise<DelegationRecord>
  getDelegation(orgId: string, id: string): Promise<DelegationRecord | null>
  listDelegations(orgId: string, conversationId?: string): Promise<DelegationRecord[]>
}

function cloneToolset(p: ToolsetPolicy): ToolsetPolicy {
  return { ...p, enabled: [...p.enabled] }
}

/** Process-local durable map used by tests and as Firestore fallback when writes fail. */
export class MemoryHermesFeaturesRepository implements HermesFeaturesRepository {
  private toolsets = new Map<string, ToolsetPolicy>()
  private memories = new Map<string, CuratedMemoryDoc>()
  private skills = new Map<string, ProgressiveSkillMeta[]>()
  private checkpoints = new Map<string, CheckpointSnapshot[]>()
  private cronJobs = new Map<string, CronJobSpec[]>()
  private hooks = new Map<string, EventHookConfig[]>()
  private batchJobs = new Map<string, BatchJobResult[]>()
  private mcpServers = new Map<string, McpServerConfig[]>()
  private routing = new Map<string, ProviderRoutingPolicy>()
  private credentialPools = new Map<string, CredentialPool[]>()
  private memoryProviders = new Map<string, MemoryProviderBinding[]>()
  private plugins = new Map<string, PluginRecord[]>()
  private personality = new Map<string, Record<string, string>>()
  private workspaceFiles = new Map<string, Record<string, string>>()
  private delegations = new Map<string, DelegationRecord>()

  private toolsetKey(orgId: string, agentId: string, conversationId?: string): string {
    return conversationId ? `${orgId}::${agentId}::${conversationId}` : `${orgId}::${agentId}`
  }

  reset(): void {
    this.toolsets.clear()
    this.memories.clear()
    this.skills.clear()
    this.checkpoints.clear()
    this.cronJobs.clear()
    this.hooks.clear()
    this.batchJobs.clear()
    this.mcpServers.clear()
    this.routing.clear()
    this.credentialPools.clear()
    this.memoryProviders.clear()
    this.plugins.clear()
    this.personality.clear()
    this.workspaceFiles.clear()
    this.delegations.clear()
  }

  async getToolsetPolicy(orgId: string, agentId: string, conversationId?: string): Promise<ToolsetPolicy> {
    const specific = conversationId
      ? this.toolsets.get(this.toolsetKey(orgId, agentId, conversationId))
      : undefined
    if (specific) return cloneToolset(specific)
    const base = this.toolsets.get(this.toolsetKey(orgId, agentId))
    if (base) return cloneToolset(base)
    return defaultToolsetPolicy(orgId, agentId, conversationId)
  }

  async setToolsetPolicy(policy: ToolsetPolicy): Promise<ToolsetPolicy> {
    const next = cloneToolset(policy)
    this.toolsets.set(this.toolsetKey(policy.orgId, policy.agentId, policy.conversationId), next)
    return cloneToolset(next)
  }

  async getMemory(orgId: string, agentId: string): Promise<CuratedMemoryDoc> {
    const key = `${orgId}::${agentId}`
    const existing = this.memories.get(key)
    if (existing) return { ...existing }
    const empty = emptyMemory(orgId, agentId)
    this.memories.set(key, empty)
    return { ...empty }
  }

  async setMemory(doc: CuratedMemoryDoc): Promise<CuratedMemoryDoc> {
    const next = { ...doc }
    this.memories.set(`${doc.orgId}::${doc.agentId}`, next)
    return { ...next }
  }

  async getSkills(orgId: string, agentId: string): Promise<ProgressiveSkillMeta[]> {
    return (this.skills.get(`${orgId}::${agentId}`) || []).map((s) => ({ ...s }))
  }

  async setSkills(orgId: string, agentId: string, skills: ProgressiveSkillMeta[]): Promise<ProgressiveSkillMeta[]> {
    const next = skills.map((s) => ({ ...s }))
    this.skills.set(`${orgId}::${agentId}`, next)
    return next.map((s) => ({ ...s }))
  }

  async listCheckpoints(orgId: string, conversationId: string): Promise<CheckpointSnapshot[]> {
    return (this.checkpoints.get(`${orgId}::${conversationId}`) || []).map((c) => ({
      ...c,
      files: { ...c.files },
    }))
  }

  async addCheckpoint(snapshot: CheckpointSnapshot): Promise<CheckpointSnapshot> {
    const key = `${snapshot.orgId}::${snapshot.conversationId}`
    const list = this.checkpoints.get(key) || []
    list.unshift({ ...snapshot, files: { ...snapshot.files } })
    this.checkpoints.set(key, list)
    return { ...snapshot, files: { ...snapshot.files } }
  }

  async getCheckpoint(orgId: string, conversationId: string, id: string): Promise<CheckpointSnapshot | null> {
    return (await this.listCheckpoints(orgId, conversationId)).find((c) => c.id === id) ?? null
  }

  async getWorkspaceFiles(orgId: string, conversationId: string): Promise<Record<string, string>> {
    return { ...(this.workspaceFiles.get(`${orgId}::${conversationId}`) || {}) }
  }

  async setWorkspaceFiles(orgId: string, conversationId: string, files: Record<string, string>): Promise<void> {
    this.workspaceFiles.set(`${orgId}::${conversationId}`, { ...files })
  }

  async listCron(orgId: string): Promise<CronJobSpec[]> {
    return (this.cronJobs.get(orgId) || []).map((j) => ({ ...j, skillIds: j.skillIds ? [...j.skillIds] : undefined }))
  }

  async upsertCron(job: CronJobSpec): Promise<CronJobSpec> {
    const list = this.cronJobs.get(job.orgId) || []
    const idx = list.findIndex((j) => j.id === job.id)
    const next = { ...job, skillIds: job.skillIds ? [...job.skillIds] : undefined }
    if (idx >= 0) list[idx] = next
    else list.push(next)
    this.cronJobs.set(job.orgId, list)
    return { ...next }
  }

  async listHooks(orgId: string): Promise<EventHookConfig[]> {
    return (this.hooks.get(orgId) || []).map((h) => ({ ...h, config: { ...h.config } }))
  }

  async upsertHook(hook: EventHookConfig): Promise<EventHookConfig> {
    const list = this.hooks.get(hook.orgId) || []
    const idx = list.findIndex((h) => h.id === hook.id)
    const next = { ...hook, config: { ...hook.config } }
    if (idx >= 0) list[idx] = next
    else list.push(next)
    this.hooks.set(hook.orgId, list)
    return { ...next, config: { ...next.config } }
  }

  async listBatchJobs(orgId: string): Promise<BatchJobResult[]> {
    return (this.batchJobs.get(orgId) || []).map((b) => ({
      ...b,
      items: b.items.map((i) => ({ ...i })),
    }))
  }

  async addBatchJob(job: BatchJobResult): Promise<BatchJobResult> {
    const list = this.batchJobs.get(job.orgId) || []
    list.unshift({ ...job, items: job.items.map((i) => ({ ...i })) })
    this.batchJobs.set(job.orgId, list)
    return { ...job, items: job.items.map((i) => ({ ...i })) }
  }

  async listMcp(orgId: string): Promise<McpServerConfig[]> {
    return (this.mcpServers.get(orgId) || []).map((s) => ({
      ...s,
      toolAllowlist: s.toolAllowlist ? [...s.toolAllowlist] : undefined,
      toolDenylist: s.toolDenylist ? [...s.toolDenylist] : undefined,
    }))
  }

  async upsertMcp(server: McpServerConfig): Promise<McpServerConfig> {
    const list = this.mcpServers.get(server.orgId) || []
    const idx = list.findIndex((s) => s.id === server.id)
    const next = {
      ...server,
      toolAllowlist: server.toolAllowlist ? [...server.toolAllowlist] : undefined,
      toolDenylist: server.toolDenylist ? [...server.toolDenylist] : undefined,
    }
    if (idx >= 0) list[idx] = next
    else list.push(next)
    this.mcpServers.set(server.orgId, list)
    return { ...next }
  }

  async getRouting(orgId: string): Promise<ProviderRoutingPolicy> {
    const existing = this.routing.get(orgId)
    if (existing) {
      return {
        ...existing,
        allowlist: [...existing.allowlist],
        denylist: [...existing.denylist],
        priority: [...existing.priority],
      }
    }
    return {
      orgId,
      sort: 'priority',
      allowlist: [],
      denylist: [],
      priority: [],
      updatedAt: new Date().toISOString(),
    }
  }

  async setRouting(policy: ProviderRoutingPolicy): Promise<ProviderRoutingPolicy> {
    const next = {
      ...policy,
      allowlist: [...policy.allowlist],
      denylist: [...policy.denylist],
      priority: [...policy.priority],
    }
    this.routing.set(policy.orgId, next)
    return {
      ...next,
      allowlist: [...next.allowlist],
      denylist: [...next.denylist],
      priority: [...next.priority],
    }
  }

  async listCredentialPools(orgId: string): Promise<CredentialPool[]> {
    return (this.credentialPools.get(orgId) || []).map((p) => ({
      ...p,
      keys: p.keys.map((k) => ({ ...k })),
    }))
  }

  async upsertCredentialPool(pool: CredentialPool): Promise<CredentialPool> {
    const list = this.credentialPools.get(pool.orgId) || []
    const idx = list.findIndex((p) => p.provider === pool.provider)
    const next = { ...pool, keys: pool.keys.map((k) => ({ ...k })) }
    if (idx >= 0) list[idx] = next
    else list.push(next)
    this.credentialPools.set(pool.orgId, list)
    return { ...next, keys: next.keys.map((k) => ({ ...k })) }
  }

  async listMemoryProviders(orgId: string, agentId?: string): Promise<MemoryProviderBinding[]> {
    const all = this.memoryProviders.get(orgId) || []
    const filtered = agentId ? all.filter((b) => b.agentId === agentId) : all
    return filtered.map((b) => ({ ...b, config: { ...b.config } }))
  }

  async upsertMemoryProvider(binding: MemoryProviderBinding): Promise<MemoryProviderBinding> {
    const list = this.memoryProviders.get(binding.orgId) || []
    const idx = list.findIndex((b) => b.agentId === binding.agentId && b.provider === binding.provider)
    const next = { ...binding, config: { ...binding.config } }
    if (idx >= 0) list[idx] = next
    else list.push(next)
    this.memoryProviders.set(binding.orgId, list)
    return { ...next, config: { ...next.config } }
  }

  async listPlugins(orgId: string): Promise<PluginRecord[]> {
    return (this.plugins.get(orgId) || []).map((p) => ({ ...p, contributes: [...p.contributes] }))
  }

  async setPlugins(orgId: string, plugins: PluginRecord[]): Promise<PluginRecord[]> {
    const next = plugins.map((p) => ({ ...p, contributes: [...p.contributes] }))
    this.plugins.set(orgId, next)
    return next.map((p) => ({ ...p, contributes: [...p.contributes] }))
  }

  async getAppliedPersonality(orgId: string, agentId: string): Promise<string | null> {
    return this.personality.get(orgId)?.[agentId] ?? null
  }

  async applyPersonality(orgId: string, agentId: string, presetId: string): Promise<string> {
    const map = this.personality.get(orgId) || {}
    map[agentId] = presetId
    this.personality.set(orgId, map)
    return presetId
  }

  async saveDelegation(record: DelegationRecord): Promise<DelegationRecord> {
    const next = {
      ...record,
      children: record.children.map((c) => ({ ...c })),
    }
    this.delegations.set(`${record.orgId}::${record.id}`, next)
    return { ...next, children: next.children.map((c) => ({ ...c })) }
  }

  async getDelegation(orgId: string, id: string): Promise<DelegationRecord | null> {
    const row = this.delegations.get(`${orgId}::${id}`)
    return row ? { ...row, children: row.children.map((c) => ({ ...c })) } : null
  }

  async listDelegations(orgId: string, conversationId?: string): Promise<DelegationRecord[]> {
    return [...this.delegations.values()]
      .filter((d) => d.orgId === orgId && (!conversationId || d.conversationId === conversationId))
      .map((d) => ({ ...d, children: d.children.map((c) => ({ ...c })) }))
  }
}

export function docId(parts: string[]): string {
  return parts.map((p) => p.replace(/[/\s]/g, '_')).join('__').slice(0, 700)
}

/**
 * Pure aggregate list helpers — one document holds the full list for a kind/scope.
 * Correct-by-construction: list* is a single get, never a multi-kind scan.
 */
export function readAggregateItems<T>(payload: { items?: T[] } | T[] | null | undefined): T[] {
  if (!payload) return []
  if (Array.isArray(payload)) return [...payload]
  if (Array.isArray(payload.items)) return [...payload.items]
  return []
}

export function upsertAggregateItem<T>(
  items: T[],
  item: T,
  keyOf: (row: T) => string,
  options: { prepend?: boolean; max?: number } = {},
): T[] {
  const key = keyOf(item)
  const without = items.filter((row) => keyOf(row) !== key)
  const next = options.prepend ? [item, ...without] : [...without, item]
  if (options.max && next.length > options.max) {
    return options.prepend ? next.slice(0, options.max) : next.slice(-options.max)
  }
  return next
}

/** Minimal doc store for tests / production Firestore adapter. */
export interface HermesFeaturesDocStore {
  get(id: string): Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
  set(id: string, data: Record<string, unknown>, options?: { merge?: boolean }): Promise<void>
  /** Must throw if called — list* must not scan collections. */
  where?(..._args: unknown[]): never
}

export function createInMemoryDocStore(): HermesFeaturesDocStore & { docs: Map<string, Record<string, unknown>> } {
  const docs = new Map<string, Record<string, unknown>>()
  return {
    docs,
    async get(id: string) {
      const data = docs.get(id)
      return {
        exists: data != null,
        data: () => data,
      }
    },
    async set(id: string, data: Record<string, unknown>, options?: { merge?: boolean }) {
      if (options?.merge && docs.has(id)) {
        docs.set(id, { ...docs.get(id), ...data })
      } else {
        docs.set(id, { ...data })
      }
    },
    where(): never {
      throw new Error('list* must not call where() — use aggregate single-doc get')
    },
  }
}

/**
 * Firestore-backed repository. Collection: hermes_features.
 *
 * Listable kinds use **one aggregate document per scope** (same shape as plugins/skills):
 * - cron__{orgId} → { items: CronJobSpec[] }
 * - hook__{orgId} → { items: EventHookConfig[] }
 * - checkpoint__{orgId}__{conversationId} → { items: CheckpointSnapshot[] }
 * - batch__{orgId} → { items: BatchJobResult[] }
 * - mcp__{orgId} → { items: McpServerConfig[] }
 * - credential_pool__{orgId} → { items: CredentialPool[] }
 * - memory_provider__{orgId} → { items: MemoryProviderBinding[] }
 * - delegation__{orgId} → { items: DelegationRecord[] }
 *
 * list* = single get. upsert* = read-merge-write that aggregate. No multi-kind scans.
 */
export class FirestoreHermesFeaturesRepository implements HermesFeaturesRepository {
  private store: HermesFeaturesDocStore | null

  constructor(store?: HermesFeaturesDocStore) {
    this.store = store ?? null
  }

  private col(): {
    doc: (id: string) => {
      get: () => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
      set: (data: Record<string, unknown>, options?: { merge?: boolean }) => Promise<void>
    }
  } {
    if (this.store) {
      const store = this.store
      return {
        doc: (id: string) => ({
          get: () => store.get(id),
          set: async (data, options) => {
            await store.set(id, data, options)
          },
        }),
      }
    }
    // Use the shared static adminDb import. A lazy require() broke under the
    // Next.js production webpack interop (adminDb came back undefined →
    // "Cannot read properties of undefined (reading 'collection')" on every
    // Messages dispatch that wrote hermes_features skill catalog state).
    // adminDb is a lazy Proxy, so importing it is safe for unit tests that
    // never call into FirestoreHermesFeaturesRepository without an injected store.
    if (!adminDb || typeof adminDb.collection !== 'function') {
      throw new Error('hermes_features: Firebase adminDb is unavailable in this process')
    }
    const collection = adminDb.collection(HERMES_FEATURES_COLLECTION)
    return {
      doc: (id: string) => {
        const ref = collection.doc(id)
        return {
          get: async () => {
            const snap = await ref.get()
            return {
              exists: snap.exists,
              data: () => snap.data() as Record<string, unknown> | undefined,
            }
          },
          set: async (data, options) => {
            if (options?.merge) {
              await ref.set(data, { merge: true })
            } else {
              await ref.set(data)
            }
          },
        }
      },
    }
  }

  private serverTimestamp(): unknown {
    if (this.store) return new Date().toISOString()
    return FieldValue.serverTimestamp()
  }

  private async getPayload<T>(id: string): Promise<T | null> {
    const snap = await this.col().doc(id).get()
    if (!snap.exists) return null
    const data = snap.data() as { payload?: T } | undefined
    return (data?.payload as T) ?? null
  }

  private async setPayload(id: string, kind: string, orgId: string, payload: unknown, extra: Record<string, unknown> = {}): Promise<void> {
    await this.col().doc(id).set(
      {
        kind,
        orgId,
        payload,
        updatedAt: this.serverTimestamp(),
        ...extra,
      },
      { merge: true },
    )
  }

  private async getAggregateItems<T>(id: string): Promise<T[]> {
    const payload = await this.getPayload<{ items: T[] } | T[]>(id)
    return readAggregateItems(payload)
  }

  private async setAggregateItems<T>(
    id: string,
    kind: string,
    orgId: string,
    items: T[],
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    await this.setPayload(id, kind, orgId, { items }, extra)
  }

  async getToolsetPolicy(orgId: string, agentId: string, conversationId?: string): Promise<ToolsetPolicy> {
    if (conversationId) {
      const specific = await this.getPayload<ToolsetPolicy>(docId(['toolset', orgId, agentId, conversationId]))
      if (specific) return { ...specific, enabled: [...specific.enabled] }
    }
    const base = await this.getPayload<ToolsetPolicy>(docId(['toolset', orgId, agentId]))
    if (base) return { ...base, enabled: [...base.enabled] }
    return defaultToolsetPolicy(orgId, agentId, conversationId)
  }

  async setToolsetPolicy(policy: ToolsetPolicy): Promise<ToolsetPolicy> {
    const id = docId(['toolset', policy.orgId, policy.agentId, policy.conversationId || ''].filter(Boolean))
    const next = { ...policy, enabled: [...policy.enabled] }
    await this.setPayload(id, 'toolset', policy.orgId, next, {
      agentId: policy.agentId,
      conversationId: policy.conversationId || null,
    })
    return next
  }

  async getMemory(orgId: string, agentId: string): Promise<CuratedMemoryDoc> {
    const existing = await this.getPayload<CuratedMemoryDoc>(docId(['memory', orgId, agentId]))
    if (existing) return { ...existing }
    return emptyMemory(orgId, agentId)
  }

  async setMemory(doc: CuratedMemoryDoc): Promise<CuratedMemoryDoc> {
    const next = { ...doc }
    await this.setPayload(docId(['memory', doc.orgId, doc.agentId]), 'memory', doc.orgId, next, {
      agentId: doc.agentId,
    })
    return next
  }

  async getSkills(orgId: string, agentId: string): Promise<ProgressiveSkillMeta[]> {
    const payload = await this.getPayload<ProgressiveSkillMeta[]>(docId(['skills', orgId, agentId]))
    return (payload || []).map((s) => ({ ...s }))
  }

  async setSkills(orgId: string, agentId: string, skills: ProgressiveSkillMeta[]): Promise<ProgressiveSkillMeta[]> {
    const next = skills.map((s) => ({ ...s }))
    await this.setPayload(docId(['skills', orgId, agentId]), 'skills', orgId, next, { agentId })
    return next.map((s) => ({ ...s }))
  }

  async listCheckpoints(orgId: string, conversationId: string): Promise<CheckpointSnapshot[]> {
    const items = await this.getAggregateItems<CheckpointSnapshot>(
      docId(['checkpoint', orgId, conversationId]),
    )
    return items
      .filter((p) => Boolean(p?.id))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((c) => ({ ...c, files: { ...c.files } }))
  }

  async addCheckpoint(snapshot: CheckpointSnapshot): Promise<CheckpointSnapshot> {
    const next = { ...snapshot, files: { ...snapshot.files } }
    const id = docId(['checkpoint', snapshot.orgId, snapshot.conversationId])
    const items = await this.getAggregateItems<CheckpointSnapshot>(id)
    const merged = upsertAggregateItem(items, next, (c) => c.id, { prepend: true, max: 100 })
    await this.setAggregateItems(id, 'checkpoint', snapshot.orgId, merged, {
      conversationId: snapshot.conversationId,
    })
    return next
  }

  async getCheckpoint(orgId: string, conversationId: string, id: string): Promise<CheckpointSnapshot | null> {
    const items = await this.listCheckpoints(orgId, conversationId)
    const found = items.find((c) => c.id === id)
    return found ? { ...found, files: { ...found.files } } : null
  }

  async getWorkspaceFiles(orgId: string, conversationId: string): Promise<Record<string, string>> {
    const payload = await this.getPayload<Record<string, string>>(docId(['workspace', orgId, conversationId]))
    return { ...(payload || {}) }
  }

  async setWorkspaceFiles(orgId: string, conversationId: string, files: Record<string, string>): Promise<void> {
    await this.setPayload(docId(['workspace', orgId, conversationId]), 'workspace', orgId, { ...files }, {
      conversationId,
    })
  }

  async listCron(orgId: string): Promise<CronJobSpec[]> {
    const items = await this.getAggregateItems<CronJobSpec>(docId(['cron', orgId]))
    return items
      .filter((p) => Boolean(p?.id))
      .map((j) => ({ ...j, skillIds: j.skillIds ? [...j.skillIds] : undefined }))
  }

  async upsertCron(job: CronJobSpec): Promise<CronJobSpec> {
    const next = { ...job, skillIds: job.skillIds ? [...job.skillIds] : undefined }
    const id = docId(['cron', job.orgId])
    const items = await this.getAggregateItems<CronJobSpec>(id)
    const merged = upsertAggregateItem(items, next, (j) => j.id)
    await this.setAggregateItems(id, 'cron', job.orgId, merged)
    return next
  }

  async listHooks(orgId: string): Promise<EventHookConfig[]> {
    const items = await this.getAggregateItems<EventHookConfig>(docId(['hook', orgId]))
    return items
      .filter((p) => Boolean(p?.id))
      .map((h) => ({ ...h, config: { ...h.config } }))
  }

  async upsertHook(hook: EventHookConfig): Promise<EventHookConfig> {
    const next = { ...hook, config: { ...hook.config } }
    const id = docId(['hook', hook.orgId])
    const items = await this.getAggregateItems<EventHookConfig>(id)
    const merged = upsertAggregateItem(items, next, (h) => h.id)
    await this.setAggregateItems(id, 'hook', hook.orgId, merged)
    return next
  }

  async listBatchJobs(orgId: string): Promise<BatchJobResult[]> {
    const items = await this.getAggregateItems<BatchJobResult>(docId(['batch', orgId]))
    return items
      .filter((p) => Boolean(p?.id))
      .map((b) => ({ ...b, items: b.items.map((i) => ({ ...i })) }))
  }

  async addBatchJob(job: BatchJobResult): Promise<BatchJobResult> {
    const next = { ...job, items: job.items.map((i) => ({ ...i })) }
    const id = docId(['batch', job.orgId])
    const items = await this.getAggregateItems<BatchJobResult>(id)
    const merged = upsertAggregateItem(items, next, (b) => b.id, { prepend: true, max: 50 })
    await this.setAggregateItems(id, 'batch', job.orgId, merged)
    return next
  }

  async listMcp(orgId: string): Promise<McpServerConfig[]> {
    const items = await this.getAggregateItems<McpServerConfig>(docId(['mcp', orgId]))
    return items.filter((p) => Boolean(p?.id))
  }

  async upsertMcp(server: McpServerConfig): Promise<McpServerConfig> {
    const next = { ...server }
    const id = docId(['mcp', server.orgId])
    const items = await this.getAggregateItems<McpServerConfig>(id)
    const merged = upsertAggregateItem(items, next, (s) => s.id)
    await this.setAggregateItems(id, 'mcp', server.orgId, merged)
    return next
  }

  async getRouting(orgId: string): Promise<ProviderRoutingPolicy> {
    const existing = await this.getPayload<ProviderRoutingPolicy>(docId(['routing', orgId]))
    if (existing) {
      return {
        ...existing,
        allowlist: [...existing.allowlist],
        denylist: [...existing.denylist],
        priority: [...existing.priority],
      }
    }
    return {
      orgId,
      sort: 'priority',
      allowlist: [],
      denylist: [],
      priority: [],
      updatedAt: new Date().toISOString(),
    }
  }

  async setRouting(policy: ProviderRoutingPolicy): Promise<ProviderRoutingPolicy> {
    const next = {
      ...policy,
      allowlist: [...policy.allowlist],
      denylist: [...policy.denylist],
      priority: [...policy.priority],
    }
    await this.setPayload(docId(['routing', policy.orgId]), 'routing', policy.orgId, next)
    return next
  }

  async listCredentialPools(orgId: string): Promise<CredentialPool[]> {
    const items = await this.getAggregateItems<CredentialPool>(docId(['credential_pool', orgId]))
    return items
      .filter((p) => Boolean(p?.provider))
      .map((p) => ({ ...p, keys: p.keys.map((k) => ({ ...k })) }))
  }

  async upsertCredentialPool(pool: CredentialPool): Promise<CredentialPool> {
    const next = { ...pool, keys: pool.keys.map((k) => ({ ...k })) }
    const id = docId(['credential_pool', pool.orgId])
    const items = await this.getAggregateItems<CredentialPool>(id)
    const merged = upsertAggregateItem(items, next, (p) => p.provider)
    await this.setAggregateItems(id, 'credential_pool', pool.orgId, merged)
    return next
  }

  async listMemoryProviders(orgId: string, agentId?: string): Promise<MemoryProviderBinding[]> {
    let items = await this.getAggregateItems<MemoryProviderBinding>(docId(['memory_provider', orgId]))
    items = items.filter((p) => Boolean(p?.provider))
    if (agentId) items = items.filter((b) => b.agentId === agentId)
    return items.map((b) => ({ ...b, config: { ...b.config } }))
  }

  async upsertMemoryProvider(binding: MemoryProviderBinding): Promise<MemoryProviderBinding> {
    const next = { ...binding, config: { ...binding.config } }
    const id = docId(['memory_provider', binding.orgId])
    const items = await this.getAggregateItems<MemoryProviderBinding>(id)
    const merged = upsertAggregateItem(
      items,
      next,
      (b) => `${b.agentId}::${b.provider}`,
    )
    await this.setAggregateItems(id, 'memory_provider', binding.orgId, merged)
    return next
  }

  async listPlugins(orgId: string): Promise<PluginRecord[]> {
    const payload = await this.getPayload<PluginRecord[]>(docId(['plugins', orgId]))
    return (payload || []).map((p) => ({ ...p, contributes: [...p.contributes] }))
  }

  async setPlugins(orgId: string, plugins: PluginRecord[]): Promise<PluginRecord[]> {
    const next = plugins.map((p) => ({ ...p, contributes: [...p.contributes] }))
    await this.setPayload(docId(['plugins', orgId]), 'plugins', orgId, next)
    return next.map((p) => ({ ...p, contributes: [...p.contributes] }))
  }

  async getAppliedPersonality(orgId: string, agentId: string): Promise<string | null> {
    const payload = await this.getPayload<Record<string, string>>(docId(['personality', orgId]))
    return payload?.[agentId] ?? null
  }

  async applyPersonality(orgId: string, agentId: string, presetId: string): Promise<string> {
    const id = docId(['personality', orgId])
    const existing = (await this.getPayload<Record<string, string>>(id)) || {}
    existing[agentId] = presetId
    await this.setPayload(id, 'personality', orgId, existing)
    return presetId
  }

  async saveDelegation(record: DelegationRecord): Promise<DelegationRecord> {
    const next = { ...record, children: record.children.map((c) => ({ ...c })) }
    const id = docId(['delegation', record.orgId])
    const items = await this.getAggregateItems<DelegationRecord>(id)
    const merged = upsertAggregateItem(items, next, (d) => d.id, { prepend: true, max: 50 })
    await this.setAggregateItems(id, 'delegation', record.orgId, merged)
    return next
  }

  async getDelegation(orgId: string, id: string): Promise<DelegationRecord | null> {
    const items = await this.listDelegations(orgId)
    const found = items.find((d) => d.id === id)
    return found ? { ...found, children: found.children.map((c) => ({ ...c })) } : null
  }

  async listDelegations(orgId: string, conversationId?: string): Promise<DelegationRecord[]> {
    let items = await this.getAggregateItems<DelegationRecord>(docId(['delegation', orgId]))
    items = items.filter((p) => Boolean(p?.id))
    if (conversationId) items = items.filter((d) => d.conversationId === conversationId)
    return items.map((d) => ({ ...d, children: d.children.map((c) => ({ ...c })) }))
  }
}

let activeRepository: HermesFeaturesRepository | null = null

export function createMemoryRepository(): MemoryHermesFeaturesRepository {
  return new MemoryHermesFeaturesRepository()
}

export function getHermesFeaturesRepository(): HermesFeaturesRepository {
  if (activeRepository) return activeRepository
  // Jest / unit tests always use durable-in-memory (same API as Firestore).
  if (process.env.JEST_WORKER_ID || process.env.HERMES_FEATURES_STORE === 'memory') {
    activeRepository = new MemoryHermesFeaturesRepository()
    return activeRepository
  }
  activeRepository = new FirestoreHermesFeaturesRepository()
  return activeRepository
}

/** Test-only: force a repository instance (memory recommended). */
export function setHermesFeaturesRepositoryForTests(repo: HermesFeaturesRepository | null): void {
  activeRepository = repo
}
