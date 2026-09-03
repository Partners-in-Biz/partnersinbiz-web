import { adminDb } from '@/lib/firebase/admin'

const SLUG_RE = /^[a-z][a-z0-9-]{0,62}$/
const cache = new Map<string, string>()

interface OrgSlugDb {
  collection(name: string): {
    doc(id: string): {
      get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>
    }
  }
}

export function clearOrgSlugCache(): void {
  cache.clear()
}

export async function getOrgSlug(
  orgId: string,
  options: { db?: OrgSlugDb } = {},
): Promise<string> {
  const cached = cache.get(orgId)
  if (cached) return cached

  const db = options.db ?? adminDb
  const snap = await db.collection('organizations').doc(orgId).get()
  if (!snap.exists) throw new Error('managed profile: org not found')

  const slug = typeof snap.data()?.slug === 'string' ? snap.data()!.slug.trim() : ''
  if (!SLUG_RE.test(slug)) throw new Error('managed profile: org slug is not runtime-safe')

  cache.set(orgId, slug)
  return slug
}
