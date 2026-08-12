import { adminDb } from '@/lib/firebase/admin'
import type { MarketingCollaborationModule } from './marketing-collaboration'

/**
 * Server-side owner lookup for the only resources that may enter the marketing
 * collaboration decision boundary. The route deliberately ignores any owner
 * supplied by a caller: a missing, deleted, or ownerless record is not shareable.
 */
const COLLECTION_FOR_MODULE: Record<MarketingCollaborationModule, string> = {
  campaigns: 'campaigns',
  social: 'social_posts',
  // Email campaigns are stored in the canonical campaigns collection.
  email: 'campaigns',
  seo: 'seo_content',
  ads: 'ad_campaigns',
  // Analytics collaboration is anchored on a property, never raw events.
  analytics: 'properties',
}

function ownerOrgIdFromRecord(record: Record<string, unknown>): string | null {
  const owner = typeof record.orgId === 'string' ? record.orgId.trim() : ''
  if (!owner || record.deleted === true || record.deletedAt) return null
  return owner
}

export async function loadMarketingResourceOwner(
  module: MarketingCollaborationModule,
  resourceId: string,
): Promise<string | null> {
  const collection = COLLECTION_FOR_MODULE[module]
  const snapshot = await adminDb.collection(collection).doc(resourceId).get()
  if (!snapshot.exists) return null
  return ownerOrgIdFromRecord(snapshot.data() ?? {})
}
