// app/api/v1/contacts/[id]/preferences/route.ts
//
// GET / PUT a contact's email preferences (topics + frequency). Admin-side
// only — the public preferences page lives at `app/preferences/[token]` and
// is signed-token authenticated.
//
// Role matrix: GET → viewer, PUT → member

import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import { getContactPreferences, setContactPreferences } from '@/lib/preferences/store'
import { FREQUENCY_CHOICES } from '@/lib/preferences/types'
import type { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

type RouteCtx = { params: Promise<{ id: string }> }

async function loadContact(id: string, ctxOrgId: string) {
  const ref = adminDb.collection('contacts').doc(id)
  const snap = await ref.get()
  if (!snap.exists) return { ok: false as const, status: 404, error: 'Contact not found' }
  const data = snap.data()!
  if (data.orgId !== ctxOrgId) return { ok: false as const, status: 404, error: 'Contact not found' }
  if (data.deleted === true) return { ok: false as const, status: 404, error: 'Contact not found' }
  return { ok: true as const, ref, data }
}

const getPreferences = withCrmAuth<RouteCtx>('viewer', async (_req, ctx, routeCtx) => {
  const { id } = await routeCtx!.params
  const r = await loadContact(id, ctx.orgId)
  if (!r.ok) return apiError(r.error, r.status)
  const prefs = await getContactPreferences(id, ctx.orgId)
  return apiSuccess(prefs)
})

const updatePreferences = withCrmAuth<RouteCtx>('member', async (req, ctx, routeCtx) => {
  const { id } = await routeCtx!.params
  const r = await loadContact(id, ctx.orgId)
  if (!r.ok) return apiError(r.error, r.status)

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return apiError('Invalid JSON body', 400)

  // Validate frequency if provided
  if (
    typeof body.frequency === 'string' &&
    !FREQUENCY_CHOICES.includes(body.frequency as typeof FREQUENCY_CHOICES[number])
  ) {
    return apiError(
      `Invalid frequency. Must be one of: ${FREQUENCY_CHOICES.join(', ')}`,
      400,
    )
  }

  const next = await setContactPreferences({
    contactId: id,
    orgId: ctx.orgId,
    topics:
      typeof body.topics === 'object' && body.topics !== null
        ? (body.topics as Record<string, boolean>)
        : undefined,
    frequency:
      typeof body.frequency === 'string'
        ? (body.frequency as typeof FREQUENCY_CHOICES[number])
        : undefined,
    unsubscribeAll:
      typeof body.unsubscribeAll === 'boolean' ? body.unsubscribeAll : undefined,
    updatedFrom: 'admin',
  })
  return apiSuccess(next)
})

export function GET(req: NextRequest, routeCtx: RouteCtx) {
  return getPreferences(req, routeCtx)
}

export function PUT(req: NextRequest, routeCtx: RouteCtx) {
  return updatePreferences(req, routeCtx)
}
