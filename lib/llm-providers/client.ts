import type { LlmProviderConnectionMasked, LlmOauthSessionPublic } from './types'
import type { LlmProviderDefinition } from './providers'

async function unwrap<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({})) as { error?: string; data?: T }
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return (body.data ?? body) as T
}

export type LlmProviderCatalogResponse = {
  providers: LlmProviderDefinition[]
  connections: LlmProviderConnectionMasked[]
  bindings: Array<{
    id: string
    connectionId: string
    credentialVersion: number
    runtimeTargetId: string
    deviceId: string | null
    machineLabel: string
    agentId: string
    status: string
    liveAuthVerified: boolean
    lastError: string | null
    lastVerifiedAt: unknown
  }>
  canManageOrgConnections: boolean
  syncTargets?: {
    orgVpsDeviceCount: number
    hasHermesProfileLink: boolean
    targetCount: number
    reasonIfEmpty?: string
  }
  notes: {
    cursor: string
    orgScope?: string
    userScope?: string
    hermesNative?: string
  }
}

export async function listLlmProviderCatalog(orgId: string): Promise<LlmProviderCatalogResponse> {
  const res = await fetch(`/api/v1/llm-providers/connections?orgId=${encodeURIComponent(orgId)}`)
  return unwrap(res)
}

export async function connectLlmApiKey(input: {
  orgId: string
  provider: string
  scope: 'org' | 'user'
  label?: string
  credentials: Record<string, string>
}): Promise<{ connection: LlmProviderConnectionMasked; sync?: unknown }> {
  const { orgId, ...body } = input
  const res = await fetch(`/api/v1/llm-providers/connections?orgId=${encodeURIComponent(orgId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return unwrap(res)
}

export async function startLlmOauth(input: {
  orgId: string
  provider: string
  scope: 'org' | 'user'
  label?: string
}): Promise<{ session: LlmOauthSessionPublic }> {
  const { orgId, ...body } = input
  const res = await fetch(`/api/v1/llm-providers/oauth/start?orgId=${encodeURIComponent(orgId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return unwrap(res)
}

export async function pollLlmOauth(
  orgId: string,
  sessionId: string,
): Promise<{
  session: LlmOauthSessionPublic
  pending?: boolean
  connection?: LlmProviderConnectionMasked
  sync?: unknown
}> {
  const res = await fetch(
    `/api/v1/llm-providers/oauth/${encodeURIComponent(sessionId)}?orgId=${encodeURIComponent(orgId)}`,
  )
  return unwrap(res)
}

export async function exchangeLlmOauth(
  orgId: string,
  sessionId: string,
  code: string,
  state?: string,
): Promise<{
  session: LlmOauthSessionPublic
  connection?: LlmProviderConnectionMasked
  sync?: unknown
}> {
  const res = await fetch(
    `/api/v1/llm-providers/oauth/${encodeURIComponent(sessionId)}/exchange?orgId=${encodeURIComponent(orgId)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, ...(state ? { state } : {}) }),
    },
  )
  return unwrap(res)
}

export async function revokeLlmConnection(orgId: string, id: string): Promise<void> {
  const res = await fetch(
    `/api/v1/llm-providers/connections/${encodeURIComponent(id)}?orgId=${encodeURIComponent(orgId)}`,
    { method: 'DELETE' },
  )
  await unwrap(res)
}

export async function updateLlmShareTargets(
  orgId: string,
  id: string,
  shareTargets: import('./types').LlmShareTargets,
): Promise<{ connection: LlmProviderConnectionMasked }> {
  const res = await fetch(
    `/api/v1/llm-providers/connections/${encodeURIComponent(id)}?orgId=${encodeURIComponent(orgId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shareTargets }),
    },
  )
  return unwrap(res)
}

export async function resyncLlmConnection(orgId: string, id: string): Promise<unknown> {
  const res = await fetch(
    `/api/v1/llm-providers/connections/${encodeURIComponent(id)}?orgId=${encodeURIComponent(orgId)}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
  )
  return unwrap(res)
}
