import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { CRM_LIVE_UPDATES_COLLECTION, type CrmLiveEntity } from '@/lib/crm/live-update-keys'

export async function touchCrmLiveUpdate(
  orgId: string,
  entity: CrmLiveEntity,
  reason: string,
): Promise<void> {
  const cleanOrgId = orgId.trim()
  if (!cleanOrgId) return

  await adminDb
    .collection('organizations')
    .doc(cleanOrgId)
    .collection(CRM_LIVE_UPDATES_COLLECTION)
    .doc(entity)
    .set({
      entity,
      orgId: cleanOrgId,
      reason,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
}

export async function safeTouchCrmLiveUpdate(
  orgId: string,
  entity: CrmLiveEntity,
  reason: string,
): Promise<void> {
  try {
    await touchCrmLiveUpdate(orgId, entity, reason)
  } catch (err) {
    console.error('[crm-live-update] failed to touch live update document', { orgId, entity, reason, err })
  }
}
