import type { OrgRole } from '@/lib/organizations/types'
import { isValidAgentId, type AgentId } from '@/lib/agents/types'

export const WORKSPACE_MODULE_KEYS = [
  'crm',
  'projects',
  'documents',
  'marketing',
  'messages',
  'email',
  'reports',
  'research',
  'properties',
  'billing',
  'mobileApps',
  'youtubeStudio',
  'bookStudio',
] as const

export type WorkspaceModuleKey = (typeof WORKSPACE_MODULE_KEYS)[number]
export type RecordScopedModuleKey = 'crm' | 'projects'
export type RecordScope = 'all' | 'owned_or_linked'
export type AccessPolicyPreset =
  | 'full'
  | 'crm_sales'
  | 'project_delivery'
  | 'marketing'
  | 'finance'
  | 'reviewer'
  | 'custom'

export type LegacyAccessScope = 'none' | 'all' | 'crm' | 'marketing' | 'projects' | 'billing' | 'readonly'

export interface MemberAccessPolicy {
  preset: AccessPolicyPreset
  modules: Record<WorkspaceModuleKey, boolean>
  recordScopes: Record<RecordScopedModuleKey, RecordScope>
  /** Explicit specialist-agent grants by authorised runtime target. Members
   * never receive agent execution merely because they can use Messages. */
  agentRuntimeAccess: Record<string, AgentId[]>
  /**
   * When true, this member may sync and use their personal LLM credentials on
   * the organisation VPS (in addition to their own linked computers).
   * Default false for members; owners/full-access policies default true.
   */
  allowPersonalLlmOnOrgVps: boolean
}

type RoleWithSystem = OrgRole | 'system'

const MODULE_LABELS: Record<WorkspaceModuleKey, string> = {
  crm: 'CRM',
  projects: 'Projects',
  documents: 'Documents',
  marketing: 'Marketing',
  messages: 'Messages',
  email: 'Email',
  reports: 'Reports',
  research: 'Research',
  properties: 'Properties',
  billing: 'Billing',
  mobileApps: 'Mobile Apps',
  youtubeStudio: 'YouTube Studio',
  bookStudio: 'Book Studio',
}

function moduleFlags(value: boolean): Record<WorkspaceModuleKey, boolean> {
  return Object.fromEntries(WORKSPACE_MODULE_KEYS.map((key) => [key, value])) as Record<WorkspaceModuleKey, boolean>
}

function policy(input: {
  preset: AccessPolicyPreset
  modules: Partial<Record<WorkspaceModuleKey, boolean>>
  recordScopes?: Partial<Record<RecordScopedModuleKey, RecordScope>>
  allowPersonalLlmOnOrgVps?: boolean
}): MemberAccessPolicy {
  return normalizeMemberAccessPolicy(input)
}

/** Owners/full-access and explicitly opted-in members may use personal LLM keys on the org VPS. */
export function memberMayUsePersonalLlmOnOrgVps(
  policyValue: MemberAccessPolicy | unknown,
  role?: RoleWithSystem | null,
): boolean {
  if (role === 'system' || role === 'owner') return true
  return normalizeMemberAccessPolicy(policyValue).allowPersonalLlmOnOrgVps === true
}

export const FULL_ACCESS_POLICY: MemberAccessPolicy = {
  preset: 'full',
  modules: moduleFlags(true),
  recordScopes: { crm: 'all', projects: 'all' },
  agentRuntimeAccess: {},
  allowPersonalLlmOnOrgVps: true,
}

export const OWNED_OR_LINKED_DEFAULT_SCOPES: Record<RecordScopedModuleKey, RecordScope> = {
  crm: 'owned_or_linked',
  projects: 'owned_or_linked',
}

