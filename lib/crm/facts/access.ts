// lib/crm/facts/access.ts
// Shared org + assignment access for contact fact / graph routes.

import { adminDb } from '@/lib/firebase/admin'
import type { CrmAuthContext } from '@/lib/auth/crm-middleware'
import { apiError } from '@/lib/api/response'
import {
  crmActorCanReadRecord,
  crmRecordCompanyIds,
  isCrmPrivilegedActor,
  loadCompanyAssignmentMap,
} from '@/lib/crm/assignment-access'
import type { FactContactView } from './types'

export type ContactAccessResult =
  | { ok: true; contact: FactContactView }
  | { ok: false; res: Response }

/**
 * Load a contact for fact/graph/mailbox routes.
 * Fail-closed: missing, wrong org, deleted, or assignment-denied → 404.
 */
export async function loadAccessibleFactContact(
  ctx: CrmAuthContext,
  contactId: string,
): Promise<ContactAccessResult> {
  if (!contactId) {
    return { ok: false, res: apiError('Contact ID is required', 400) }
  }

  const snap = await adminDb.collection('contacts').doc(contactId).get()
  if (!snap.exists) return { ok: false, res: apiError('Contact not found', 404) }
  const data = snap.data()!
  if (data.orgId !== ctx.orgId || data.deleted === true) {
    return { ok: false, res: apiError('Contact not found', 404) }
  }

  if (!isCrmPrivilegedActor(ctx)) {
    const companies = await loadCompanyAssignmentMap(ctx.orgId, crmRecordCompanyIds(data))
    if (!crmActorCanReadRecord(ctx, { id: snap.id, ...data }, { companies })) {
      return { ok: false, res: apiError('Contact not found', 404) }
    }
  }

  return {
    ok: true,
    contact: { id: snap.id, orgId: ctx.orgId, ...data } as FactContactView,
  }
}
