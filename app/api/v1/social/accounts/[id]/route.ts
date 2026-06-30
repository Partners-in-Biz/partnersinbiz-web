/**
 * GET    /api/v1/social/accounts/:id  — get a single account
 * PUT    /api/v1/social/accounts/:id  — update account details
 * DELETE /api/v1/social/accounts/:id  — disconnect account
 */
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { withTenant } from '@/lib/api/tenant'
import { apiSuccess, apiError } from '@/lib/api/response'
import { logAudit } from '@/lib/social/audit'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

function canAccessAccount(data: Record<string, unknown>, orgId: string, uid: string): boolean {
  if (data.orgId !== orgId) return false
  if (data.accountScope === 'personal') return data.ownerUid === uid
  return true
}

export const GET = withAuth('client', withTenant(async (_req: NextRequest, user, orgId, context) => {
  const { id } = await (context as Params).params
  const doc = await adminDb.collection('social_accounts').doc(id).get()
  if (!doc.exists) return apiError('Account not found', 404)

  const data = doc.data()!
  if (!canAccessAccount(data, orgId, user.uid)) return apiError('Account not found', 404)

  const safe = Object.fromEntries(Object.entries(data).filter(([key]) => key !== 'encryptedTokens'))
  return apiSuccess({ id: doc.id, ...safe })
}))

export const PUT = withAuth('client', withTenant(async (req, user, orgId, context) => {
  const { id } = await (context as Params).params
  const doc = await adminDb.collection('social_accounts').doc(id).get()
  if (!doc.exists) return apiError('Account not found', 404)

  const data = doc.data()!
  if (!canAccessAccount(data, orgId, user.uid)) return apiError('Account not found', 404)

  const body = await req.json()

  const updates: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
  }

  const allowedFields = ['displayName', 'username', 'avatarUrl', 'profileUrl', 'accountType', 'status', 'scopes', 'platformMeta']
  for (const field of allowedFields) {
    if (field in body) {
      updates[field] = body[field]
    }
  }

  await adminDb.collection('social_accounts').doc(id).update(updates)
  return apiSuccess({ id })
}))

export const DELETE = withAuth('client', withTenant(async (req, user, orgId, context) => {
  const { id } = await (context as Params).params
  const doc = await adminDb.collection('social_accounts').doc(id).get()
  if (!doc.exists) return apiError('Account not found', 404)

  const data = doc.data()!
  if (!canAccessAccount(data, orgId, user.uid)) return apiError('Account not found', 404)

  await adminDb.collection('social_accounts').doc(id).update({
    status: 'disconnected',
    encryptedTokens: {
      accessToken: '',
      refreshToken: null,
      tokenType: '',
      expiresAt: null,
      iv: '',
      tag: '',
    },
    updatedAt: FieldValue.serverTimestamp(),
  })

  await logAudit({
    orgId,
    action: 'account.disconnected',
    entityType: 'account',
    entityId: id,
    performedBy: user.uid,
    performedByRole: user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client',
    details: { platform: data.platform },
    ip: req.headers.get('x-forwarded-for'),
  })

  return apiSuccess({ id })
}))
