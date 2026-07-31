/**
 * In-process Hermes Features control-plane store.
 * Unit tests and API handlers share this pure mutable map keyed by org.
 * Production API may layer Firestore later; behavior is exercised via this store.
 */
import type {
  BatchJobResult,
  CheckpointSnapshot,
  CredentialPool,
  CronJobSpec,
  CuratedMemoryDoc,
  EventHookConfig,
  HermesFeaturesStoreSnapshot,
  McpServerConfig,
  MemoryProviderBinding,
  PluginRecord,
  ProgressiveSkillMeta,
  ProviderRoutingPolicy,
  ToolsetPolicy,
} from './types'
import { defaultToolsetPolicy } from './toolsets'
import { emptyMemory } from './memory-curated'

export class HermesFeaturesStore {
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

  private toolsetKey(orgId: string, agentId: string, conversationId?: string): string {
    return conversationId ? `${orgId}::${agentId}::${conversationId}` : `${orgId}::${agentId}`
  }

  private agentKey(orgId: string, agentId: string): string {
    return `${orgId}::${agentId}`
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
  }

  getToolsetPolicy(orgId: string, agentId: string, conversationId?: string): ToolsetPolicy {
    const specific = conversationId
      ? this.toolsets.get(this.toolsetKey(orgId, agentId, conversationId))
      : undefined
    if (specific) return { ...specific, enabled: [...specific.enabled] }
    const base = this.toolsets.get(this.toolsetKey(orgId, agentId))
    if (base) return { ...base, enabled: [...base.enabled] }
    return defaultToolsetPolicy(orgId, agentId, conversationId)
  }

  setToolsetPolicy(policy: ToolsetPolicy): ToolsetPolicy {
    const key = this.toolsetKey(policy.orgId, policy.agentId, policy.conversationId)
    const next = { ...policy, enabled: [...policy.enabled] }
    this.toolsets.set(key, next)
    return next
  }

  getMemory(orgId: string, agentId: string): CuratedMemoryDoc {
    const key = this.agentKey(orgId, agentId)
    const existing = this.memories.get(key)
    if (existing) return { ...existing }
    const empty = emptyMemory(orgId, agentId)
    this.memories.set(key, empty)
    return { ...empty }
  }

  setMemory(doc: CuratedMemoryDoc): CuratedMemoryDoc {
    const key = this.agentKey(doc.orgId, doc.agentId)
    const next = { ...doc }
    this.memories.set(key, next)
    return next
  }

  getSkills(orgId: string, agentId: string): ProgressiveSkillMeta[] {
    return (this.skills.get(this.agentKey(orgId, agentId)) || []).map((s) => ({ ...s }))
  }

  setSkills(orgId: string, agentId: string, skills: ProgressiveSkillMeta[]): ProgressiveSkillMeta[] {
    const next = skills.map((s) => ({ ...s }))
    this.skills.set(this.agentKey(orgId, agentId), next)
    return next.map((s) => ({ ...s }))
  }

  listCheckpoints(orgId: string, conversationId: string): CheckpointSnapshot[] {
    return (this.checkpoints.get(`${orgId}::${conversationId}`) || []).map((c) => ({
      ...c,
      files: { ...c.files },
    }))
  }

  addCheckpoint(snapshot: CheckpointSnapshot): CheckpointSnapshot {
    const key = `${snapshot.orgId}::${snapshot.conversationId}`
    const list = this.checkpoints.get(key) || []
    list.unshift({ ...snapshot, files: { ...snapshot.files } })
    this.checkpoints.set(key, list)
    return { ...snapshot, files: { ...snapshot.files } }
  }

  getCheckpoint(orgId: string, conversationId: string, id: string): CheckpointSnapshot | null {
    return this.listCheckpoints(orgId, conversationId).find((c) => c.id === id) ?? null
  }

  setWorkspaceFiles(orgId: string, conversationId: string, files: Record<string, string>): void {
    this.workspaceFiles.set(`${orgId}::${conversationId}`, { ...files })
  }

  getWorkspaceFiles(orgId: string, conversationId: string): Record<string, string> {
    return { ...(this.workspaceFiles.get(`${orgId}::${conversationId}`) || {}) }
  }

  listCron(orgId: string): CronJobSpec[] {
    return (this.cronJobs.get(orgId) || []).map((j) => ({ ...j, skillIds: j.skillIds ? [...j.skillIds] : undefined }))
  }

  upsertCron(job: CronJobSpec): CronJobSpec {
    const list = this.cronJobs.get(job.orgId) || []
    const idx = list.findIndex((j) => j.id === job.id)
    const next = { ...job, skillIds: job.skillIds ? [...job.skillIds] : undefined }
    if (idx >= 0) list[idx] = next
    else list.push(next)
    this.cronJobs.set(job.orgId, list)
    return { ...next }
  }

  listHooks(orgId: string): EventHookConfig[] {
    return (this.hooks.get(orgId) || []).map((h) => ({ ...h, config: { ...h.config } }))
  }

  upsertHook(hook: EventHookConfig): EventHookConfig {
    const list = this.hooks.get(hook.orgId) || []
    const idx = list.findIndex((h) => h.id === hook.id)
    const next = { ...hook, config: { ...hook.config } }
    if (idx >= 0) list[idx] = next
    else list.push(next)
    this.hooks.set(hook.orgId, list)
    return { ...next, config: { ...next.config } }
  }

