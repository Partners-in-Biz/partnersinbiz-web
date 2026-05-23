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
  // All orgs this client belongs to. Falls back to [orgId] for existing users.
  orgIds?: string[]
  // Platform-admin org restriction. Only meaningful when role === 'admin'.
  // Empty/undefined = super admin (no restriction). Non-empty = restricted to
  // these org ids (plus their home orgId).
  allowedOrgIds?: string[]
}

export interface ApiMeta {
  total: number
  page: number
  limit: number
}

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  meta?: ApiMeta
}
