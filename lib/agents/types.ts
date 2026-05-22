/**
 * Agent Team types — shared across lib/agents, API routes, and the seed script.
 */
import type { Timestamp } from 'firebase-admin/firestore'

export type AgentId = string

export const AGENT_IDS: AgentId[] = ['pip', 'theo', 'maya', 'sage', 'nora', 'ads', 'qa-release', 'support', 'data', 'docs', 'seo']
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
  lastHealthCheck?: Timestamp
  lastHealthStatus?: 'ok' | 'degraded' | 'unreachable'
  skillPolicy?: AgentSkillPolicyState
  createdAt: Timestamp
  updatedAt: Timestamp
}

/** Shape stored in Firestore (apiKey is encrypted JSON) */
export interface AgentTeamStoredDoc extends Omit<AgentTeamDoc, 'apiKey'> {
  apiKey: string // JSON-serialised EncryptedData: { ciphertext, iv, tag }
}
