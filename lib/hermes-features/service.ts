/**
 * Async facade — durable repository + real runtime paths for cron/delegation/workspace.
 */
import {
  getHermesFeaturesRepository,
  setHermesFeaturesRepositoryForTests,
  createMemoryRepository,
  type HermesFeaturesRepository,
} from './repository'
import {
  defaultToolsetPolicy,
  enableToolset,
  disableToolset,
  setToolsets,
  toolsetDispatchBlock,
} from './toolsets'
import {
  skillCatalogFromDocs,
  selectSkillsForRequest,
  loadSkillBody,
  progressiveSkillsDispatchBlock,
} from './skills-progressive'
import { updateMemorySection, appendMemoryBullet, memoryDispatchBlock } from './memory-curated'
import {
  discoverContextFilesFromMap,
  contextFilesDispatchBlock,
} from './context-files'
import {
  expandContextReference,
  expandAtTokensInMessage,
  parseAtReference,
  contextRefsDispatchBlock,
  type ContextRefExpandDeps,
} from './context-refs-expand'
import { createCheckpoint, restoreCheckpoint, checkpointSummary } from './checkpoints'
import {
  createAndScheduleCron,
  pauseCronRuntime,
  resumeCronRuntime,
  editCronRuntime,
  fireCronJob,
  processDueCronJobs,
  type CronHermesSyncDeps,
} from './cron-runtime'
import { spawnDelegations, completeChild, delegationDispatchBlock } from './delegation'
import {
  spawnObservableDelegations,
  observeDelegation,
  completeDelegationChild,
  type DelegationRunDeps,
} from './delegation-runtime'
import { executeCodeSandboxed } from './code-execution'
import { createHook, setHookEnabled, listHookKinds } from './hooks'
import { runBatchPrompts } from './batch'
import {
  assessMediaReadiness,
  browserNavigateExtractContract,
  hermesSpeakPath,
  mediaConfigFromEnv,
  type MediaBackendConfig,
} from './media-readiness'
import { createMcpServer, filterMcpTools } from './mcp'
import { createRoutingPolicy, applyRoutingPolicy, updateRoutingPolicy } from './provider-routing'
import {
  createCredentialPool,
  selectCredentialKey,
  markCredentialStatus,
} from './credential-pools'
import {
  createMemoryProviderBinding,
  externalMemoryLookup,
  type ExternalMemoryLookupDeps,
} from './memory-providers'
import {
  listPersonalityPresets,
  getPersonalityPreset,
  personalityDispatchBlock,
} from './personality'
import { listPlugins, installPlugin, uninstallPlugin } from './plugins'
import { buildHermesFeaturesDispatchBlock } from './dispatch'
import {
  createNodeWorkspaceFs,
  createMemoryWorkspaceFs,
  resolveWorkspaceRootFromConversation,
  type WorkspaceFs,
} from './workspace-fs'
import { productionCronDeps, productionDelegationDeps } from './runtime-deps'
import { parseCronSchedule } from './cron'
import type { CronJobSpec } from './types'

function repo(): HermesFeaturesRepository {
  return getHermesFeaturesRepository()
}

