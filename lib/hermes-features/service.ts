/**
 * Facade used by API routes and slash handlers — all operations go through
 * pure modules + hermesFeaturesStore for read-back assertions.
 */
import { hermesFeaturesStore } from './store'
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
import { createCronJob, pauseCronJob, resumeCronJob, editCronJob, parseCronSchedule } from './cron'
import { spawnDelegations, completeChild, delegationDispatchBlock } from './delegation'
import { executeCodeSandboxed } from './code-execution'
import { createHook, setHookEnabled, listHookKinds } from './hooks'
import { runBatchPrompts } from './batch'
import {
  assessMediaReadiness,
  browserNavigateExtractContract,
  hermesSpeakPath,
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
} from './memory-providers'
import {
  listPersonalityPresets,
  getPersonalityPreset,
  personalityDispatchBlock,
} from './personality'
import { listPlugins, installPlugin, uninstallPlugin } from './plugins'
import { buildHermesFeaturesDispatchBlock } from './dispatch'

export const hermesFeaturesService = {
  store: hermesFeaturesStore,

  // Toolsets
  getToolsets(orgId: string, agentId: string, conversationId?: string) {
    return hermesFeaturesStore.getToolsetPolicy(orgId, agentId, conversationId)
  },
  enableToolset(orgId: string, agentId: string, toolset: string, conversationId?: string) {
    const current = hermesFeaturesStore.getToolsetPolicy(orgId, agentId, conversationId)
    const base = current.conversationId || !conversationId
      ? current
      : { ...defaultToolsetPolicy(orgId, agentId, conversationId), enabled: current.enabled }
    return hermesFeaturesStore.setToolsetPolicy(enableToolset(base, toolset))
  },
  disableToolset(orgId: string, agentId: string, toolset: string, conversationId?: string) {
    const current = hermesFeaturesStore.getToolsetPolicy(orgId, agentId, conversationId)
    return hermesFeaturesStore.setToolsetPolicy(disableToolset(current, toolset))
  },
  setToolsets(orgId: string, agentId: string, toolsets: string[], conversationId?: string) {
    const current = hermesFeaturesStore.getToolsetPolicy(orgId, agentId, conversationId)
    return hermesFeaturesStore.setToolsetPolicy(setToolsets(current, toolsets))
  },

  // Skills progressive
  setSkillCatalog(
    orgId: string,
    agentId: string,
    docs: Array<{ id: string; name: string; description: string; path?: string; tags?: string[]; body?: string }>,
  ) {
    return hermesFeaturesStore.setSkills(orgId, agentId, skillCatalogFromDocs(docs))
  },
  listSkills(orgId: string, agentId: string) {
    return hermesFeaturesStore.getSkills(orgId, agentId)
  },
  selectAndLoadSkills(orgId: string, agentId: string, query: string, bodies: Record<string, string>) {
    let catalog = hermesFeaturesStore.getSkills(orgId, agentId)
    const selected = selectSkillsForRequest(catalog, query, 3)
    for (const s of selected) {
      if (bodies[s.id]) catalog = loadSkillBody(catalog, s.id, bodies[s.id])
    }
    return hermesFeaturesStore.setSkills(orgId, agentId, catalog)
  },

  // Memory
  getMemory(orgId: string, agentId: string) {
    return hermesFeaturesStore.getMemory(orgId, agentId)
  },
  setMemorySection(orgId: string, agentId: string, section: 'memory' | 'user', content: string, updatedBy?: string) {
    const doc = hermesFeaturesStore.getMemory(orgId, agentId)
    return hermesFeaturesStore.setMemory(updateMemorySection(doc, section, content, updatedBy))
  },
  appendMemory(orgId: string, agentId: string, section: 'memory' | 'user', bullet: string, updatedBy?: string) {
    const doc = hermesFeaturesStore.getMemory(orgId, agentId)
    return hermesFeaturesStore.setMemory(appendMemoryBullet(doc, section, bullet, updatedBy))
  },

  // Context files
  discoverContextFiles(files: Record<string, string>) {
    return discoverContextFilesFromMap(files)
  },

  // Context refs
  parseAtReference,
  expandContextReference,
  expandAtTokensInMessage,
  contextRefsDispatchBlock,

  // Checkpoints
  createCheckpoint(input: {
    orgId: string
    conversationId: string
    files: Record<string, string>
    label?: string
    createdBy?: string
  }) {
    hermesFeaturesStore.setWorkspaceFiles(input.orgId, input.conversationId, input.files)
    const snap = createCheckpoint(input)
    return hermesFeaturesStore.addCheckpoint(snap)
  },
  listCheckpoints(orgId: string, conversationId: string) {
    return hermesFeaturesStore.listCheckpoints(orgId, conversationId)
  },
  rollback(orgId: string, conversationId: string, checkpointId?: string) {
    const list = hermesFeaturesStore.listCheckpoints(orgId, conversationId)
    const snap = checkpointId
      ? list.find((c) => c.id === checkpointId)
      : list[0]
    if (!snap) throw new Error('No checkpoint to rollback')
    const current = hermesFeaturesStore.getWorkspaceFiles(orgId, conversationId)
    const restored = restoreCheckpoint(current, snap)
    hermesFeaturesStore.setWorkspaceFiles(orgId, conversationId, restored.files)
    return { snapshot: snap, ...restored, summary: checkpointSummary(snap) }
  },

  // Cron
  parseCronSchedule,
  createCron(input: Parameters<typeof createCronJob>[0]) {
    const job = createCronJob(input)
    return hermesFeaturesStore.upsertCron(job)
  },
  listCron(orgId: string) {
    return hermesFeaturesStore.listCron(orgId)
  },
  pauseCron(orgId: string, id: string) {
    const job = hermesFeaturesStore.listCron(orgId).find((j) => j.id === id)
    if (!job) throw new Error('Cron job not found')
    return hermesFeaturesStore.upsertCron(pauseCronJob(job))
  },
  resumeCron(orgId: string, id: string) {
    const job = hermesFeaturesStore.listCron(orgId).find((j) => j.id === id)
    if (!job) throw new Error('Cron job not found')
    return hermesFeaturesStore.upsertCron(resumeCronJob(job))
  },
  editCron(orgId: string, id: string, patch: Parameters<typeof editCronJob>[1]) {
    const job = hermesFeaturesStore.listCron(orgId).find((j) => j.id === id)
    if (!job) throw new Error('Cron job not found')
    return hermesFeaturesStore.upsertCron(editCronJob(job, patch))
  },

  // Delegation
  spawnDelegations,
  completeChild,
  delegationDispatchBlock,

  // Code exec
  executeCode(orgId: string, agentId: string, script: string, conversationId?: string) {
    const policy = hermesFeaturesStore.getToolsetPolicy(orgId, agentId, conversationId)
    return executeCodeSandboxed(policy, script)
  },

  // Hooks
  listHookKinds,
  createHook(input: Parameters<typeof createHook>[0]) {
    return hermesFeaturesStore.upsertHook(createHook(input))
  },
  listHooks(orgId: string) {
    return hermesFeaturesStore.listHooks(orgId)
  },
  setHookEnabled(orgId: string, id: string, enabled: boolean) {
    const hook = hermesFeaturesStore.listHooks(orgId).find((h) => h.id === id)
    if (!hook) throw new Error('Hook not found')
    return hermesFeaturesStore.upsertHook(setHookEnabled(hook, enabled))
  },

  // Batch
  runBatch(input: Parameters<typeof runBatchPrompts>[0]) {
    const job = runBatchPrompts(input)
    return hermesFeaturesStore.addBatchJob(job)
  },
  listBatch(orgId: string) {
    return hermesFeaturesStore.listBatchJobs(orgId)
  },

  // Media
  assessMediaReadiness(config?: MediaBackendConfig) {
    return assessMediaReadiness(config)
  },
  browserNavigateExtractContract,
  hermesSpeakPath,

  // MCP
  registerMcp(input: Parameters<typeof createMcpServer>[0]) {
    return hermesFeaturesStore.upsertMcp(createMcpServer(input))
  },
  listMcp(orgId: string) {
    return hermesFeaturesStore.listMcp(orgId)
  },
  filterMcpTools,

  // Routing
  getRouting(orgId: string) {
    return hermesFeaturesStore.getRouting(orgId)
  },
  setRouting(orgId: string, patch: Parameters<typeof createRoutingPolicy>[0]) {
    const current = hermesFeaturesStore.getRouting(orgId)
    const next = updateRoutingPolicy(
      createRoutingPolicy({ ...current, ...patch, orgId }),
      patch,
    )
    return hermesFeaturesStore.setRouting(next)
  },
  applyRouting: applyRoutingPolicy,

  // Credential pools
  upsertCredentialPool(input: Parameters<typeof createCredentialPool>[0]) {
    return hermesFeaturesStore.upsertCredentialPool(createCredentialPool(input))
  },
  listCredentialPools(orgId: string) {
    return hermesFeaturesStore.listCredentialPools(orgId)
  },
  selectCredentialKey,
  markCredentialStatus(orgId: string, provider: string, keyId: string, status: 'ok' | 'rate_limited' | 'failed' | 'unknown') {
    const pool = hermesFeaturesStore.listCredentialPools(orgId).find((p) => p.provider === provider)
    if (!pool) throw new Error('Credential pool not found')
    return hermesFeaturesStore.upsertCredentialPool(markCredentialStatus(pool, keyId, status))
  },

  // Memory providers
  bindMemoryProvider(input: Parameters<typeof createMemoryProviderBinding>[0]) {
    return hermesFeaturesStore.upsertMemoryProvider(createMemoryProviderBinding(input))
  },
  listMemoryProviders(orgId: string, agentId?: string) {
    return hermesFeaturesStore.listMemoryProviders(orgId, agentId)
  },
  externalMemoryLookup,

  // Personality
  listPersonalityPresets,
  getPersonalityPreset,
  applyPersonality(orgId: string, agentId: string, presetId: string) {
    const preset = getPersonalityPreset(presetId)
    if (!preset) throw new Error(`Unknown personality preset: ${presetId}`)
    hermesFeaturesStore.applyPersonality(orgId, agentId, presetId)
    return preset
  },
  personalityDispatchBlock,

  // Plugins
  listPlugins(orgId: string) {
    return listPlugins(hermesFeaturesStore.listPlugins(orgId))
  },
  installPlugin(orgId: string, pluginId: string) {
    const next = installPlugin(hermesFeaturesStore.listPlugins(orgId), pluginId)
    return hermesFeaturesStore.setPlugins(orgId, next)
  },
  uninstallPlugin(orgId: string, pluginId: string) {
    const next = uninstallPlugin(hermesFeaturesStore.listPlugins(orgId), pluginId)
    return hermesFeaturesStore.setPlugins(orgId, next)
  },

  // Dispatch
  buildDispatchBlock: buildHermesFeaturesDispatchBlock,

  // Helpers exported for tests
  toolsetDispatchBlock,
  progressiveSkillsDispatchBlock,
  memoryDispatchBlock,
  contextFilesDispatchBlock,
  checkpointSummary,
}
