// POST /api/v1/properties/:id/connections/:provider/pull
// Manual one-shot pull for an integration. Useful for backfill, debugging,
// and the admin "Refresh now" button.

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { dispatchOne } from '@/lib/integrations/dispatch'
import { getConnection } from '@/lib/integrations/connections'
import '@/lib/integrations/bootstrap'
import { ALL_PROVIDERS, type IntegrationProvider } from '@/lib/integrations/types'
import { loadOwnerAuthorizedProperty } from '@/lib/properties/access'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

type RouteContext = { params: Promise<{ id: string; provider: string }> }

function isProvider(v: string): v is IntegrationProvider {
  return (ALL_PROVIDERS as string[]).includes(v)
}

export const POST = withAuth('admin', async (_req: NextRequest, user, ctx) => {
  const { id, provider } = await (ctx as RouteContext).params
  if (!isProvider(provider)) {
    return NextResponse.json({ error: 'Unknown provider' }, { status: 400 })
  }
  const access = await loadOwnerAuthorizedProperty(user, id)
  if (!access.ok) return access.response
  const propertyId = access.property.id
  const conn = await getConnection({ propertyId, provider })
  if (!conn) return NextResponse.json({ error: 'Not connected' }, { status: 404 })
  const summary = await dispatchOne(conn)
  return NextResponse.json({ ...summary, ok: true })
})
