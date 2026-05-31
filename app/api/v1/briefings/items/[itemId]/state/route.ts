import { NextRequest } from 'next/server'
import { createHash } from 'crypto'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ itemId: string }> }

function stateDocId(userId: string, itemId: string) {
  return createHash('sha256').update(`${userId}:${itemId}`).digest('hex')
}

function snoozeUntil(value: unknown): Timestamp | null {
  if (typeof value === 'string') {
    const ms = Date.parse(value)
    if (Number.isFinite(ms) && ms > Date.now()) return Timestamp.fromMillis(ms)
  }
  if (typeof value === 'number' && Number.isFinite(value) && value > Date.now()) {
    return Timestamp.fromMillis(value)
  }
  return null
}

export const POST = withAuth('client', async (req: NextRequest, user, ctx) => {
  const { itemId: rawItemId } = await (ctx as RouteContext).params
  const itemId = decodeURIComponent(rawItemId || '').trim()
  if (!itemId) return apiError('itemId is required', 400)

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const action = typeof body.action === 'string' ? body.action : ''
  if (!['handled', 'snoozed', 'active'].includes(action)) {
    return apiError("action must be 'handled', 'snoozed', or 'active'", 400)
  }

  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 1000) : ''
  const snoozedUntil = action === 'snoozed' ? snoozeUntil(body.snoozedUntil) : null
  if (action === 'snoozed' && !snoozedUntil) return apiError('snoozedUntil must be a future date', 400)

  const ref = adminDb.collection('briefing_user_states').doc(stateDocId(user.uid, itemId))
  await ref.set({
    itemId,
    userId: user.uid,
    status: action,
    note: note || null,
    snoozedUntil,
    updatedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
  }, { merge: true })

  return apiSuccess({ itemId, status: action })
})
