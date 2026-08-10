// GET /api/v1/properties/:id/connections — list all integration connections.

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { listConnectionsForProperty } from '@/lib/integrations/connections'
import { loadOwnerAuthorizedProperty } from '@/lib/properties/access'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const GET = withAuth('admin', async (_req: NextRequest, user, ctx) => {
  const { id } = await (ctx as RouteContext).params
  const access = await loadOwnerAuthorizedProperty(user, id)
  if (!access.ok) return access.response
  const propertyId = access.property.id
  const connections = await listConnectionsForProperty(propertyId)
  // Strip ciphertext from response — not needed by UI, leaks nothing if logged.
  const sanitized = connections.map(({ credentialsEnc: _e, ...rest }) => ({
    ...rest,
    hasCredentials: Boolean(_e),
  }))
  return NextResponse.json({ ok: true, connections: sanitized })
})
