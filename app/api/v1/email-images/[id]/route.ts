// app/api/v1/email-images/[id]/route.ts
//
// DELETE — soft-deletes the email_images doc and best-effort removes the
// underlying Storage object. Existing emails that already use the URL keep
// rendering (we don't 404 stale URLs intentionally).

import { NextRequest } from 'next/server'
import { adminDb, getAdminApp } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiSuccess, apiError } from '@/lib/api/response'
import { enforceAgentCapability } from '@/lib/api/capabilityGate'
import { FieldValue } from 'firebase-admin/firestore'
import { lastActorFrom } from '@/lib/api/actor'
import { getStorage } from 'firebase-admin/storage'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export const DELETE = withAuth('client', async (req: NextRequest, user: ApiUser, context?: unknown) => {
  const { id } = await (context as Params).params

  const ref = adminDb.collection('email_images').doc(id)
  const snap = await ref.get()
  if (!snap.exists || snap.data()?.deleted) return apiError('Not found', 404)

  const data = snap.data()!
  const scope = resolveOrgScope(user, (data.orgId as string | undefined) ?? null)
  if (!scope.ok) return apiError(scope.error, scope.status)
  const capabilityError = enforceAgentCapability(user, 'delete', req)
  if (capabilityError) return capabilityError

  // Best-effort storage delete — don't fail the API call if it doesn't exist.
  const storagePath = typeof data.storagePath === 'string' ? data.storagePath : ''
  if (storagePath) {
    try {
      const bucket = getStorage(getAdminApp()).bucket()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (bucket.file(storagePath) as any).delete({ ignoreNotFound: true })
    } catch (err) {
      console.warn('[email-images] storage delete failed', err)
    }
  }

  await ref.update({
    deleted: true,
    deletedAt: FieldValue.serverTimestamp(),
    ...lastActorFrom(user),
  })

  return apiSuccess({ id })
})