export const hermesFeaturesService = {
  /** Test helpers */
  useMemoryRepositoryForTests() {
    const memory = createMemoryRepository()
    setHermesFeaturesRepositoryForTests(memory)
    return memory
  },
  resetForTests() {
    const r = repo()
    if (r.reset) r.reset()
  },
  get repository() {
    return repo()
  },

  // Toolsets (durable)
  async getToolsets(orgId: string, agentId: string, conversationId?: string) {
    return repo().getToolsetPolicy(orgId, agentId, conversationId)
  },
  async enableToolset(orgId: string, agentId: string, toolset: string, conversationId?: string) {
    const current = await repo().getToolsetPolicy(orgId, agentId, conversationId)
    const base = current.conversationId || !conversationId
      ? current
      : { ...defaultToolsetPolicy(orgId, agentId, conversationId), enabled: current.enabled }
    return repo().setToolsetPolicy(enableToolset(base, toolset))
  },
  async disableToolset(orgId: string, agentId: string, toolset: string, conversationId?: string) {
    const current = await repo().getToolsetPolicy(orgId, agentId, conversationId)
    return repo().setToolsetPolicy(disableToolset(current, toolset))
  },
  async setToolsets(orgId: string, agentId: string, toolsets: string[], conversationId?: string) {
    const current = await repo().getToolsetPolicy(orgId, agentId, conversationId)
    return repo().setToolsetPolicy(setToolsets(current, toolsets))
  },

  // Skills progressive
  async setSkillCatalog(
    orgId: string,
    agentId: string,
    docs: Array<{ id: string; name: string; description: string; path?: string; tags?: string[]; body?: string }>,
  ) {
    return repo().setSkills(orgId, agentId, skillCatalogFromDocs(docs))
  },
  async listSkills(orgId: string, agentId: string) {
    return repo().getSkills(orgId, agentId)
  },
  async selectAndLoadSkills(orgId: string, agentId: string, query: string, bodies: Record<string, string>) {
    let catalog = await repo().getSkills(orgId, agentId)
    const selected = selectSkillsForRequest(catalog, query, 3)
    for (const s of selected) {
      if (bodies[s.id]) catalog = loadSkillBody(catalog, s.id, bodies[s.id])
    }
    return repo().setSkills(orgId, agentId, catalog)
  },

  // Memory durable
  async getMemory(orgId: string, agentId: string) {
    return repo().getMemory(orgId, agentId)
  },
  async setMemorySection(orgId: string, agentId: string, section: 'memory' | 'user', content: string, updatedBy?: string) {
    const doc = await repo().getMemory(orgId, agentId)
    return repo().setMemory(updateMemorySection(doc, section, content, updatedBy))
  },
  async appendMemory(orgId: string, agentId: string, section: 'memory' | 'user', bullet: string, updatedBy?: string) {
    const doc = await repo().getMemory(orgId, agentId)
    return repo().setMemory(appendMemoryBullet(doc, section, bullet, updatedBy))
  },

  // Context files
  discoverContextFiles(files: Record<string, string>) {
    return discoverContextFilesFromMap(files)
  },
  discoverContextFilesFromWorkspace(fs: WorkspaceFs) {
    return fs.discoverContextFiles()
  },

  // Context refs
  parseAtReference,
  expandContextReference,
  expandAtTokensInMessage,
  contextRefsDispatchBlock,

  // Checkpoints — snapshot from real workspace when provided
  async createCheckpoint(input: {
    orgId: string
    conversationId: string
    files?: Record<string, string>
    workspace?: WorkspaceFs
    label?: string
    createdBy?: string
  }) {
    const files = input.workspace
      ? input.workspace.snapshotTextFiles()
      : (input.files || await repo().getWorkspaceFiles(input.orgId, input.conversationId))
    await repo().setWorkspaceFiles(input.orgId, input.conversationId, files)
    const snap = createCheckpoint({
      orgId: input.orgId,
      conversationId: input.conversationId,
      files,
      label: input.label,
      createdBy: input.createdBy,
    })
    return repo().addCheckpoint(snap)
  },
  async listCheckpoints(orgId: string, conversationId: string) {
    return repo().listCheckpoints(orgId, conversationId)
  },
  async rollback(input: {
    orgId: string
    conversationId: string
    checkpointId?: string
    workspace?: WorkspaceFs
  }) {
    const list = await repo().listCheckpoints(input.orgId, input.conversationId)
    const snap = input.checkpointId
      ? list.find((c) => c.id === input.checkpointId) || await repo().getCheckpoint(input.orgId, input.conversationId, input.checkpointId)
      : list[0]
    if (!snap) throw new Error('No checkpoint to rollback')
    const current = input.workspace
      ? input.workspace.snapshotTextFiles()
      : await repo().getWorkspaceFiles(input.orgId, input.conversationId)
    const restored = restoreCheckpoint(current, snap)
    if (input.workspace) {
      input.workspace.applySnapshot(restored.files)
    }
    await repo().setWorkspaceFiles(input.orgId, input.conversationId, restored.files)
    return { snapshot: snap, ...restored, summary: checkpointSummary(snap) }
  },

  // Cron → Hermes
  parseCronSchedule,
  async createCron(
    input: {
      orgId: string
      agentId: string
      name: string
      schedule: string
      prompt: string
      skillIds?: string[]
      id?: string
    },
    deps?: CronHermesSyncDeps,
  ) {
    return createAndScheduleCron(input, repo(), deps ?? (process.env.JEST_WORKER_ID ? {} : productionCronDeps()))
  },
  async listCron(orgId: string) {
    return repo().listCron(orgId)
  },
  async pauseCron(orgId: string, id: string) {
    return pauseCronRuntime(orgId, id, repo())
  },
  async resumeCron(orgId: string, id: string) {
    return resumeCronRuntime(orgId, id, repo())
  },
  async editCron(orgId: string, id: string, patch: Partial<Pick<CronJobSpec, 'name' | 'schedule' | 'prompt' | 'skillIds' | 'agentId'>>) {
    return editCronRuntime(orgId, id, patch, repo())
  },
  async fireCron(orgId: string, id: string, deps?: CronHermesSyncDeps) {
    return fireCronJob(orgId, id, repo(), deps ?? productionCronDeps())
  },
  async processDueCron(orgId: string, deps?: CronHermesSyncDeps) {
    return processDueCronJobs(orgId, repo(), deps ?? productionCronDeps())
  },

  // Delegation pure + observable
  spawnDelegations,
  completeChild,
  delegationDispatchBlock,
  async spawnObservableDelegations(
    input: {
      orgId: string
      agentId: string
      conversationId?: string
      parentRunHint: string
      goals: string[]
      maxConcurrent?: number
      toolsets?: string[]
    },
    deps?: DelegationRunDeps,
  ) {
    return spawnObservableDelegations(
      input,
      repo(),
      deps ?? (process.env.JEST_WORKER_ID ? {
        createRun: async ({ childId, goal }) => ({
          ok: true,
          runId: `test-run-${childId}`,
          runDocId: `test-doc-${childId}`,
        }),
      } : productionDelegationDeps()),
    )
  },
  async observeDelegation(orgId: string, id: string) {
    return observeDelegation(orgId, id, repo())
  },
  async completeDelegationChild(orgId: string, delegationId: string, childId: string, result: string, ok = true) {
    return completeDelegationChild(orgId, delegationId, childId, result, ok, repo())
  },

  // Code exec (partial sandboxed + toolset gate)
  async executeCode(orgId: string, agentId: string, script: string, conversationId?: string) {
    const policy = await repo().getToolsetPolicy(orgId, agentId, conversationId)
    return executeCodeSandboxed(policy, script)
  },

  // Hooks durable
  listHookKinds,
  async createHook(input: Parameters<typeof createHook>[0]) {
    return repo().upsertHook(createHook(input))
  },
  async listHooks(orgId: string) {
    return repo().listHooks(orgId)
  },
  async setHookEnabled(orgId: string, id: string, enabled: boolean) {
    const hook = (await repo().listHooks(orgId)).find((h) => h.id === id)
    if (!hook) throw new Error('Hook not found')
    return repo().upsertHook(setHookEnabled(hook, enabled))
  },

  // Batch (partial: structured results; inject sync runner for real outputs)
  async runBatch(input: {
    orgId: string
    agentId: string
    prompts: string[]
    runner?: (prompt: string, index: number) => { status: 'ok' | 'error'; output: string }
    id?: string
  }) {
    const job = runBatchPrompts({
      orgId: input.orgId,
      agentId: input.agentId,
      prompts: input.prompts,
      runner: input.runner,
      id: input.id,
    })
    return repo().addBatchJob(job)
  },
  async listBatch(orgId: string) {
    return repo().listBatchJobs(orgId)
  },

  // Media
  assessMediaReadiness(config?: MediaBackendConfig) {
    return assessMediaReadiness(config)
  },
  mediaConfigFromEnv,
  browserNavigateExtractContract,
  hermesSpeakPath,

  // MCP durable config (sync to Hermes is separate partial path)
  async registerMcp(input: Parameters<typeof createMcpServer>[0]) {
    return repo().upsertMcp(createMcpServer(input))
  },
  async listMcp(orgId: string) {
    return repo().listMcp(orgId)
  },
  filterMcpTools,

  // Routing durable policy
  async getRouting(orgId: string) {
    return repo().getRouting(orgId)
  },
  async setRouting(orgId: string, patch: Parameters<typeof createRoutingPolicy>[0]) {
    const current = await repo().getRouting(orgId)
    const next = updateRoutingPolicy(
      createRoutingPolicy({ ...current, ...patch, orgId }),
      patch,
    )
    return repo().setRouting(next)
  },
  applyRouting: applyRoutingPolicy,

  // Credential pools durable (fingerprints only)
  async upsertCredentialPool(input: Parameters<typeof createCredentialPool>[0]) {
    return repo().upsertCredentialPool(createCredentialPool(input))
  },
  async listCredentialPools(orgId: string) {
    return repo().listCredentialPools(orgId)
  },
  selectCredentialKey,
  async markCredentialStatus(orgId: string, provider: string, keyId: string, status: 'ok' | 'rate_limited' | 'failed' | 'unknown') {
    const pool = (await repo().listCredentialPools(orgId)).find((p) => p.provider === provider)
    if (!pool) throw new Error('Credential pool not found')
    return repo().upsertCredentialPool(markCredentialStatus(pool, keyId, status))
  },

  // Memory providers
  async bindMemoryProvider(input: Parameters<typeof createMemoryProviderBinding>[0]) {
    return repo().upsertMemoryProvider(createMemoryProviderBinding(input))
  },
  async listMemoryProviders(orgId: string, agentId?: string) {
    return repo().listMemoryProviders(orgId, agentId)
  },
  externalMemoryLookup(
    binding: Parameters<typeof externalMemoryLookup>[0],
    query: string,
    deps?: ExternalMemoryLookupDeps,
  ) {
    return externalMemoryLookup(binding, query, deps)
  },

  // Personality
  listPersonalityPresets,
  getPersonalityPreset,
  async applyPersonality(orgId: string, agentId: string, presetId: string) {
    const preset = getPersonalityPreset(presetId)
    if (!preset) throw new Error(`Unknown personality preset: ${presetId}`)
    await repo().applyPersonality(orgId, agentId, presetId)
    return preset
  },
  personalityDispatchBlock,
  async getAppliedPersonality(orgId: string, agentId: string) {
    return repo().getAppliedPersonality(orgId, agentId)
  },

  // Plugins durable install flags
  async listPlugins(orgId: string) {
    return listPlugins(await repo().listPlugins(orgId))
  },
  async installPlugin(orgId: string, pluginId: string) {
    const next = installPlugin(await repo().listPlugins(orgId), pluginId)
    return repo().setPlugins(orgId, next)
  },
  async uninstallPlugin(orgId: string, pluginId: string) {
    const next = uninstallPlugin(await repo().listPlugins(orgId), pluginId)
    return repo().setPlugins(orgId, next)
  },

  // Dispatch
  buildDispatchBlock: buildHermesFeaturesDispatchBlock,

  // Workspace helpers
  createNodeWorkspaceFs,
  createMemoryWorkspaceFs,
  resolveWorkspaceRootFromConversation,

  // Export pure helpers for tests
  toolsetDispatchBlock,
  progressiveSkillsDispatchBlock,
  memoryDispatchBlock,
  contextFilesDispatchBlock,
  checkpointSummary,
}
