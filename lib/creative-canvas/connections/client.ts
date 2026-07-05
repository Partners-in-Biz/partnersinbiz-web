// Browser-safe fetch wrappers for the connections API. All /api/v1 responses
// use the apiSuccess envelope — unwrap body.data ?? body.
import type { CreativeProviderConnectionMasked } from './types'

async function unwrap<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body?.error ?? `Request failed (${response.status})`)
  return (body.data ?? body) as T
}

export async function listConnections(orgId: string): Promise<CreativeProviderConnectionMasked[]> {
  const res = await fetch(`/api/v1/creative-canvas/connections?orgId=${encodeURIComponent(orgId)}`)
  return (await unwrap<{ connections: CreativeProviderConnectionMasked[] }>(res)).connections
}

export async function createConnection(input: {
  orgId: string
  provider: string
  scope: 'org' | 'user'
  label: string
  credentials: Record<string, string>
}): Promise<CreativeProviderConnectionMasked> {
  const { orgId, ...body } = input
  const res = await fetch(`/api/v1/creative-canvas/connections?orgId=${encodeURIComponent(orgId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return (await unwrap<{ connection: CreativeProviderConnectionMasked }>(res)).connection
}

export async function revokeConnection(orgId: string, id: string): Promise<CreativeProviderConnectionMasked> {
  const res = await fetch(`/api/v1/creative-canvas/connections/${encodeURIComponent(id)}?orgId=${encodeURIComponent(orgId)}`, { method: 'DELETE' })
  return (await unwrap<{ connection: CreativeProviderConnectionMasked }>(res)).connection
}

export async function validateConnection(orgId: string, id: string): Promise<{ connection: CreativeProviderConnectionMasked; validation: { ok: boolean; error?: string } }> {
  const res = await fetch(`/api/v1/creative-canvas/connections/${encodeURIComponent(id)}/validate?orgId=${encodeURIComponent(orgId)}`, { method: 'POST' })
  return unwrap(res)
}
