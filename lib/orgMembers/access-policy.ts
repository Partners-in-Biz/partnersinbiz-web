import type { OrgRole } from '@/lib/organizations/types'
import { isValidAgentId, type AgentId } from '@/lib/agents/types'
import {
  canRolePerformModuleAction,
  resolveOrganizationModulePolicies,
  type OrganizationModulePolicyKey,
} from '@/lib/organizations/module-policies'

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
  'configuration',
] as const

export type WorkspaceModuleKey = (typeof WORKSPACE_MODULE_KEYS)[number]

/** Modules whose members see only owned/linked records when scope is owned_or_linked. */
export const RECORD_SCOPED_MODULE_KEYS = [
  'crm',
  'projects',
  'research',
  'documents',
  'marketing',
] as const
export type RecordScopedModuleKey = (typeof RECORD_SCOPED_MODULE_KEYS)[number]
export type RecordScope = 'all' | 'owned_or_linked'

/**
 * Per-module action vocabulary shared with the organisation modulePolicies
 * matrix. A module toggle is the top-level allow; per-action grants refine it.
 */
export const MEMBER_MODULE_ACTION_KEYS = [
  'create',
  'edit',
  'delete',
  'export',
  'approve',
  'send',
  'archiveDelete',
  'share',
] as const
export type MemberModuleActionKey = (typeof MEMBER_MODULE_ACTION_KEYS)[number]
export type MemberModuleActions = Record<WorkspaceModuleKey, Partial<Record<MemberModuleActionKey, boolean>>>

export type AccessPolicyPreset =
  | 'full'
  | 'crm_sales'
  | 'project_delivery'
  | 'marketing'
  | 'finance'
  | 'reviewer'
  | 'custom'

export const ACCESS_POLICY_PRESETS: readonly Exclude<AccessPolicyPreset, 'custom'>[] = [
  'full',
  'crm_sales',
  'project_delivery',
  'marketing',
  'finance',
  'reviewer',
]

export type LegacyAccessScope = 'none' | 'all' | 'crm' | 'marketing' | 'projects' | 'billing' | 'readonly'

/** Explicit issuer grants. Billing module alone does not allow create/list of
 * the workspace invoice/quote book — org owner/admin must toggle these. */
export type MemberBillingCapabilities = {
  invoices: boolean
  quotes: boolean
}

export interface MemberAccessPolicy {
  preset: AccessPolicyPreset
  modules: Record<WorkspaceModuleKey, boolean>
  recordScopes: Record<RecordScopedModuleKey, RecordScope>
  /**
   * Optional per-module action grants. Missing module key or missing action =
   * module-level default (see memberCanPerformModuleAction). Fail-closed
   * actions (billing.delete, crm.delete/export via org guardrails) fall back
   * to their org default when no explicit flag is stored.
   */
  moduleActions?: MemberModuleActions
  /** Explicit specialist-agent grants by authorised runtime target. Members
   * never receive agent execution merely because they can use Messages. */
  agentRuntimeAccess: Record<string, AgentId[]>
  /**
   * When true, this member may sync and use their personal LLM credentials on
   * the organisation VPS (in addition to their own linked computers).
   * Default false for members; owners/full-access policies default true.
   */
  allowPersonalLlmOnOrgVps: boolean
  /**
   * Invoice/quote issuer rights for members. Independent of modules.billing
   * (UI open). Fail closed unless true; still AND with CRM owned_or_linked
   * scope for non-privileged actors.
   */
  capabilities: MemberBillingCapabilities
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
  configuration: 'Configuration',
}

function moduleFlags(value: boolean): Record<WorkspaceModuleKey, boolean> {
  return Object.fromEntries(WORKSPACE_MODULE_KEYS.map((key) => [key, value])) as Record<WorkspaceModuleKey, boolean>
}

