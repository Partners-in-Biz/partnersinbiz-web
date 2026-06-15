export const ORGANIZATION_MODULE_POLICY_KEYS = [
  'projects',
  'documents',
  'research',
  'mobileApps',
  'youtubeStudio',
  'bookStudio',
  'marketing',
  'messages',
] as const

export const ORGANIZATION_POLICY_ROLE_KEYS = ['owner', 'admin', 'member'] as const

export type OrganizationModulePolicyKey = (typeof ORGANIZATION_MODULE_POLICY_KEYS)[number]
export type OrganizationPolicyRole = (typeof ORGANIZATION_POLICY_ROLE_KEYS)[number]
export type OrganizationRoleSelection = Record<OrganizationPolicyRole, boolean>

export interface OrganizationPolicyItem {
  id: string
  label: string
  description: string
}

export interface OrganizationModulePolicy {
  actions: Record<string, OrganizationRoleSelection>
  customItems: OrganizationPolicyItem[]
  ownerControls: Record<string, boolean>
}

export type OrganizationModulePolicies = Record<OrganizationModulePolicyKey, OrganizationModulePolicy>

type RawPolicy = Partial<OrganizationModulePolicy> & Record<string, unknown>
type RawPolicies = Partial<Record<OrganizationModulePolicyKey, RawPolicy>>

const ALL_ROLES: OrganizationRoleSelection = { owner: true, admin: true, member: true }

const DEFAULT_ACTIONS: Record<OrganizationModulePolicyKey, string[]> = {
  projects: ['visibility', 'create', 'archiveDelete'],
  documents: ['visibility', 'create', 'edit', 'reviewApproval', 'shareLinks', 'archiveDelete'],
  research: ['visibility', 'create', 'edit', 'evidenceSources', 'convertToDocuments', 'clientVisible', 'archiveDelete'],
  mobileApps: ['visibility', 'create', 'edit', 'storeLinks', 'analytics', 'portalExposure', 'archiveDelete'],
  youtubeStudio: ['visibility', 'create', 'edit', 'sourceAssets', 'productionJobs', 'publishApprovals', 'portalExposure', 'archiveDelete'],
  bookStudio: ['visibility', 'create', 'edit', 'evidenceRights', 'approvalGates', 'publishingPackets', 'archiveDelete'],
  marketing: ['visibility', 'create', 'approvePublish', 'budget', 'integrations'],
  messages: ['visibility', 'start', 'reply', 'agentHandoff', 'templates', 'archive'],
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function cloneRoles(value: OrganizationRoleSelection = ALL_ROLES): OrganizationRoleSelection {
  return { owner: value.owner, admin: value.admin, member: value.member }
}

function normalizeRoleSelection(value: unknown, fallback: OrganizationRoleSelection = ALL_ROLES): OrganizationRoleSelection {
  if (!isRecord(value)) return cloneRoles(fallback)
  return {
    owner: typeof value.owner === 'boolean' ? value.owner : fallback.owner,
    admin: typeof value.admin === 'boolean' ? value.admin : fallback.admin,
    member: typeof value.member === 'boolean' ? value.member : fallback.member,
  }
}

function normalizePolicyItems(value: unknown): OrganizationPolicyItem[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (!isRecord(item)) return null
      const id = typeof item.id === 'string' ? item.id.trim() : ''
      const label = typeof item.label === 'string' ? item.label.trim() : ''
      const description = typeof item.description === 'string' ? item.description.trim() : ''
      if (!id || !label) return null
      return { id, label, description }
    })
    .filter((item): item is OrganizationPolicyItem => Boolean(item))
}

function normalizeOwnerControls(value: unknown): Record<string, boolean> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, flag]) => key.trim() && typeof flag === 'boolean'),
  ) as Record<string, boolean>
}

function defaultPolicyFor(moduleKey: OrganizationModulePolicyKey): OrganizationModulePolicy {
  return {
    actions: Object.fromEntries(DEFAULT_ACTIONS[moduleKey].map((action) => [action, cloneRoles()])) as Record<string, OrganizationRoleSelection>,
    customItems: [],
    ownerControls: {},
  }
}

