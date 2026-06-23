// app/api/v1/admin/email/broadcast/recipients.ts
//
// Resolve a platform-broadcast recipient filter into a concrete address list
// from the REAL `users` collection (and `organizations` for org-scoped
// targeting). Platform broadcasts go to platform USERS, not CRM contacts —
// CRM contacts are per-org and already served by the org broadcast system
// (lib/broadcasts). This is the admin/platform audience only.

import { adminDb } from '@/lib/firebase/admin'

export type RecipientSource = 'all_users' | 'by_role' | 'by_org'

export interface RecipientFilter {
  source: RecipientSource
  role?: string // when source === 'by_role' (e.g. 'admin' | 'client' | 'ai')
  orgId?: string // when source === 'by_org'
}

export interface ResolvedRecipient {
  email: string
  uid: string
  firstName: string
  displayName: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function firstNameFrom(displayName: string, email: string): string {
  const dn = (displayName ?? '').trim()
  if (dn) return dn.split(/\s+/)[0]
  const local = (email ?? '').split('@')[0] ?? ''
  return local || 'there'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toRecipient(doc: any): ResolvedRecipient | null {
  const data = doc.data() ?? {}
  const email = (data.email ?? '').toString().trim().toLowerCase()
  if (!EMAIL_RE.test(email)) return null
  const displayName = (data.displayName ?? data.name ?? '').toString()
  return {
    email,
    uid: doc.id,
    displayName,
    firstName: firstNameFrom(displayName, email),
  }
}

/**
 * Resolve the recipient list for a filter. Dedupes by email. Org-scoped
 * targeting reads the organization's member userIds and resolves those users.
 */
export async function resolveRecipients(filter: RecipientFilter): Promise<ResolvedRecipient[]> {
  const out = new Map<string, ResolvedRecipient>()

  if (filter.source === 'by_org' && filter.orgId) {
    const orgSnap = await adminDb.collection('organizations').doc(filter.orgId).get()
    if (!orgSnap.exists) return []
    const org = orgSnap.data() ?? {}
    // Members may be stored as an array of { userId } or a map keyed by userId.
    const memberIds = new Set<string>()
    const members = org.members
    if (Array.isArray(members)) {
      for (const m of members) {
        const uid = typeof m === 'string' ? m : m?.userId ?? m?.uid
        if (uid) memberIds.add(String(uid))
      }
    } else if (members && typeof members === 'object') {
      for (const k of Object.keys(members)) memberIds.add(k)
    }
    if (org.ownerId) memberIds.add(String(org.ownerId))

    // Resolve each member user doc.
    for (const uid of memberIds) {
      const uSnap = await adminDb.collection('users').doc(uid).get()
      if (!uSnap.exists) continue
      const r = toRecipient(uSnap)
      if (r) out.set(r.email, r)
    }
    return Array.from(out.values())
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = adminDb.collection('users')
  if (filter.source === 'by_role' && filter.role) {
    query = query.where('role', '==', filter.role)
  }
  const snap = await query.get()
  for (const doc of snap.docs) {
    const r = toRecipient(doc)
    if (r) out.set(r.email, r)
  }
  return Array.from(out.values())
}

/** Live count for the audience picker — cheaper than building the full list. */
export async function countRecipients(filter: RecipientFilter): Promise<number> {
  const list = await resolveRecipients(filter)
  return list.length
}

export function describeFilter(filter: RecipientFilter): string {
  if (filter.source === 'all_users') return 'All platform users'
  if (filter.source === 'by_role') return `Users with role "${filter.role ?? '?'}"`
  if (filter.source === 'by_org') return `Members of org ${filter.orgId ?? '?'}`
  return 'Unknown audience'
}
