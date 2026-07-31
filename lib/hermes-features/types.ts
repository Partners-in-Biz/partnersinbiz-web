/** Shared types for PiB Hermes Features Overview control plane. */

export type FeatureReadiness = 'ready' | 'enabled' | 'not_ready' | 'deferred'

export type HermesToolsetId =
  | 'terminal'
  | 'web'
  | 'browser'
  | 'file'
  | 'memory'
  | 'delegation'
  | 'code_execution'
  | 'vision'
  | 'image_generation'
  | 'mcp'
  | 'cron'
  | 'skills'

export const DEFAULT_HERMES_TOOLSETS: HermesToolsetId[] = [
  'terminal',
  'web',
  'file',
  'memory',
  'skills',
]

export const ALL_HERMES_TOOLSETS: HermesToolsetId[] = [
  'terminal',
  'web',
  'browser',
  'file',
  'memory',
  'delegation',
  'code_execution',
  'vision',
  'image_generation',
  'mcp',
  'cron',
  'skills',
]

export interface ToolsetPolicy {
  orgId: string
  agentId: string
  conversationId?: string
  enabled: HermesToolsetId[]
  updatedAt: string
}

export interface ProgressiveSkillMeta {
  id: string
  name: string
  description: string
  path?: string
  /** Progressive disclosure: only load body when selected. */
  loaded: boolean
  body?: string
  tags?: string[]
}

export interface CuratedMemoryDoc {
  orgId: string
  agentId: string
  memoryMd: string
  userMd: string
  updatedAt: string
  updatedBy?: string
}

export type ContextFileKind = 'hermes' | 'agents' | 'claude' | 'soul' | 'cursorrules'

export interface DiscoveredContextFile {
  kind: ContextFileKind
  fileName: string
  relativePath: string
  content: string
}

export type ContextRefKind = 'file' | 'folder' | 'diff' | 'url'

export interface ExpandedContextRef {
  kind: ContextRefKind
  query: string
  label: string
  content: string
  truncated: boolean
}

export interface CheckpointSnapshot {
  id: string
  orgId: string
  conversationId: string
  workspaceBindingId?: string
  label: string
  createdAt: string
  createdBy?: string
  /** Map of relative path → content hash or content for small trees. */
  files: Record<string, string>
}

export interface CronJobSpec {
  id: string
  orgId: string
  agentId: string
  name: string
  schedule: string
  prompt: string
  skillIds?: string[]
  status: 'active' | 'paused'
  createdAt: string
  updatedAt: string
  lastRunAt?: string
}

export type DelegationChildStatus = 'queued' | 'running' | 'done' | 'failed' | 'unknown'

export interface DelegationChild {
  id: string
  goal: string
  /** Full parent-supplied context for isolated child runs (Hermes-style). */
  context?: string
  /** Optional specialist agent override for this child (defaults to parent agentId). */
  agentId?: string
  status: DelegationChildStatus
  result?: string
  toolsets?: string[]
  runId?: string
  runDocId?: string
}

export interface DelegationGoalInput {
  goal: string
  context?: string
  agentId?: string
}

export interface DelegationSpawnResult {
  parentRunHint: string
  children: DelegationChild[]
  maxConcurrent: number
}

export interface CodeExecResult {
  ok: boolean
  stdout: string
  stderr: string
  exitCode: number
  toolsetEnabled: boolean
}

export type HookKind = 'gateway_log' | 'tool_guard' | 'webhook' | 'metrics'

export interface EventHookConfig {
  id: string
  orgId: string
  kind: HookKind
  name: string
  enabled: boolean
  config: Record<string, string>
  createdAt: string
  updatedAt: string
}

export interface BatchItemResult {
  index: number
  prompt: string
  status: 'ok' | 'error'
  output: string
}

export interface BatchJobResult {
  id: string
  orgId: string
  agentId: string
  createdAt: string
  items: BatchItemResult[]
}

export type MediaCapability =
  | 'voice_stt'
  | 'voice_tts'
  | 'browser'
  | 'vision'
  | 'image_generation'

export interface MediaReadiness {
  capability: MediaCapability
  status: FeatureReadiness
  provider?: string
  detail?: string
}

export type McpTransport = 'stdio' | 'http'

export interface McpServerConfig {
  id: string
  orgId: string
  name: string
  transport: McpTransport
  /** Command for stdio or URL for HTTP. */
  endpoint: string
  enabled: boolean
  toolAllowlist?: string[]
  toolDenylist?: string[]
  createdAt: string
  updatedAt: string
}

export interface ProviderRoutingPolicy {
  orgId: string
  sort: 'cost' | 'speed' | 'quality' | 'priority'
  allowlist: string[]
  denylist: string[]
  priority: string[]
  updatedAt: string
}

export interface CredentialPoolKey {
  id: string
  label: string
  /** Fingerprint only — never store raw secrets in pure policy objects. */
  fingerprint: string
  lastStatus: 'ok' | 'rate_limited' | 'failed' | 'unknown'
  priority: number
}

export interface CredentialPool {
  orgId: string
  provider: string
  keys: CredentialPoolKey[]
  updatedAt: string
}

export type ExternalMemoryProviderId = 'builtin' | 'honcho' | 'mem0' | 'openviking'

export interface MemoryProviderBinding {
  orgId: string
  agentId: string
  provider: ExternalMemoryProviderId
  enabled: boolean
  config: Record<string, string>
  updatedAt: string
}

export interface PersonalityPreset {
  id: string
  name: string
  description: string
  soulSnippet: string
}

export interface PluginRecord {
  id: string
  name: string
  kind: 'general' | 'memory' | 'context_engine'
  version: string
  installed: boolean
  contributes: Array<'tools' | 'hooks' | 'memory' | 'context'>
}

export interface HermesFeaturesStoreSnapshot {
  orgId: string
  toolsetPolicies: ToolsetPolicy[]
  skills: ProgressiveSkillMeta[]
  memories: CuratedMemoryDoc[]
  checkpoints: CheckpointSnapshot[]
  cronJobs: CronJobSpec[]
  hooks: EventHookConfig[]
  batchJobs: BatchJobResult[]
  mcpServers: McpServerConfig[]
  routing?: ProviderRoutingPolicy
  credentialPools: CredentialPool[]
  memoryProviders: MemoryProviderBinding[]
  plugins: PluginRecord[]
  appliedPersonality?: Record<string, string>
}
