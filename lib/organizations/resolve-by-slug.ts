// lib/organizations/resolve-by-slug.ts
import { adminDb } from '@/lib/firebase/admin'

export async function resolveOrgIdBySlug(slug: string): Promise<string | null> {
  const snap = await adminDb
    .collection('organizations')
    .where('slug', '==', slug)
    .limit(1)
    .get()
  if (snap.docs.length === 0) return null
  return snap.docs[0].id
}

export async function resolveOrgIdBySlugOrId(slugOrId: string): Promise<string | null> {
  const bySlug = await resolveOrgIdBySlug(slugOrId)
  if (bySlug) return bySlug

  const byId = await adminDb.collection('organizations').doc(slugOrId).get()
  return byId.exists ? slugOrId : null
}
