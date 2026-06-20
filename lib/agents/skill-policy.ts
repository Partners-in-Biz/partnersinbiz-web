import rawPolicy from '@/config/agent-skill-policy.json'
import type { AgentId, AgentSkillPolicyState } from './types'

export type AgentSkillPolicyMode = 'hard_allowlist'
export type AgentSkillRiskLevel = 'low' | 'medium' | 'high' | 'critical'
export type AgentCapability =
  | 'read'
  | 'draft'
  | 'write'
  | 'approve'
  | 'publish'
  | 'deploy'
  | 'spend'
  | 'message_client'
  | 'access_secret'
  | 'delete'

export interface AgentCapabilityGate {
  requiresApproval: boolean
  reason: string
}

export interface AgentSkillCatalogEntry {
  ownerAgentId: AgentId
  allowedAgentIds: AgentId[]
  riskLevel: AgentSkillRiskLevel
  syncTarget: 'vps'
}

export interface AgentSkillPolicyDefinition {
  name?: string
  label: string
  role?: string
  vpsExternalDir: string
  pibSkills: string[]
  runtimeSkills: string[]
  globalSkills: string[]
  deniedSkills: string[]
  capabilities: AgentCapability[]
  approvalGates: AgentCapability[]
  primaryOwnerOf: string[]
  mayRequestFrom: AgentId[]
  reviewerAgentId?: AgentId | null
}

export interface AgentSkillPolicyManifest {
  version: string
  catalogVersion: string
  mode: AgentSkillPolicyMode
  vpsRoot: string
  repoPibSkills: string[]
  futureAgentCandidates: string[]
  capabilities: AgentCapability[]
  approvalGates: Partial<Record<AgentCapability, AgentCapabilityGate>>
  skillCatalog: Record<string, AgentSkillCatalogEntry>
  agents: Record<string, AgentSkillPolicyDefinition>
}

export interface AgentSkillPolicyDrift {
  status: 'in_sync' | 'drifted' | 'not_applied'
  missingPibSkills: string[]
  unexpectedPibSkills: string[]
  missingGlobalSkills: string[]
  unexpectedGlobalSkills: string[]
  configExternalDirs: string[]
  expectedExternalDirs: string[]
}

export const AGENT_SKILL_POLICY = rawPolicy as AgentSkillPolicyManifest

export function listCatalogSkillPaths(): string[] {
  return Object.keys(AGENT_SKILL_POLICY.skillCatalog).sort()
}

export function listSyncableRepoSkillPaths(): string[] {
  return Object.entries(AGENT_SKILL_POLICY.skillCatalog)
    .filter(([, entry]) => entry.syncTarget === 'vps')
    .map(([skillPath]) => skillPath)
    .sort()
}

export function listPolicyAgentIds(): AgentId[] {
  return Object.keys(AGENT_SKILL_POLICY.agents)
}

export function getAgentSkillPolicy(agentId: AgentId): AgentSkillPolicyDefinition | null {
  return AGENT_SKILL_POLICY.agents[agentId] ?? null
}

export function buildAgentSkillPolicyState(
  agentId: AgentId,
  patch: Partial<Pick<AgentSkillPolicyState, 'appliedAt' | 'appliedBy' | 'appliedVersion' | 'driftStatus'>> = {},
): AgentSkillPolicyState | null {
  const policy = getAgentSkillPolicy(agentId)
  if (!policy) return null

  return {
    mode: AGENT_SKILL_POLICY.mode,
    policyVersion: AGENT_SKILL_POLICY.version,
    catalogVersion: AGENT_SKILL_POLICY.catalogVersion,
    pibSkills: [...policy.pibSkills],
    runtimeSkills: [...policy.runtimeSkills],
    globalSkills: [...policy.globalSkills],
    deniedSkills: [...policy.deniedSkills],
    capabilities: [...policy.capabilities],
    approvalGates: [...policy.approvalGates],
    primaryOwnerOf: [...policy.primaryOwnerOf],
    mayRequestFrom: [...policy.mayRequestFrom],
    reviewerAgentId: policy.reviewerAgentId ?? null,
    vpsExternalDir: policy.vpsExternalDir,
    appliedVersion: patch.appliedVersion ?? null,
    appliedAt: patch.appliedAt ?? null,
    appliedBy: patch.appliedBy ?? null,
    driftStatus: patch.driftStatus ?? 'unknown',
  }
}

function normalizeSkillName(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  for (const key of ['name', 'id', 'path', 'skill', 'slug']) {
    const raw = source[key]
    if (typeof raw === 'string' && raw.trim()) return raw.trim()
  }
  return null
}

