/**
 * Agent Team types — shared across lib/agents, API routes, and the seed script.
 */
import type { Timestamp } from 'firebase-admin/firestore'

export type AgentId = string

export const AGENT_IDS: AgentId[] = ['pip', 'theo', 'maya', 'sage', 'nora', 'ads', 'qa-release', 'support', 'data', 'docs', 'seo', 'sales', 'finance', 'people']
export const AGENT_ID_RE = /^[a-z][a-z0-9._-]{1,39}$/
export function isValidAgentId(value: unknown): value is AgentId {
  return typeof value === 'string' && AGENT_ID_RE.test(value)
}

export interface AgentRegistryEntry {
  responsibilities: string[]
  skills: string[]
  cronWatchLoops: string[]
  allowedScopes: string[]
  exampleTaskTypes: string[]
}

export interface AgentSkillPolicyState {
  mode: 'hard_allowlist'
  policyVersion: string
  catalogVersion?: string
  pibSkills: string[]
  runtimeSkills?: string[]
  globalSkills: string[]
  deniedSkills: string[]
  capabilities?: string[]
  approvalGates?: string[]
  primaryOwnerOf?: string[]
  mayRequestFrom?: string[]
  reviewerAgentId?: AgentId | null
  vpsExternalDir: string
  appliedVersion?: string | null
  appliedAt?: Timestamp | null
  appliedBy?: string | null
  driftStatus?: 'unknown' | 'in_sync' | 'drifted' | 'not_applied'
}

export interface PublicAgentRuntimeTarget {
  id: string
  label?: string
  baseUrl: string
  enabled: boolean
  priority?: number
  capabilities?: string[]
  hostId?: string
  lastSeenAt?: Timestamp | Date | string | number
  lastHealthStatus?: 'ok' | 'degraded' | 'unreachable' | string
  hasApiKey?: boolean
}

export interface AgentTeamDoc extends AgentRegistryEntry {
  agentId: AgentId
  name: string
  role: string
  persona: string
  defaultModel: string
  iconKey: string       // material symbol name
  colorKey: string      // tailwind color token e.g. 'violet'
  enabled: boolean
  baseUrl: string
  apiKey: string        // stored AES-256-GCM encrypted; masked to last 6 chars in reads
  runtimeTargets?: Record<string, PublicAgentRuntimeTarget>
  defaultRuntimeTarget?: string
  lastHealthCheck?: Timestamp
  lastHealthStatus?: 'ok' | 'degraded' | 'unreachable'
  skillPolicy?: AgentSkillPolicyState
  /** Custom agents created from an organisation workspace remain tenant-scoped. */
  scopeOrgId?: string
  /** Tenant-local handle shown to users; agentId remains a globally unique runtime key. */
  agentHandle?: string
  /** User that created and owns a personal linked-computer agent. */
  ownerUserId?: string
  createdByUserId?: string
  homeDeviceId?: string
  provisioningMode?: 'platform_vps' | 'linked_device'
  provisioningStatus?: 'installing' | 'ready' | 'failed'
  provisioningError?: string | null
  accessScope?: 'personal' | 'organization'
  /** Custom agent vs marketplace template instance (never editable as a system agent). */
  agentKind?: 'custom' | 'marketplace'
  /** OpenBot-style isolation on the home linked computer / VPS. */
  botComputer?: {
    isolated: true
    deviceId?: string | null
    runtimeTarget?: string | null
    workspaceRelativePath: string
    browserProfileId: string
  }
  /** Source marketplace template id when agentKind is marketplace (e.g. pip). */
  marketplaceTemplateId?: string
  /** Skill pack channel — marketplace pulls use public packs only. */
  marketplacePack?: 'public'
  /** Optional public-skill selection for a marketplace instance (allowlisted only). */
  marketplaceSkills?: string[]
  /**
   * Bot mode look. Resolved per org from `bot_appearance/{orgId}_{agentId}`
   * on read; never written to the shared agent_team doc directly.
   */
  avatarUrl?: string | null
  avatarStyle?: BotAvatarStyle
  /** Per-bot mailbox routed through the Hermes Mail Agent (address only, no secrets). */
  mailbox?: BotMailboxRecord | null
  createdAt: Timestamp
  updatedAt: Timestamp
}

export type BotAvatarStyle = 'blob' | 'geometric' | 'image'

export type BotMailboxStatus = 'active' | 'pending' | 'error'

export interface BotMailboxRecord {
  provider: 'hermes-mail-agent'
  address: string
  inboxId?: string | null
  status: BotMailboxStatus
  error?: string | null
  updatedAt: string
}

/** Shape stored in Firestore (apiKey is encrypted JSON) */
export interface AgentTeamStoredDoc extends Omit<AgentTeamDoc, 'apiKey'> {
  apiKey: string // JSON-serialised EncryptedData: { ciphertext, iv, tag }
}
