// app/api/v1/campaigns/[id]/ab/route.ts
//
// GET  — read the campaign's AbConfig (returns EMPTY_AB when none stored).
// PUT  — save the AbConfig on the campaign doc as `ab`. Only editable while
//        the test hasn't started (status inactive/complete) — mirrors the
//        broadcast A/B edit lock so a live test can't be mutated mid-flight.
//
// Auth: client (mirrors the campaign-scoped analytics + broadcast ab routes).
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiSuccess, apiError } from '@/lib/api/response'
import { lastActorFrom } from '@/lib/api/actor'
import type { ApiUser } from '@/lib/api/types'
import type { AbConfig } from '@/lib/ab-testing/types'
import { EMPTY_AB } from '@/lib/ab-testing/types'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export const GET = withAuth('client', async (_req: NextRequest, user: ApiUser, context?: unknown) => {
  const { id } = await (context as Params).params
  const snap = await adminDb.collection('campaigns').doc(id).get()
  if (!snap.exists || snap.data()?.deleted === true) return apiError('Campaign not found', 404)
  const data = snap.data()!
  const scope = resolveOrgScope(user, (data.orgId as string | undefined) ?? null)
  if (!scope.ok) return apiError(scope.error, scope.status)

  const ab = (data.ab as AbConfig | undefined) ?? EMPTY_AB
  return apiSuccess({ campaignId: id, ab })
})

export const PUT = withAuth('client', async (req: NextRequest, user: ApiUser, context?: unknown) => {
  const { id } = await (context as Params).params
  const snap = await adminDb.collection('campaigns').doc(id).get()
  if (!snap.exists || snap.data()?.deleted === true) return apiError('Campaign not found', 404)
  const data = snap.data()!
  const scope = resolveOrgScope(user, (data.orgId as string | undefined) ?? null)
  if (!scope.ok) return apiError(scope.error, scope.status)

  const existing = (data.ab as AbConfig | undefined) ?? EMPTY_AB
  if (existing.status === 'testing' || existing.status === 'winner-pending' || existing.status === 'winner-sent') {
    return apiError('A/B test is already running — cannot edit the configuration now', 409)
  }

  const body = (await req.json().catch(() => ({}))) as { ab?: Partial<AbConfig> }
  if (!body.ab || typeof body.ab !== 'object') return apiError('Missing ab config', 400)

  // Normalise/merge onto the canonical shape so we never persist a partial.
  const incoming = body.ab
  const next: AbConfig = {
    ...EMPTY_AB,
    ...existing,
    ...incoming,
    // Preserve server-managed test-window + winner fields; the editor never
    // sets these (the cron + declare-winner route own them).
    testStartedAt: existing.testStartedAt ?? null,
    testEndsAt: existing.testEndsAt ?? null,
    winnerVariantId: existing.winnerVariantId ?? '',
    winnerDecidedAt: existing.winnerDecidedAt ?? null,
    status: existing.status === 'complete' && incoming.enabled === false ? 'inactive' : (existing.status ?? 'inactive'),
    variants: Array.isArray(incoming.variants) ? incoming.variants : existing.variants,
  }

  await adminDb.collection('campaigns').doc(id).update({
    ab: next,
    ...lastActorFrom(user),
  })

  return apiSuccess({ campaignId: id, ab: next })
})
