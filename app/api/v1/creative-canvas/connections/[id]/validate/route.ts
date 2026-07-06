import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { getCreativeProviderConnection, canManageConnection, markConnectionValidation } from '@/lib/creative-canvas/connections/store'
import { decryptConnectionCredentials } from '@/lib/creative-canvas/connections/crypto'
import { validateProviderCredentials } from '@/lib/creative-canvas/connections/validate'
import { maskConnection } from '@/lib/creative-canvas/connections/types'
import { clientCanAccessOrg } from '@/lib/creative-canvas/connections/org-guard'

export const dynamic = 'force-dynamic'
type RouteContext = { params: Promise<{ id: string }> }

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser, context?: unknown) => {
  const { id } = await (context as RouteContext).params
  const url = new URL(req.url)
  const orgId = url.searchParams.get('orgId') ?? req.headers.get('x-org-id') ?? user.orgId ?? user.orgIds?.[0]
  if (!orgId) return apiError('orgId is required', 400)
  if (!clientCanAccessOrg(user, orgId)) return apiError('Forbidden', 403)
  const connection = await getCreativeProviderConnection(decodeURIComponent(id))
  if (!connection) return apiError('Connection not found', 404)
  if (!canManageConnection(connection, { orgId, uid: user.uid })) return apiError('Forbidden', 403)
  if (!connection.credentialsEnc) return apiError('Connection has no stored credentials', 400)
  let result: { ok: boolean; error?: string }
  try {
    const credentials = decryptConnectionCredentials(connection.credentialsEnc, connection.scopeKeyRef)
    result = await validateProviderCredentials(connection.provider, credentials)
  } catch {
    result = { ok: false, error: 'Stored credentials could not be decrypted — reconnect the provider' }
  }
  await markConnectionValidation(connection.id, result)
  const updated = await getCreativeProviderConnection(connection.id)
  return apiSuccess({ connection: maskConnection(updated!), validation: result })
})