function rawModulePolicies(settings: unknown): RawPolicies {
  if (!isRecord(settings) || !isRecord(settings.modulePolicies)) return {}
  const policies: RawPolicies = {}
  for (const key of ORGANIZATION_MODULE_POLICY_KEYS) {
    const value = settings.modulePolicies[key]
    if (isRecord(value)) policies[key] = value as RawPolicy
  }
  return policies
}

export function resolveOrganizationModulePolicies(settings: unknown): OrganizationModulePolicies {
  const raw = rawModulePolicies(settings)
  const resolved = {} as OrganizationModulePolicies

  for (const moduleKey of ORGANIZATION_MODULE_POLICY_KEYS) {
    const defaults = defaultPolicyFor(moduleKey)
    const incoming = raw[moduleKey]
    const incomingActions = isRecord(incoming?.actions) ? incoming.actions : {}
    const actions = { ...defaults.actions }

    for (const [action, selection] of Object.entries(incomingActions)) {
      actions[action] = normalizeRoleSelection(selection, actions[action] ?? ALL_ROLES)
    }

    resolved[moduleKey] = {
      actions,
      customItems: normalizePolicyItems(incoming?.customItems),
      ownerControls: normalizeOwnerControls(incoming?.ownerControls),
    }
  }

  return resolved
}

export function normalizeOrganizationPolicyRole(role: unknown): OrganizationPolicyRole {
  return role === 'owner' || role === 'admin' || role === 'member' ? role : 'member'
}

export function isOrganizationModulePolicyKey(value: unknown): value is OrganizationModulePolicyKey {
  return typeof value === 'string' && ORGANIZATION_MODULE_POLICY_KEYS.includes(value as OrganizationModulePolicyKey)
}

export function canRoleUseModule(
  policies: OrganizationModulePolicies | unknown,
  moduleKey: OrganizationModulePolicyKey,
  role: unknown,
): boolean {
  return canRolePerformModuleAction(policies, moduleKey, 'visibility', role)
}

export function canRolePerformModuleAction(
  policies: OrganizationModulePolicies | unknown,
  moduleKey: OrganizationModulePolicyKey,
  actionId: string,
  role: unknown,
): boolean {
  const resolved = isRecord(policies) && isRecord((policies as Record<string, unknown>)[moduleKey])
    ? policies as OrganizationModulePolicies
    : resolveOrganizationModulePolicies({ modulePolicies: policies })
  const normalizedRole = normalizeOrganizationPolicyRole(role)
  return resolved[moduleKey]?.actions[actionId]?.[normalizedRole] === true
}

export function mergeOrganizationModulePolicySettings(existingValue: unknown, incomingValue: unknown): RawPolicies {
  const existing = rawModulePolicies({ modulePolicies: existingValue })
  const incoming = rawModulePolicies({ modulePolicies: incomingValue })
  const merged: RawPolicies = { ...existing }

  for (const moduleKey of ORGANIZATION_MODULE_POLICY_KEYS) {
    const current = isRecord(merged[moduleKey]) ? merged[moduleKey] as RawPolicy : undefined
    const next = isRecord(incoming[moduleKey]) ? incoming[moduleKey] as RawPolicy : undefined
    if (!next) continue

    const hasOwnerControls = isRecord(current?.ownerControls) || isRecord(next.ownerControls)

    merged[moduleKey] = {
      ...(current ?? {}),
      ...next,
      actions: {
        ...(isRecord(current?.actions) ? current.actions : {}),
        ...(isRecord(next.actions) ? next.actions : {}),
      },
      customItems: Array.isArray(next.customItems) ? next.customItems : current?.customItems,
    }

    if (hasOwnerControls) {
      merged[moduleKey].ownerControls = {
        ...(isRecord(current?.ownerControls) ? current.ownerControls : {}),
        ...(isRecord(next.ownerControls) ? next.ownerControls : {}),
      }
    }
  }

  return merged
}
