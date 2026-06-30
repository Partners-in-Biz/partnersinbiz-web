import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { withTenant } from '@/lib/api/tenant'
import { apiSuccess, apiError } from '@/lib/api/response'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export const PUT = withAuth('client', withTenant(async (_req: NextRequest, user, orgId, context) => {
  const { id } = await (context as Params).params

  const doc = await adminDb.collection('social_accounts').doc(id).get()
  if (!doc.exists) return apiError('Not found', 404)

  const data = doc.data()!
  if (data.orgId !== orgId) return apiError('Not found', 404)
  const isPersonal = data.accountScope === 'personal'
  if (isPersonal && data.ownerUid !== user.uid) return apiError('Not found', 404)

  const existingDefaults = await adminDb
    .collection('social_accounts')
    .where('orgId', '==', orgId)
    .where('platform', '==', data.platform)
    .where('isDefault', '==', true)
    .get()

  const batch = adminDb.batch()
  for (const d of existingDefaults.docs) {
    const defaultData = d.data()
    const sameDefaultScope = isPersonal
      ? defaultData.accountScope === 'personal' && defaultData.ownerUid === user.uid
      : defaultData.accountScope !== 'personal'
    if (d.id !== id && sameDefaultScope) {
      batch.update(d.ref, { isDefault: false, updatedAt: FieldValue.serverTimestamp() })
    }
  }
  batch.update(doc.ref, { isDefault: true, updatedAt: FieldValue.serverTimestamp() })
  await batch.commit()

  return apiSuccess({ id })
}))