function policy(input: {
  preset: AccessPolicyPreset
  modules: Partial<Record<WorkspaceModuleKey, boolean>>
  recordScopes?: Partial<Record<RecordScopedModuleKey, RecordScope>>
  moduleActions?: Partial<MemberModuleActions>
  allowPersonalLlmOnOrgVps?: boolean
  capabilities?: Partial<MemberBillingCapabilities>
}): MemberAccessPolicy {
  return normalizeMemberAccessPolicy(input)
}

function emptyBillingCapabilities(): MemberBillingCapabilities {
  return { invoices: false, quotes: false }
}

function fullBillingCapabilities(): MemberBillingCapabilities {
  return { invoices: true, quotes: true }
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
  recordScopes: {
    crm: 'all',
    projects: 'all',
    research: 'all',
    documents: 'all',
    marketing: 'all',
  },
  moduleActions: emptyModuleActions(),
  agentRuntimeAccess: {},
  allowPersonalLlmOnOrgVps: true,
  capabilities: fullBillingCapabilities(),
}

/**
 * Default record scopes. CRM/Projects default to owned_or_linked because
 * assignment ownership is core to their workflows. Research/Documents/Marketing
 * default to 'all' so existing members never lose access on deploy; org admins
 * may narrow them per member in the Team editor.
 */
export const DEFAULT_RECORD_SCOPES: Record<RecordScopedModuleKey, RecordScope> = {
  crm: 'owned_or_linked',
  projects: 'owned_or_linked',
  research: 'all',
  documents: 'all',
  marketing: 'all',
}

/** Back-compat alias used by older callers. */
export const OWNED_OR_LINKED_DEFAULT_SCOPES: Record<RecordScopedModuleKey, RecordScope> = {
  crm: 'owned_or_linked',
  projects: 'owned_or_linked',
  research: 'owned_or_linked',
  documents: 'owned_or_linked',
  marketing: 'owned_or_linked',
}

function emptyModuleActions(): MemberModuleActions {
  return Object.fromEntries(WORKSPACE_MODULE_KEYS.map((key) => [key, {}])) as MemberModuleActions
}

function normalizeModuleActions(value: unknown): MemberModuleActions {
  const actions = emptyModuleActions()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return actions
  for (const [moduleKey, rawActions] of Object.entries(value as Record<string, unknown>)) {
    if (!WORKSPACE_MODULE_KEYS.includes(moduleKey as WorkspaceModuleKey)) continue
    if (!rawActions || typeof rawActions !== 'object' || Array.isArray(rawActions)) continue
    const perModule: Partial<Record<MemberModuleActionKey, boolean>> = {}
    for (const [actionKey, flag] of Object.entries(rawActions as Record<string, unknown>)) {
      if (MEMBER_MODULE_ACTION_KEYS.includes(actionKey as MemberModuleActionKey) && typeof flag === 'boolean') {
        perModule[actionKey as MemberModuleActionKey] = flag
      }
    }
    actions[moduleKey as WorkspaceModuleKey] = perModule
  }
  return actions
}