export function normalizeInstalledSkillNames(value: unknown): string[] {
  const rawList = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as Record<string, unknown>).skills)
      ? (value as Record<string, unknown>).skills as unknown[]
      : []

  return Array.from(new Set(rawList.map(normalizeSkillName).filter((item): item is string => !!item))).sort()
}

function skillBasename(skill: string): string {
  return skill.split('/').filter(Boolean).at(-1) ?? skill
}

export function classifyInstalledSkills(installed: string[]): { pib: string[]; global: string[] } {
  const catalogPaths = new Set(Object.keys(AGENT_SKILL_POLICY.skillCatalog))
  const catalogByBase = new Map(Object.keys(AGENT_SKILL_POLICY.skillCatalog).map((skill) => [skillBasename(skill), skill]))
  const policyGlobals = new Set(Object.values(AGENT_SKILL_POLICY.agents).flatMap((policy) => policy.globalSkills))
  const pib: string[] = []
  const global: string[] = []

  for (const skill of installed) {
    const normalized = skill.trim()
    if (!normalized) continue

    if (policyGlobals.has(normalized)) {
      global.push(normalized)
      continue
    }

    if (normalized.startsWith('partnersinbiz/')) {
      const repoSkill = normalized.slice('partnersinbiz/'.length)
      if (catalogPaths.has(repoSkill)) pib.push(repoSkill)
      else global.push(normalized)
      continue
    }

    if (catalogPaths.has(normalized)) {
      pib.push(normalized)
      continue
    }

    // Fully-qualified non-PiB skills are global skills. Do not map them by
    // basename, because globals can intentionally share names with PiB skills
    // such as productivity/google-workspace vs partnersinbiz/google-workspace.
    if (normalized.includes('/')) {
      global.push(normalized)
      continue
    }

    const catalogSkill = catalogByBase.get(skillBasename(normalized))
    if (catalogSkill) {
      pib.push(catalogSkill)
    } else {
      global.push(normalized)
    }
  }

  return {
    pib: Array.from(new Set(pib)).sort(),
    global: Array.from(new Set(global)).sort(),
  }
}

export function extractHermesExternalDirs(config: unknown): string[] {
  const source = config && typeof config === 'object' ? config as Record<string, unknown> : {}
  const skills = source.skills && typeof source.skills === 'object' ? source.skills as Record<string, unknown> : {}
  const dirs = Array.isArray(skills.external_dirs) ? skills.external_dirs : []
  return dirs.filter((dir): dir is string => typeof dir === 'string' && dir.trim().length > 0).map((dir) => dir.trim())
}

export function withAgentPolicyExternalDir(config: unknown, agentId: AgentId): Record<string, unknown> | null {
  const policy = getAgentSkillPolicy(agentId)
  if (!policy) return null
  const source = config && typeof config === 'object' && !Array.isArray(config) ? config as Record<string, unknown> : {}
  const skills = source.skills && typeof source.skills === 'object' && !Array.isArray(source.skills)
    ? source.skills as Record<string, unknown>
    : {}

  return {
    ...source,
    skills: {
      ...skills,
      external_dirs: [policy.vpsExternalDir],
    },
  }
}

function diff(expected: string[], installed: string[]): { missing: string[]; unexpected: string[] } {
  const installedSet = new Set(installed)
  const expectedSet = new Set(expected)
  return {
    missing: expected.filter((skill) => !installedSet.has(skill)).sort(),
    unexpected: installed.filter((skill) => !expectedSet.has(skill)).sort(),
  }
}

export function computeAgentSkillDrift(args: {
  agentId: AgentId
  installedPibSkills: string[]
  installedGlobalSkills: string[]
  configExternalDirs: string[]
}): AgentSkillPolicyDrift | null {
  const policy = getAgentSkillPolicy(args.agentId)
  if (!policy) return null

  const expectedRuntimeSkills = policy.runtimeSkills?.length ? policy.runtimeSkills : policy.pibSkills
  const pib = diff(expectedRuntimeSkills, args.installedPibSkills ?? [])
  const global = diff(policy.globalSkills, args.installedGlobalSkills ?? [])
  const expectedExternalDirs = [policy.vpsExternalDir]
  const configExternalDirs = args.configExternalDirs
  const configOk = configExternalDirs.length === 1 && configExternalDirs[0] === policy.vpsExternalDir
  const status = configOk && pib.missing.length === 0 && pib.unexpected.length === 0 && global.missing.length === 0 && global.unexpected.length === 0
    ? 'in_sync'
    : 'drifted'

  return {
    status,
    missingPibSkills: pib.missing,
    unexpectedPibSkills: pib.unexpected,
    missingGlobalSkills: global.missing,
    unexpectedGlobalSkills: global.unexpected,
    configExternalDirs,
    expectedExternalDirs,
  }
}
