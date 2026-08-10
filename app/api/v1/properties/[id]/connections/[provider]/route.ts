// /api/v1/properties/:id/connections/:provider
//
//   GET    — fetch a single connection (sans ciphertext)
//   PUT    — upsert via API-key / service-account / JWT payload (non-OAuth)
//   PATCH  — change status (pause/unpause)
//   DELETE — disconnect (calls adapter.revoke if defined)

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import {
  getConnection,
  setConnectionStatus,
  deleteConnection,
} from '@/lib/integrations/connections'
import { getAdapter } from '@/lib/integrations/registry'
import '@/lib/integrations/bootstrap'
import type { IntegrationProvider } from '@/lib/integrations/types'
import { ALL_PROVIDERS } from '@/lib/integrations/types'
import { loadOwnerAuthorizedProperty } from '@/lib/properties/access'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string; provider: string }> }

function isProvider(v: string): v is IntegrationProvider {
  return (ALL_PROVIDERS as string[]).includes(v)
}

export const GET = withAuth('admin', async (_req: NextRequest, user, ctx) => {
  const { id, provider } = await (ctx as RouteContext).params
  if (!isProvider(provider)) {
    return NextResponse.json({ error: 'Unknown provider' }, { status: 400 })
  }
  const access = await loadOwnerAuthorizedProperty(user, id)
  if (!access.ok) return access.response
  const propertyId = access.property.id
  const conn = await getConnection({ propertyId, provider })
  if (!conn) return NextResponse.json({ error: 'Not connected' }, { status: 404 })
  const { credentialsEnc, ...rest } = conn
  return NextResponse.json({
    ok: true,
    connection: { ...rest, hasCredentials: Boolean(credentialsEnc) },
  })
})

interface PutBody {
  payload: Record<string, unknown>
  meta?: Record<string, unknown>
}

export const PUT = withAuth('admin', async (req: NextRequest, user, ctx) => {
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
  if (!adapter.saveCredentials) {
    return NextResponse.json(
      { error: `${provider} uses OAuth — use /authorize endpoint instead` },
      { status: 400 },
    )
  }
  const body = (await req.json().catch(() => ({}))) as PutBody
  if (!body.payload) {
    return NextResponse.json({ error: 'payload required' }, { status: 400 })
  }
  try {
    const conn = await adapter.saveCredentials({
      propertyId,
      orgId: access.property.orgId,
      payload: body.payload,
    })
    const { credentialsEnc, ...rest } = conn
    return NextResponse.json({
      ok: true,
      connection: { ...rest, hasCredentials: Boolean(credentialsEnc) },
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'save failed' },
      { status: 400 },
    )
  }
})

interface PatchBody {
  status?: 'connected' | 'paused' | 'reauth_required' | 'error'
}

export const PATCH = withAuth('admin', async (req: NextRequest, user, ctx) => {
  const { id, provider } = await (ctx as RouteContext).params
  if (!isProvider(provider)) {
    return NextResponse.json({ error: 'Unknown provider' }, { status: 400 })
  }
  const access = await loadOwnerAuthorizedProperty(user, id)
  if (!access.ok) return access.response
  const propertyId = access.property.id
  const body = (await req.json().catch(() => ({}))) as PatchBody
  if (!body.status) {
    return NextResponse.json({ error: 'status required' }, { status: 400 })
  }
  await setConnectionStatus({ propertyId, provider, status: body.status })
  return NextResponse.json({ ok: true })
})

export const DELETE = withAuth('admin', async (_req: NextRequest, user, ctx) => {
  const { id, provider } = await (ctx as RouteContext).params
  if (!isProvider(provider)) {
    return NextResponse.json({ error: 'Unknown provider' }, { status: 400 })
  }
  const access = await loadOwnerAuthorizedProperty(user, id)
  if (!access.ok) return access.response
  const propertyId = access.property.id
  const conn = await getConnection({ propertyId, provider })
  if (conn) {
    const adapter = getAdapter(provider)
    if (adapter?.revoke) {
      try { await adapter.revoke({ connection: conn }) } catch (err) {
        console.error('[connections.revoke]', err)
      }
    }
  }
  await deleteConnection({ propertyId, provider })
  return NextResponse.json({ ok: true })
})
