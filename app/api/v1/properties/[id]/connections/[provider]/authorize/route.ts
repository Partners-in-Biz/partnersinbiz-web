// GET /api/v1/properties/:id/connections/:provider/authorize
// Begin an OAuth2 authorize flow. Returns { authorizeUrl } the UI redirects to.

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { adminDb } from '@/lib/firebase/admin'
import { getAdapter } from '@/lib/integrations/registry'
import '@/lib/integrations/bootstrap'
import { ALL_PROVIDERS, type IntegrationProvider } from '@/lib/integrations/types'
import crypto from 'crypto'
import { loadOwnerAuthorizedProperty } from '@/lib/properties/access'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string; provider: string }> }

function isProvider(v: string): v is IntegrationProvider {
  return (ALL_PROVIDERS as string[]).includes(v)
}

function appBaseUrl(req: NextRequest): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.PUBLIC_BASE_URL ||
    new URL(req.url).origin
  )
}

export const GET = withAuth('admin', async (req: NextRequest, user, ctx) => {
  const { id, provider } = await (ctx as RouteContext).params
  if (!isProvider(provider)) {
    return NextResponse.json({ error: 'Unknown provider' }, { status: 400 })
  }
  const access = await loadOwnerAuthorizedProperty(user, id)
  if (!access.ok) return access.response
  const propertyId = access.property.id
  const adapter = getAdapter(provider)
  if (!adapter) {
    return NextResponse.json({ error: 'Adapter not registered' }, { status: 501 })
  }
  if (!adapter.beginOAuth) {
    return NextResponse.json(
      { error: `${provider} does not use OAuth` },
      { status: 400 },
    )
  }
  const orgId = access.property.orgId

  const state = crypto.randomBytes(24).toString('hex')
  const redirectUri = `${appBaseUrl(req)}/api/v1/properties/${propertyId}/connections/${provider}/callback`

  // Persist state for CSRF check on callback. TTL 10 minutes is enough.
  await adminDb.collection('oauth_state').doc(state).set({
    state,
    propertyId,
    orgId,
    provider,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  })

  const { authorizeUrl } = await adapter.beginOAuth({
    propertyId,
    orgId,
    redirectUri,
    state,
  })
  return NextResponse.json({ ok: true, authorizeUrl })
})
