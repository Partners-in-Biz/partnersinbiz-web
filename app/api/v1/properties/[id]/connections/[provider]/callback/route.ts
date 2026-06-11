// GET /api/v1/properties/:id/connections/:provider/callback
// OAuth2 redirect target. Validates state, exchanges code for tokens via the
// adapter, persists the connection, then redirects back to the admin UI.

import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { getAdapter } from '@/lib/integrations/registry'
import '@/lib/integrations/bootstrap'
import { ALL_PROVIDERS, type IntegrationProvider } from '@/lib/integrations/types'

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

function adminConnectionsUrl(req: NextRequest, propertyId: string, provider: string, ok: boolean, msg?: string) {
  const url = new URL(`/portal/properties/${propertyId}/connections`, appBaseUrl(req))
  url.searchParams.set('provider', provider)
  url.searchParams.set('result', ok ? 'ok' : 'error')
  if (msg) url.searchParams.set('msg', msg.slice(0, 200))
  return url
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id, provider } = await ctx.params
  if (!isProvider(provider)) {
    return NextResponse.json({ error: 'Unknown provider' }, { status: 400 })
  }
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  if (error) {
    return NextResponse.redirect(adminConnectionsUrl(req, id, provider, false, error))
  }
  if (!code || !state) {
    return NextResponse.redirect(
      adminConnectionsUrl(req, id, provider, false, 'missing code or state'),
    )
  }

  const stateRef = adminDb.collection('oauth_state').doc(state)
  const stateDoc = await stateRef.get()
  if (!stateDoc.exists) {
    return NextResponse.redirect(
      adminConnectionsUrl(req, id, provider, false, 'invalid state'),
    )
  }
  const stateData = stateDoc.data() as {
    propertyId: string
    orgId: string
    provider: string
    expiresAt: { toDate(): Date }
  }
  await stateRef.delete()
  if (stateData.expiresAt.toDate() < new Date()) {
    return NextResponse.redirect(
      adminConnectionsUrl(req, id, provider, false, 'state expired'),
    )
  }
  if (stateData.propertyId !== id || stateData.provider !== provider) {
    return NextResponse.redirect(
      adminConnectionsUrl(req, id, provider, false, 'state mismatch'),
    )
  }

  const adapter = getAdapter(provider)
  if (!adapter || !adapter.completeOAuth) {
    return NextResponse.redirect(
      adminConnectionsUrl(req, id, provider, false, 'adapter not configured'),
    )
  }

  try {
    const redirectUri = `${appBaseUrl(req)}/api/v1/properties/${id}/connections/${provider}/callback`
    await adapter.completeOAuth({
      propertyId: id,
      orgId: stateData.orgId,
      code,
      redirectUri,
    })
    return NextResponse.redirect(adminConnectionsUrl(req, id, provider, true))
  } catch (err) {
    return NextResponse.redirect(
      adminConnectionsUrl(req, id, provider, false, err instanceof Error ? err.message : 'oauth failed'),
    )
  }
}
