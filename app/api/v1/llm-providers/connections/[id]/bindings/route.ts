import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { clientCanAccessOrg, canWriteOrgLlmConnection } from '@/lib/llm-providers/org-guard'
import { getLlmProviderConnection } from '@/lib/llm-providers/store'
import { listConnectionLlmCredentialBindings } from '@/lib/llm-providers/bindings'
import { listOwnedDevices } from '@/lib/linked-computers/store'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

function resolveOrgId(req: NextRequest, user: ApiUser): string | null {
  const url = new URL(req.url)
  return url.searchParams.get('orgId') ?? req.headers.get('x-org-id') ?? user.orgId ?? user.orgIds?.[0] ?? null
}

export const GET = withAuth('client', async (req: NextRequest, user: ApiUser, ctx) => {
  const { id } = await (ctx as Ctx).params
  const orgId = resolveOrgId(req, user)
  if (!orgId) return apiError('orgId is required', 400)
  if (!clientCanAccessOrg(user, orgId)) return apiError('Forbidden', 403)

  const connection = await getLlmProviderConnection(id)
  if (!connection || connection.orgId !== orgId) return apiError('Connection not found', 404)
  if (connection.scope === 'user' && connection.ownerUid !== user.uid) return apiError('Forbidden', 403)

  const [bindings, isAdmin] = await Promise.all([
    listConnectionLlmCredentialBindings(id),
    canWriteOrgLlmConnection(user, orgId),
  ])

  let visible = bindings
  if (!isAdmin) {
    const owned = await listOwnedDevices(user.uid)
    const ownedIds = new Set(owned.map((device) => device.deviceId))
    visible = bindings.filter((binding) => binding.deviceId && ownedIds.has(binding.deviceId))
  }

  return apiSuccess({
    bindings: visible.map((binding) => ({
      deviceId: binding.deviceId ?? null,
      machineLabel: binding.machineLabel ?? null,
      agentId: binding.agentId,
      status: binding.status,
    })),
  })
})
