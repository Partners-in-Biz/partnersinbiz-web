import { NextRequest } from 'next/server'
import { createHash } from 'crypto'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { BriefingCardAction } from '@/lib/briefing/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ itemId: string }> }

function stateDocId(orgId: string, userId: string, itemId: string) {
  return createHash('sha256').update(`${orgId}:${userId}:${itemId}`).digest('hex')
}

const SUPPORTED_ACTIONS: readonly BriefingCardAction[] = [
  'read',
  'handled',
  'snoozed',
  'rejected',
  'approved',
  'pending-review',
  'follow-up-created',
]

const GATED_EXTERNAL_SIDE_EFFECTS = new Set(['send', 'publish', 'spend', 'deploy', 'billing', 'delete', 'archive', 'destructive'])
const NO_SIDE_EFFECT_COPY = 'No send, publish, spend, deploy, billing, or destructive action was performed.'

function normalizeAction(action: string): BriefingCardAction | null {
  if (action === 'active') return 'read'
  return (SUPPORTED_ACTIONS as readonly string[]).includes(action) ? action as BriefingCardAction : null
}

function cleanText(value: unknown, maxLength = 1000): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().slice(0, maxLength)
  return trimmed || null
}

function cleanObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
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
  const requestedAction = typeof body.action === 'string' ? body.action : ''
  const action = normalizeAction(requestedAction)
  if (!action) {
    return apiError(`Unsupported briefing action '${requestedAction}'. ${NO_SIDE_EFFECT_COPY}`, 400)
  }

  const orgId = cleanText(body.orgId)
  if (!orgId) return apiError('orgId is required', 400)
  if (!canAccessOrg(user, orgId)) return apiError(`You do not have access to workspace ${orgId}`, 403)

  const externalSideEffect = cleanText(body.externalSideEffect)
  if (externalSideEffect && GATED_EXTERNAL_SIDE_EFFECTS.has(externalSideEffect)) {
    return apiSuccess({
      itemId,
      orgId,
      status: 'pending-review',
      approvalRequired: true,
      sideEffectPerformed: false,
      copy: `Approval is still required before any external ${externalSideEffect}. ${NO_SIDE_EFFECT_COPY}`,
    }, 202)
  }

  const note = cleanText(body.note)
  const snoozedUntil = action === 'snoozed' ? snoozeUntil(body.snoozedUntil) : null
  if (action === 'snoozed' && !snoozedUntil) return apiError('snoozedUntil must be a future date', 400)

  const approvalState = cleanText(body.approvalState)
  const approvalCopy = cleanText(body.approvalCopy, 2000)
  const decisionSubmission = cleanObject(body.decisionSubmission)
  const ref = adminDb.collection('briefing_user_states').doc(stateDocId(orgId, user.uid, itemId))
  await ref.set({
    itemId,
    orgId,
    userId: user.uid,
    status: action,
    action,
    note,
    snoozedUntil,
    approvalState,
    approvalCopy,
    decisionSubmission,
    sideEffectPerformed: false,
    updatedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
  }, { merge: true })

  return apiSuccess({ itemId, orgId, status: action, approvalState, sideEffectPerformed: false })
})
