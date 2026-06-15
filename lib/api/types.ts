import type { MemberAccessPolicy } from '@/lib/orgMembers/access-policy'

export type ApiRole = 'admin' | 'client' | 'ai'
export type ApiAuthKind = 'session' | 'firebase' | 'legacy_ai_key' | 'agent_api_key'

export interface ApiPermission {
  resource: string
  actions: string[]
}

export interface ApiUser {
  uid: string
  role: ApiRole
  authKind?: ApiAuthKind
  agentId?: string
  apiKeyId?: string
  permissions?: ApiPermission[]
  orgId?: string
  // The organisation currently selected in the portal switcher. This is the
  // default tenant scope for client portal reads/writes when no explicit
  // orgId query/header is supplied.
  activeOrgId?: string
  // All orgs this client belongs to. Falls back to [orgId] for existing users.
  orgIds?: string[]
  // Platform-admin org restriction. Only meaningful when role === 'admin'.
  // Empty/undefined = super admin (no restriction). Non-empty = restricted to
  // these org ids (plus their home orgId).
  allowedOrgIds?: string[]
  memberAccessPolicy?: MemberAccessPolicy
}

export interface ApiMeta {
  total: number
  page: number
  limit: number
  orgId?: string
}

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  meta?: ApiMeta
}