export function normalizeMemberAccessPolicy(value: unknown): MemberAccessPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      preset: 'custom',
      modules: moduleFlags(false),
      recordScopes: { ...OWNED_OR_LINKED_DEFAULT_SCOPES },
      agentRuntimeAccess: {},
      allowPersonalLlmOnOrgVps: false,
    }
  }

  const input = value as {
    preset?: unknown
    modules?: unknown
    recordScopes?: unknown
    agentRuntimeAccess?: unknown
    allowPersonalLlmOnOrgVps?: unknown
  }
  const modulesInput =
    input.modules && typeof input.modules === 'object' && !Array.isArray(input.modules)
      ? input.modules as Record<string, unknown>
      : {}
  const recordScopesInput =
    input.recordScopes && typeof input.recordScopes === 'object' && !Array.isArray(input.recordScopes)
      ? input.recordScopes as Record<string, unknown>
      : {}
  const agentRuntimeAccessInput =
    input.agentRuntimeAccess && typeof input.agentRuntimeAccess === 'object' && !Array.isArray(input.agentRuntimeAccess)
      ? input.agentRuntimeAccess as Record<string, unknown>
      : {}

  const modules = moduleFlags(false)
  for (const key of WORKSPACE_MODULE_KEYS) {
    modules[key] = modulesInput[key] === true
  }

  const recordScopes: Record<RecordScopedModuleKey, RecordScope> = { ...OWNED_OR_LINKED_DEFAULT_SCOPES }
  for (const key of Object.keys(recordScopes) as RecordScopedModuleKey[]) {
    const scope = recordScopesInput[key]
    recordScopes[key] = scope === 'all' ? 'all' : 'owned_or_linked'
  }
  const agentRuntimeAccess: Record<string, AgentId[]> = {}
  for (const [runtimeTargetId, rawAgentIds] of Object.entries(agentRuntimeAccessInput)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(runtimeTargetId) || !Array.isArray(rawAgentIds)) continue
    const agentIds = Array.from(new Set(rawAgentIds.filter((agentId): agentId is AgentId => (
      isValidAgentId(agentId)
    ))))
    if (agentIds.length > 0) agentRuntimeAccess[runtimeTargetId] = agentIds
  }

  const preset = typeof input.preset === 'string' && [
    'full',
    'crm_sales',
    'project_delivery',
    'marketing',
    'finance',
    'reviewer',
    'custom',
  ].includes(input.preset)
    ? input.preset as AccessPolicyPreset
    : 'custom'

  const allowPersonalLlmOnOrgVps = input.allowPersonalLlmOnOrgVps === true

  return { preset, modules, recordScopes, agentRuntimeAccess, allowPersonalLlmOnOrgVps }
}

/** Normalize runtime target ids so Team grants match dispatch/create.
 * Team UI and workspace bindings both use `linked-device:{deviceId}`, but some
 * callers still pass a bare device id. Accept either form. */
export function runtimeGrantKeys(runtimeTargetId: string): string[] {
  const trimmed = runtimeTargetId.trim()
  if (!trimmed) return []
  const keys = new Set<string>([trimmed])
  if (trimmed.startsWith('linked-device:')) {
    const bare = trimmed.slice('linked-device:'.length).trim()
    if (bare) keys.add(bare)
  } else {
    keys.add(`linked-device:${trimmed}`)
  }
  return Array.from(keys)
}

/** True only for an explicit member grant. Owners/admins bypass this at the
 * caller because their role is authoritative and should not need per-device rows. */
export function memberCanUseAgentOnRuntime(
  policyValue: MemberAccessPolicy | unknown,
  runtimeTargetId: string | null | undefined,
  agentId: AgentId,
): boolean {
  if (!runtimeTargetId) return false
  const grants = normalizeMemberAccessPolicy(policyValue).agentRuntimeAccess ?? {}
  return runtimeGrantKeys(runtimeTargetId).some((key) => grants[key]?.includes(agentId) === true)
}