  listBatchJobs(orgId: string): BatchJobResult[] {
    return (this.batchJobs.get(orgId) || []).map((b) => ({
      ...b,
      items: b.items.map((i) => ({ ...i })),
    }))
  }

  addBatchJob(job: BatchJobResult): BatchJobResult {
    const list = this.batchJobs.get(job.orgId) || []
    list.unshift({ ...job, items: job.items.map((i) => ({ ...i })) })
    this.batchJobs.set(job.orgId, list)
    return { ...job, items: job.items.map((i) => ({ ...i })) }
  }

  listMcp(orgId: string): McpServerConfig[] {
    return (this.mcpServers.get(orgId) || []).map((s) => ({
      ...s,
      toolAllowlist: s.toolAllowlist ? [...s.toolAllowlist] : undefined,
      toolDenylist: s.toolDenylist ? [...s.toolDenylist] : undefined,
    }))
  }

  upsertMcp(server: McpServerConfig): McpServerConfig {
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

  getRouting(orgId: string): ProviderRoutingPolicy {
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

  setRouting(policy: ProviderRoutingPolicy): ProviderRoutingPolicy {
    const next = {
      ...policy,
      allowlist: [...policy.allowlist],
      denylist: [...policy.denylist],
      priority: [...policy.priority],
    }
    this.routing.set(policy.orgId, next)
    return { ...next, allowlist: [...next.allowlist], denylist: [...next.denylist], priority: [...next.priority] }
  }

  listCredentialPools(orgId: string): CredentialPool[] {
    return (this.credentialPools.get(orgId) || []).map((p) => ({
      ...p,
      keys: p.keys.map((k) => ({ ...k })),
    }))
  }

  upsertCredentialPool(pool: CredentialPool): CredentialPool {
    const list = this.credentialPools.get(pool.orgId) || []
    const idx = list.findIndex((p) => p.provider === pool.provider)
    const next = { ...pool, keys: pool.keys.map((k) => ({ ...k })) }
    if (idx >= 0) list[idx] = next
    else list.push(next)
    this.credentialPools.set(pool.orgId, list)
    return { ...next, keys: next.keys.map((k) => ({ ...k })) }
  }

  listMemoryProviders(orgId: string, agentId?: string): MemoryProviderBinding[] {
    const all = this.memoryProviders.get(orgId) || []
    const filtered = agentId ? all.filter((b) => b.agentId === agentId) : all
    return filtered.map((b) => ({ ...b, config: { ...b.config } }))
  }

  upsertMemoryProvider(binding: MemoryProviderBinding): MemoryProviderBinding {
    const list = this.memoryProviders.get(binding.orgId) || []
    const idx = list.findIndex((b) => b.agentId === binding.agentId && b.provider === binding.provider)
    const next = { ...binding, config: { ...binding.config } }
    if (idx >= 0) list[idx] = next
    else list.push(next)
    this.memoryProviders.set(binding.orgId, list)
    return { ...next, config: { ...next.config } }
  }

  listPlugins(orgId: string): PluginRecord[] {
    return (this.plugins.get(orgId) || []).map((p) => ({ ...p, contributes: [...p.contributes] }))
  }

  setPlugins(orgId: string, plugins: PluginRecord[]): PluginRecord[] {
    const next = plugins.map((p) => ({ ...p, contributes: [...p.contributes] }))
    this.plugins.set(orgId, next)
    return next.map((p) => ({ ...p, contributes: [...p.contributes] }))
  }

  getAppliedPersonality(orgId: string, agentId: string): string | null {
    return this.personality.get(orgId)?.[agentId] ?? null
  }

  applyPersonality(orgId: string, agentId: string, presetId: string): string {
    const map = this.personality.get(orgId) || {}
    map[agentId] = presetId
    this.personality.set(orgId, map)
    return presetId
  }

  snapshot(orgId: string): HermesFeaturesStoreSnapshot {
    return {
      orgId,
      toolsetPolicies: [...this.toolsets.values()].filter((t) => t.orgId === orgId).map((t) => ({
        ...t,
        enabled: [...t.enabled],
      })),
      skills: [...this.skills.entries()]
        .filter(([k]) => k.startsWith(`${orgId}::`))
        .flatMap(([, v]) => v.map((s) => ({ ...s }))),
      memories: [...this.memories.values()].filter((m) => m.orgId === orgId).map((m) => ({ ...m })),
      checkpoints: [...this.checkpoints.entries()]
        .filter(([k]) => k.startsWith(`${orgId}::`))
        .flatMap(([, v]) => v.map((c) => ({ ...c, files: { ...c.files } }))),
      cronJobs: this.listCron(orgId),
      hooks: this.listHooks(orgId),
      batchJobs: this.listBatchJobs(orgId),
      mcpServers: this.listMcp(orgId),
      routing: this.getRouting(orgId),
      credentialPools: this.listCredentialPools(orgId),
      memoryProviders: this.listMemoryProviders(orgId),
      plugins: this.listPlugins(orgId),
      appliedPersonality: { ...(this.personality.get(orgId) || {}) },
    }
  }
}

/** Process-wide store for API + tests (reset in tests). */
export const hermesFeaturesStore = new HermesFeaturesStore()
