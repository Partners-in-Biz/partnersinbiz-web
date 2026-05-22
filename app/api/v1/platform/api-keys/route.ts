import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { createHash, randomBytes } from 'crypto'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async () => {
  const snapshot = await adminDb
    .collection('api_keys')
    .orderBy('createdAt', 'desc')
    .get()

  const keys = snapshot.docs.map(doc => {
    const data = doc.data()
    return {
      id: doc.id,
      name: data.name,
      keyPrefix: data.keyPrefix,
      orgId: data.orgId,
      agentId: data.agentId ?? null,
      role: data.role,
      permissions: data.permissions ?? [],
      lastUsedAt: data.lastUsedAt,
      createdAt: data.createdAt,
      expiresAt: data.expiresAt ?? null,
      revokedAt: data.revokedAt ?? null,
    }
  })

  return apiSuccess(keys)
})

export const POST = withAuth('admin', async (req, user) => {
  const body = await req.json().catch(() => ({}))
  if (!body.name) return apiError('name is required', 400)

  // Generate a secure random key
  const rawKey = `pib_${body.role === 'admin' ? 'ak' : 'ag'}_${randomBytes(24).toString('base64url')}`
  const keyPrefix = rawKey.slice(0, 12)
  const keyHash = createHash('sha256').update(rawKey).digest('hex')

  const doc = {
    name: body.name,
    orgId: body.orgId ?? '',
    agentId: typeof body.agentId === 'string' && body.agentId.trim() ? body.agentId.trim() : null,
    role: body.role ?? 'ai',
    keyHash,
    keyPrefix,
    permissions: body.permissions ?? [],
    lastUsedAt: null,
    expiresAt: body.expiresAt ?? null,
    createdBy: user.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }

  const ref = await adminDb.collection('api_keys').add(doc)

  return apiSuccess({
    id: ref.id,
    keyPrefix,
    rawKey, // ONLY returned once at creation
  }, 201)
})