export function defaultAccessPolicyFor(role: RoleWithSystem, accessScope?: unknown): MemberAccessPolicy {
  if (role === 'system' || role === 'owner' || role === 'admin') return FULL_ACCESS_POLICY

  const rawScope = typeof accessScope === 'string' ? accessScope.trim() : ''
  if (!rawScope) {
    return role === 'viewer'
      ? policy({
          preset: 'reviewer',
          modules: {
            crm: true,
            projects: true,
            documents: true,
            reports: true,
            research: true,
            properties: true,
          },
          recordScopes: { crm: 'owned_or_linked', projects: 'owned_or_linked' },
        })
      : FULL_ACCESS_POLICY
  }

  const scope = rawScope as LegacyAccessScope
  if (scope === 'all') return FULL_ACCESS_POLICY
  if (scope === 'crm') {
    return policy({
      preset: 'crm_sales',
      modules: { crm: true, reports: true },
      recordScopes: { crm: 'owned_or_linked', projects: 'owned_or_linked' },
    })
  }
  if (scope === 'projects') {
    return policy({
      preset: 'project_delivery',
      modules: { projects: true, documents: true, messages: true, reports: true },
      recordScopes: { crm: 'owned_or_linked', projects: 'owned_or_linked' },
    })
  }
  if (scope === 'marketing') {
    return policy({
      preset: 'marketing',
      modules: { marketing: true, messages: true, email: true, reports: true, research: true },
      recordScopes: { crm: 'owned_or_linked', projects: 'owned_or_linked' },
    })
  }
  if (scope === 'billing') {
    return policy({
      preset: 'finance',
      modules: { billing: true, reports: true },
      recordScopes: { crm: 'owned_or_linked', projects: 'owned_or_linked' },
    })
  }
  if (scope === 'readonly') {
    return policy({
      preset: 'reviewer',
      modules: {
        crm: true,
        projects: true,
        documents: true,
        reports: true,
        research: true,
        properties: true,
      },
      recordScopes: { crm: 'owned_or_linked', projects: 'owned_or_linked' },
    })
  }

  return policy({
    preset: 'custom',
    modules: {},
    recordScopes: { crm: 'owned_or_linked', projects: 'owned_or_linked' },
  })
}

export function resolveMemberAccessPolicy(input: {
  role: RoleWithSystem
  accessScope?: unknown
  accessPolicy?: unknown
}): MemberAccessPolicy {
  if (input.role === 'system' || input.role === 'owner') return FULL_ACCESS_POLICY
  if (input.accessPolicy && typeof input.accessPolicy === 'object') {
    return normalizeMemberAccessPolicy(input.accessPolicy)
  }
  return defaultAccessPolicyFor(input.role, input.accessScope)
}

export function canAccessModule(policyValue: MemberAccessPolicy | unknown, moduleKey: WorkspaceModuleKey): boolean {
  const policy = normalizePolicyOrFull(policyValue)
  return policy.modules[moduleKey] === true
}

export function recordScopeFor(policyValue: MemberAccessPolicy | unknown, moduleKey: RecordScopedModuleKey): RecordScope {
  const policy = normalizePolicyOrFull(policyValue)
  return policy.recordScopes[moduleKey] ?? 'owned_or_linked'
}

export function canAccessAllModuleRecords(policyValue: MemberAccessPolicy | unknown, moduleKey: RecordScopedModuleKey): boolean {
  return recordScopeFor(policyValue, moduleKey) === 'all'
}

export function accessSummaryForPolicy(policyValue: MemberAccessPolicy | unknown): string {
  const policy = normalizePolicyOrFull(policyValue)
  if (WORKSPACE_MODULE_KEYS.every((key) => policy.modules[key]) && policy.recordScopes.crm === 'all' && policy.recordScopes.projects === 'all') {
    return 'Full workspace access'
  }

  const enabled = WORKSPACE_MODULE_KEYS
    .filter((key) => policy.modules[key])
    .map((key) => MODULE_LABELS[key])

  const moduleText = enabled.length > 0 ? enabled.join(', ') : 'No modules'
  const scoped: string[] = []
  if (policy.modules.crm && policy.recordScopes.crm === 'owned_or_linked') scoped.push('CRM')
  if (policy.modules.projects && policy.recordScopes.projects === 'owned_or_linked') scoped.push('Projects')
  return scoped.length > 0 ? `${moduleText} - owned or linked records` : moduleText
}

export function policyFromAccessScope(accessScope?: unknown, role: RoleWithSystem = 'member'): MemberAccessPolicy {
  return defaultAccessPolicyFor(role, accessScope)
}

function normalizePolicyOrFull(value: MemberAccessPolicy | unknown): MemberAccessPolicy {
  if (!value || typeof value !== 'object') return normalizeMemberAccessPolicy(null)
  return normalizeMemberAccessPolicy(value)
}
