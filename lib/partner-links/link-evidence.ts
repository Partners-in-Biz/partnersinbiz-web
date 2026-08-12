import { adminDb } from '@/lib/firebase/admin'
import type { BusinessRelationship } from '@/lib/business-relationships/types'
import { cleanString } from './identity'

export const RELATIONSHIP_COLLECTION = 'businessRelationships'

export interface LiveBilateralLink {
  /** The caller's own side of the accepted partner link. */
  link: BusinessRelationship
  /** The counterpart row in the partner org — must also be live. */
  counterpart: BusinessRelationship
}

/**
 * Loads the caller's own side of an accepted partner link AND proves the
 * bilateral contract still holds: a counterpart row exists in the partner org,
 * is active, not deleted, and shares the same partnerLinkId with the matching
 * org pair.
 *
 * A unilateral business relationship row — even one carrying a partnerLinkId —
 * grants NO resource access until both sides are live. Every cross-org
 * capability surface (record shares, project grants, relationship threads,
 * commerce, settlement) must go through this evidence check before any
 * capability on the link is usable.
 */
export async function loadLiveBilateralLink(
  relationshipId: string,
  orgId: string,
): Promise<LiveBilateralLink> {
  const snap = await adminDb.collection(RELATIONSHIP_COLLECTION).doc(relationshipId).get()
  if (!snap.exists) throw new Error('Partner link not found')
  const link = { ...(snap.data() as BusinessRelationship), id: snap.id }
  if (link.sourceOrgId !== orgId || link.deleted === true) throw new Error('Partner link not found')

  const partnerLinkId = cleanString(link.partnerLinkId)
  if (!partnerLinkId) throw new Error('That relationship is not an accepted partner link')
  if (link.status !== 'active') throw new Error('This partner link is not active')

  const targetOrgId = cleanString(link.targetOrgId)
  if (!targetOrgId) throw new Error('This partner link has no counterpart organisation')

  // Query by the shared link id (single-field, no composite index required)
  // and filter for the exact counterpart in memory.
  const linked = await adminDb
    .collection(RELATIONSHIP_COLLECTION)
    .where('partnerLinkId', '==', partnerLinkId)
    .limit(10)
    .get()

  const counterpart = linked.docs
    .map((d) => ({ ...(d.data() as BusinessRelationship), id: d.id }))
    .find((row) =>
      row.id !== relationshipId &&
      row.sourceOrgId === targetOrgId &&
      cleanString(row.targetOrgId) === orgId &&
      cleanString(row.partnerLinkId) === partnerLinkId &&
      row.status === 'active' &&
      row.deleted !== true,
    )

  if (!counterpart) throw new Error('This partner link is not active')
  return { link, counterpart }
}
