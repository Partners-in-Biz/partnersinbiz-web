import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { getCreativeCanvasProvider } from '@/lib/creative-canvas/providers'
import { listCreativeProviderConnections, upsertCreativeProviderConnection } from '@/lib/creative-canvas/connections/store'
import { validateProviderCredentials } from '@/lib/creative-canvas/connections/validate'
import type { CreativeCanvasActor } from '@/lib/creative-canvas/types'

export const dynamic = 'force-dynamic'

function resolveOrgId(req: NextRequest, user: ApiUser): string | null {
  const url = new URL(req.url)
  return url.searchParams.get('orgId') ?? req.headers.get('x-org-id') ?? user.orgId ?? user.orgIds?.[0] ?? null
}

function actorFromUser(user: ApiUser): CreativeCanvasActor {
  return {
    uid: user.role === 'ai' && user.agentId ? `agent:${user.agentId}` : user.uid,
    type: user.role === 'ai' ? 'agent' : 'user',
  }
}

export const GET = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const orgId = resolveOrgId(req, user)
  if (!orgId) return apiError('orgId is required', 400)
  const connections = await listCreativeProviderConnections({ orgId, uid: user.uid })
  return apiSuccess({ connections })
})

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const orgId = resolveOrgId(req, user)
  if (!orgId) return apiError('orgId is required', 400)
  const body = await req.json().catch(() => null)
  if (!body) return apiError('Malformed JSON body', 400)

  const { provider, scope, label, credentials, meta } = body as {
    provider?: string
    scope?: string
    label?: string
    credentials?: Record<string, string>
    meta?: Record<string, unknown>
  }

  const providerDef = provider ? getCreativeCanvasProvider(provider) : null
  if (!providerDef?.connection) return apiError('Provider does not support connections', 400)
  if (scope !== 'org' && scope !== 'user') return apiError('scope must be "org" or "user"', 400)
  if (!credentials || typeof credentials !== 'object') return apiError('credentials are required', 400)

  // Only accept the fields the provider declares — nothing else gets encrypted.
  const allowed = new Set(providerDef.connection.credentialFields.map((f) => f.key))
  const cleaned: Record<string, string> = {}
  for (const [key, value] of Object.entries(credentials)) {
    if (allowed.has(key) && typeof value === 'string' && value.trim()) cleaned[key] = value.trim()
  }
  for (const field of providerDef.connection.credentialFields) {
    if (!cleaned[field.key]) return apiError(`${field.label} is required`, 400)
  }

  const validation = await validateProviderCredentials(providerDef.key, cleaned)
  if (!validation.ok) return apiError(validation.error ?? 'Credential validation failed', 400)

  const connection = await upsertCreativeProviderConnection({
    provider: providerDef.key,
    scope,
    orgId,
    ownerUid: scope === 'user' ? user.uid : null,
    label: typeof label === 'string' && label.trim() ? label : providerDef.label,
    credentials: cleaned,
    meta,
  }, actorFromUser(user))

  return apiSuccess({ connection }, 201)
})