export function normalizeMemberAccessPolicy(value: unknown): MemberAccessPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      preset: 'custom',
      modules: moduleFlags(false),
      recordScopes: { ...DEFAULT_RECORD_SCOPES },
      moduleActions: emptyModuleActions(),
      agentRuntimeAccess: {},
      allowPersonalLlmOnOrgVps: false,
      capabilities: emptyBillingCapabilities(),
    }
  }

  const input = value as {
    preset?: unknown
    modules?: unknown
    recordScopes?: unknown
    moduleActions?: unknown
    agentRuntimeAccess?: unknown
    allowPersonalLlmOnOrgVps?: unknown
    capabilities?: unknown
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
  const capabilitiesInput =
    input.capabilities && typeof input.capabilities === 'object' && !Array.isArray(input.capabilities)
      ? input.capabilities as Record<string, unknown>
      : {}

  const modules = moduleFlags(false)
  for (const key of WORKSPACE_MODULE_KEYS) {
    modules[key] = modulesInput[key] === true
  }

  const recordScopes: Record<RecordScopedModuleKey, RecordScope> = { ...DEFAULT_RECORD_SCOPES }
  for (const key of RECORD_SCOPED_MODULE_KEYS) {
    const scope = recordScopesInput[key]
    // Only override when the stored policy actually carries the key; missing
    // keys keep DEFAULT_RECORD_SCOPES so legacy partial policies never lose
    // effective access (research/documents/marketing stay 'all').
    if (scope === 'all' || scope === 'owned_or_linked') {
      recordScopes[key] = scope
    }
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

  // Explicit capability flags only. modules.billing opens UI; it does not imply
  // issuer rights. Full-access presets set both true via FULL_ACCESS_POLICY.
  const capabilities: MemberBillingCapabilities = {
    invoices: capabilitiesInput.invoices === true,
    quotes: capabilitiesInput.quotes === true,
  }

  return {
    preset,
    modules,
    recordScopes,
    moduleActions: normalizeModuleActions(input.moduleActions),
    agentRuntimeAccess,
    allowPersonalLlmOnOrgVps,
    capabilities,
  }
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
    // Legacy finance scope opens billing UI only — issuer rights stay explicit.
    return policy({
      preset: 'finance',
      modules: { billing: true, reports: true },
      recordScopes: { crm: 'owned_or_linked', projects: 'owned_or_linked' },
      capabilities: emptyBillingCapabilities(),
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

/** Organisation modulePolicies keys that map to a workspace module key. */
const ORG_POLICY_TO_WORKSPACE: Record<OrganizationModulePolicyKey, WorkspaceModuleKey> = {
  projects: 'projects',
  documents: 'documents',
  research: 'research',
  mobileApps: 'mobileApps',
  youtubeStudio: 'youtubeStudio',
  bookStudio: 'bookStudio',
  marketing: 'marketing',
  messages: 'messages',
}

/** Map an organisation matrix action to member action flags it gates. */
const ORG_ACTION_TO_MEMBER_ACTIONS: Record<string, MemberModuleActionKey[]> = {
  create: ['create'],
  edit: ['edit'],
  delete: ['delete', 'archiveDelete'],
  archiveDelete: ['delete', 'archiveDelete'],
  export: ['export'],
  approve: ['approve'],
  approvePublish: ['approve', 'send'],
  reviewApproval: ['approve'],
  publishApprovals: ['approve'],
  send: ['send'],
  start: ['send'],
  reply: ['send'],
  shareLinks: ['share'],
}

/**
 * The unified resolver. Per-member accessPolicy is the source of truth when it
 * exists. Members without an explicit policy fall back to the legacy role /
 * accessScope defaults, with organisation modulePolicies acting as the default
 * visibility + action matrix (so org-level toggles still govern them).
 */
export function resolveEffectiveMemberPolicy(input: {
  role: RoleWithSystem
  accessScope?: unknown
  accessPolicy?: unknown
  orgModulePolicies?: unknown
}): MemberAccessPolicy {
  if (input.role === 'system' || input.role === 'owner') return FULL_ACCESS_POLICY
  if (input.accessPolicy && typeof input.accessPolicy === 'object') {
    return normalizeMemberAccessPolicy(input.accessPolicy)
  }

  const base = defaultAccessPolicyFor(input.role, input.accessScope)
  if (!input.orgModulePolicies) return base

  const policies = resolveOrganizationModulePolicies({ modulePolicies: input.orgModulePolicies })
  const normalizedRole = input.role === 'admin' || input.role === 'member' || input.role === 'viewer'
    ? input.role
    : 'member'
  const baseWithActions: MemberAccessPolicy = {
    ...base,
    // Clone nested objects so applying org defaults never mutates the shared
    // FULL_ACCESS_POLICY singleton (which owners/admins also resolve to).
    modules: { ...base.modules },
    recordScopes: { ...base.recordScopes },
    moduleActions: normalizeModuleActions(base.moduleActions),
  }

  for (const orgKey of Object.keys(ORG_POLICY_TO_WORKSPACE) as OrganizationModulePolicyKey[]) {
    const workspaceKey = ORG_POLICY_TO_WORKSPACE[orgKey]
    if (!canRolePerformModuleAction(policies, orgKey, 'visibility', normalizedRole)) {
      baseWithActions.modules[workspaceKey] = false
      continue
    }
    for (const [actionId, selection] of Object.entries(policies[orgKey]?.actions ?? {})) {
      const memberActions = ORG_ACTION_TO_MEMBER_ACTIONS[actionId]
      if (!memberActions) continue
      if (selection[normalizedRole] !== true) {
        for (const memberAction of memberActions) {
          baseWithActions.moduleActions![workspaceKey][memberAction] = false
        }
      }
    }
  }

  return baseWithActions
}

export function resolveMemberAccessPolicy(input: {
  role: RoleWithSystem
  accessScope?: unknown
  accessPolicy?: unknown
}): MemberAccessPolicy {
  return resolveEffectiveMemberPolicy(input)
}

export function canAccessModule(policyValue: MemberAccessPolicy | unknown, moduleKey: WorkspaceModuleKey): boolean {
  const policy = normalizePolicyOrFull(policyValue)
  return policy.modules[moduleKey] === true
}

export function recordScopeFor(policyValue: MemberAccessPolicy | unknown, moduleKey: RecordScopedModuleKey): RecordScope {
  const policy = normalizePolicyOrFull(policyValue)
  return policy.recordScopes[moduleKey] ?? DEFAULT_RECORD_SCOPES[moduleKey] ?? 'owned_or_linked'
}

export function canAccessAllModuleRecords(policyValue: MemberAccessPolicy | unknown, moduleKey: RecordScopedModuleKey): boolean {
  return recordScopeFor(policyValue, moduleKey) === 'all'
}

/**
 * Per-module action grant for a member. Module toggle is the top-level allow;
 * an explicit per-action flag refines it; otherwise the caller-supplied org
 * default applies (default true = current behaviour when module is on).
 * Privileged roles bypass via call sites (they resolve FULL_ACCESS_POLICY).
 */
export function memberCanPerformModuleAction(
  policyValue: MemberAccessPolicy | unknown,
  moduleKey: WorkspaceModuleKey,
  actionKey: MemberModuleActionKey,
  orgDefault = true,
): boolean {
  const policy = normalizePolicyOrFull(policyValue)
  if (isFullWorkspaceAccessPolicy(policy)) return true
  if (policy.modules[moduleKey] !== true) return false
  const explicit = policy.moduleActions?.[moduleKey]?.[actionKey]
  if (typeof explicit === 'boolean') return explicit
  return orgDefault
}

/** Billing delete is fail-closed: members need an explicit grant (full workspace implies it). */
export function memberCanDeleteBillingRecord(policyValue: MemberAccessPolicy | unknown): boolean {
  const policy = normalizePolicyOrFull(policyValue)
  if (isFullWorkspaceAccessPolicy(policy)) return true
  return policy.moduleActions?.billing?.delete === true
}

/** True when policy is the unrestricted full workspace grant (includes issuer). */
export function isFullWorkspaceAccessPolicy(policyValue: MemberAccessPolicy | unknown): boolean {
  const policy = normalizePolicyOrFull(policyValue)
  return WORKSPACE_MODULE_KEYS.every((key) => policy.modules[key])
    && RECORD_SCOPED_MODULE_KEYS.every((key) => policy.recordScopes[key] === 'all')
}

/**
 * Member may create/list issuer invoices. Owners/admins/system bypass via role
 * at call sites; full workspace policy implies grant; otherwise explicit flag.
 */
export function memberCanIssueInvoices(policyValue: MemberAccessPolicy | unknown): boolean {
  const policy = normalizePolicyOrFull(policyValue)
  if (isFullWorkspaceAccessPolicy(policy)) return true
  return policy.capabilities.invoices === true
}

/** Member may create/list issuer quotes (same grant model as invoices). */
export function memberCanIssueQuotes(policyValue: MemberAccessPolicy | unknown): boolean {
  const policy = normalizePolicyOrFull(policyValue)
  if (isFullWorkspaceAccessPolicy(policy)) return true
  return policy.capabilities.quotes === true
}

/** Named starting points for the Team access editor. */
export function presetPolicy(preset: AccessPolicyPreset): MemberAccessPolicy {
  switch (preset) {
    case 'full':
      return FULL_ACCESS_POLICY
    case 'crm_sales':
      return policy({
        preset: 'crm_sales',
        modules: { crm: true, reports: true },
        recordScopes: { crm: 'owned_or_linked', projects: 'owned_or_linked' },
      })
    case 'project_delivery':
      return policy({
        preset: 'project_delivery',
        modules: { projects: true, documents: true, messages: true, reports: true },
        recordScopes: { crm: 'owned_or_linked', projects: 'owned_or_linked' },
      })
    case 'marketing':
      return policy({
        preset: 'marketing',
        modules: { marketing: true, messages: true, email: true, reports: true, research: true },
        recordScopes: { crm: 'owned_or_linked', projects: 'owned_or_linked' },
      })
    case 'finance':
      return policy({
        preset: 'finance',
        modules: { billing: true, reports: true },
        recordScopes: { crm: 'owned_or_linked', projects: 'owned_or_linked' },
        capabilities: emptyBillingCapabilities(),
      })
    case 'reviewer':
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
    default:
      return normalizeMemberAccessPolicy({
        preset: 'custom',
        modules: {},
        recordScopes: { crm: 'owned_or_linked', projects: 'owned_or_linked' },
      })
  }
}

export const ACCESS_PRESET_LABELS: Record<Exclude<AccessPolicyPreset, 'custom'>, string> = {
  full: 'Full workspace',
  crm_sales: 'CRM & sales',
  project_delivery: 'Project delivery',
  marketing: 'Marketing',
  finance: 'Finance',
  reviewer: 'Read-only reviewer',
}

export function accessSummaryForPolicy(policyValue: MemberAccessPolicy | unknown): string {
  const policy = normalizePolicyOrFull(policyValue)
  if (isFullWorkspaceAccessPolicy(policy)) {
    return 'Full workspace access'
  }

  const enabled = WORKSPACE_MODULE_KEYS
    .filter((key) => policy.modules[key])
    .map((key) => MODULE_LABELS[key])

  const moduleText = enabled.length > 0 ? enabled.join(', ') : 'No modules'
  const scoped: string[] = []
  for (const key of RECORD_SCOPED_MODULE_KEYS) {
    if (policy.modules[key] && policy.recordScopes[key] === 'owned_or_linked') {
      scoped.push(MODULE_LABELS[key])
    }
  }
  const issuerBits: string[] = []
  if (policy.capabilities.invoices) issuerBits.push('invoices')
  if (policy.capabilities.quotes) issuerBits.push('quotes')
  const issuerText = issuerBits.length > 0
    ? `Issuer: ${issuerBits.join('+')} (owned/linked clients)`
    : ''
  const base = scoped.length > 0 ? `${moduleText} - owned or linked records` : moduleText
  return issuerText ? `${base}; ${issuerText}` : base
}

export function policyFromAccessScope(accessScope?: unknown, role: RoleWithSystem = 'member'): MemberAccessPolicy {
  return defaultAccessPolicyFor(role, accessScope)
}

function normalizePolicyOrFull(value: MemberAccessPolicy | unknown): MemberAccessPolicy {
  if (!value || typeof value !== 'object') return normalizeMemberAccessPolicy(null)
  return normalizeMemberAccessPolicy(value)
}
