import type { ApiUser } from '@/lib/api/types'
import { isSuperAdmin } from '@/lib/api/platformAdmin'
import type {
  HermesAccessResult,
  HermesCapabilities,
  HermesCapability,
  HermesProfileLink,
  HermesProfilePermissions,
} from './types'

export const DEFAULT_HERMES_CAPABILITIES: HermesCapabilities = {
  runs: true,
  dashboard: true,
  cron: true,
  models: true,
  tools: true,
  files: true,
  terminal: true,
}

export const DEFAULT_HERMES_PERMISSIONS: HermesProfilePermissions = {
  superAdmin: true,
  restrictedAdmin: true,
  client: false,
  allowedUserIds: [],
}

export function sanitizeHermesCapabilities(input: unknown): HermesCapabilities {
  const raw = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  return {
    runs: raw.runs === false ? false : true,
    dashboard: raw.dashboard === false ? false : true,
    cron: raw.cron === false ? false : true,
    models: raw.models === false ? false : true,
    tools: raw.tools === false ? false : true,
    files: raw.files === false ? false : true,
    terminal: raw.terminal === false ? false : true,
  }
}

export function sanitizeHermesPermissions(input: unknown): HermesProfilePermissions {
  const raw = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  return {
    superAdmin: raw.superAdmin === false ? false : true,
    restrictedAdmin: raw.restrictedAdmin === false ? false : true,
    client: raw.client === true,
    allowedUserIds: Array.isArray(raw.allowedUserIds)
      ? raw.allowedUserIds
          .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
          .map((v) => v.trim())
          .filter((v, i, arr) => arr.indexOf(v) === i)
      : [],
  }
}

export function normalizeHermesProfileLink(orgId: string, data: Record<string, unknown>): HermesProfileLink {
  return {
    orgId,
    profile: typeof data.profile === 'string' ? data.profile.trim() : '',
    baseUrl: typeof data.baseUrl === 'string' ? data.baseUrl.trim().replace(/\/+$/, '') : '',
    apiKey: typeof data.apiKey === 'string' ? data.apiKey : undefined,
    dashboardBaseUrl: typeof data.dashboardBaseUrl === 'string' && data.dashboardBaseUrl.trim()
      ? data.dashboardBaseUrl.trim().replace(/\/+$/, '')
      : undefined,
    dashboardSessionToken: typeof data.dashboardSessionToken === 'string' ? data.dashboardSessionToken : undefined,
    enabled: data.enabled === false ? false : true,
    capabilities: sanitizeHermesCapabilities(data.capabilities),
    permissions: sanitizeHermesPermissions(data.permissions),
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    createdBy: typeof data.createdBy === 'string' ? data.createdBy : undefined,
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : undefined,
  }
}

export function canAccessHermesProfile(
  user: ApiUser,
  link: HermesProfileLink | null | undefined,
  capability: HermesCapability,
): HermesAccessResult {
  if (!link) return { allowed: false, status: 404, error: 'Hermes profile link not found' }
  if (!link.enabled) return { allowed: false, status: 409, error: 'Hermes profile link is disabled' }
  if (!link.capabilities[capability]) {
    return { allowed: false, status: 403, error: `Hermes ${capability} capability is disabled for this profile` }
  }

  if (user.role === 'ai') {
    return { allowed: false, status: 403, error: 'AI credentials cannot access legacy Hermes profile routes' }
  }

  const explicitUser = link.permissions.allowedUserIds.includes(user.uid)
  if (explicitUser) return { allowed: true }

  if (isSuperAdmin(user)) {
    return link.permissions.superAdmin
      ? { allowed: true }
      : { allowed: false, status: 403, error: 'Super-admin Hermes access is disabled for this profile' }
  }

  if (user.role === 'admin') {
    const allowedOrgIds = Array.isArray(user.allowedOrgIds) ? user.allowedOrgIds : []
    const orgAllowed = user.orgId === link.orgId || allowedOrgIds.includes(link.orgId)
    if (!orgAllowed) return { allowed: false, status: 403, error: 'Admin is not assigned to this organisation' }
    return link.permissions.restrictedAdmin
      ? { allowed: true }
      : { allowed: false, status: 403, error: 'Restricted-admin Hermes access is disabled for this profile' }
  }

  if (user.role === 'client') {
    if (user.orgId !== link.orgId) return { allowed: false, status: 403, error: 'Client is not assigned to this organisation' }
    return link.permissions.client
      ? { allowed: true }
      : { allowed: false, status: 403, error: 'Client Hermes access is disabled for this profile' }
  }

  return { allowed: false, status: 403, error: 'Forbidden' }
}
