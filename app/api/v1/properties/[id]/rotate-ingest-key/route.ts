import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { lastActorFrom } from '@/lib/api/actor'
import { generateIngestKey } from '@/lib/properties/ingest-key'
import { canAccessOrg } from '@/lib/api/platformAdmin'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const POST = withAuth('admin', async (_req: NextRequest, user, ctx) => {
  const { id } = await (ctx as RouteContext).params
  try {
    const ref = adminDb.collection('properties').doc(id)
    const snap = await ref.get()
    if (!snap.exists || snap.data()?.deleted) return apiError('Not found', 404)
    if (!canAccessOrg(user, snap.data()?.orgId)) return apiError('Forbidden', 403)

    const ingestKey = generateIngestKey()

    await ref.update({
      ingestKey,
      ingestKeyRotatedAt: FieldValue.serverTimestamp(),
      ...lastActorFrom(user),
    })

    return apiSuccess({ id, ingestKey })
  } catch (err) {
    console.error('[properties-rotate-key-error]', err)
    return apiError('Failed to rotate ingest key', 500)
  }
})
