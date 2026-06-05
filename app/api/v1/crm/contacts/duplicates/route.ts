// app/api/v1/crm/contacts/duplicates/route.ts
//
// GET /api/v1/crm/contacts/duplicates
// Returns groups of contacts that are likely duplicates (same email or name).
// Auth: admin+

import { NextRequest } from 'next/server'
import { apiSuccess } from '@/lib/api/response'
import { withCrmAuth, type CrmAuthContext } from '@/lib/auth/crm-middleware'
import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

interface Contact {
  id: string
  email?: string
  name?: string
  [key: string]: unknown
}

interface DuplicateGroup {
  contacts: Contact[]
  reason: 'email' | 'name'
}

async function handler(_req: NextRequest, ctx: CrmAuthContext): Promise<Response> {
  const { orgId } = ctx

  // Keep this query index-light: filter deleted contacts in memory.
  const snap = await adminDb
    .collection('contacts')
    .where('orgId', '==', orgId)
    .limit(2000)
    .get()

  const contacts: Contact[] = snap.docs
    .map((doc): Contact => ({
      id: doc.id,
      ...(doc.data() as Omit<Contact, 'id'>),
    }))
    .filter((contact) => contact.deleted !== true)

  const groups: DuplicateGroup[] = []

  // ── Group by exact email (case-insensitive) ──────────────────────────────────
  const emailMap = new Map<string, Contact[]>()
  const contactsWithEmail = new Set<string>() // track contact IDs already placed in email groups

  for (const contact of contacts) {
    if (!contact.email) continue
    const key = (contact.email as string).toLowerCase().trim()
    if (!emailMap.has(key)) emailMap.set(key, [])
    emailMap.get(key)!.push(contact)
  }

  for (const [, group] of emailMap) {
    if (group.length >= 2) {
      groups.push({ contacts: group, reason: 'email' })
      group.forEach((c) => contactsWithEmail.add(c.id))
    }
  }

  // ── Group by name for contacts not already in an email group ─────────────────
  const nameMap = new Map<string, Contact[]>()

  for (const contact of contacts) {
    if (contactsWithEmail.has(contact.id)) continue // already captured
    if (!contact.name) continue
    const key = (contact.name as string).toLowerCase().trim()
    if (!nameMap.has(key)) nameMap.set(key, [])
    nameMap.get(key)!.push(contact)
  }

  for (const [, group] of nameMap) {
    if (group.length >= 2) {
      groups.push({ contacts: group, reason: 'name' })
    }
  }

  return apiSuccess({ groups })
}

export const GET = withCrmAuth('admin', handler)
