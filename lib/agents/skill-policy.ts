import rawPolicy from '@/config/agent-skill-policy.json'
import type { AgentId, AgentSkillPolicyState } from './types'

export type AgentSkillPolicyMode = 'hard_allowlist'

export interface AgentSkillPolicyDefinition {
  label: string
  vpsExternalDir: string
  pibSkills: string[]
  globalSkills: string[]
  deniedSkills: string[]
}

export interface AgentSkillPolicyManifest {
  version: string
  mode: AgentSkillPolicyMode
  vpsRoot: string
  repoPibSkills: string[]
  futureAgentCandidates: string[]
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
    pibSkills: [...policy.pibSkills],
    globalSkills: [...policy.globalSkills],
    deniedSkills: [...policy.deniedSkills],
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

  const pib = diff(policy.pibSkills, args.installedPibSkills)
  const global = diff(policy.globalSkills, args.installedGlobalSkills)
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
