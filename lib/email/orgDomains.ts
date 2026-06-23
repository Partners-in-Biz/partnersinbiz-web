// lib/email/orgDomains.ts
//
// Server-side helpers for reading an org's sending domains. Shared by the
// transactional send API (US-110) and the deliverability dashboard (US-111).

import { adminDb } from '@/lib/firebase/admin'
import type { EmailDomain } from '@/lib/email/domains'

/**
 * Fetch all non-deleted sending domains for an org.
 */
export async function listOrgDomains(orgId: string): Promise<EmailDomain[]> {
  const snap = await adminDb.collection('email_domains').where('orgId', '==', orgId).get()
  return snap.docs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((d: any) => ({ id: d.id, ...d.data() }) as EmailDomain)
    .filter((d) => d.deleted !== true)
}

/**
 * Fetch only the verified sending domains for an org.
 */
export async function listVerifiedOrgDomains(orgId: string): Promise<EmailDomain[]> {
  const all = await listOrgDomains(orgId)
  return all.filter((d) => d.status === 'verified')
}

/**
 * Extract the domain part of an email/sender string. Handles both bare
 * addresses ("a@b.com") and display-name forms ("Name <a@b.com>"). Returns ""
 * when no domain can be parsed.
 */
export function extractSenderDomain(fromValue: string): string {
  if (!fromValue) return ''
  // Prefer the address inside angle brackets if present.
  const angle = fromValue.match(/<([^>]+)>/)
  const address = (angle ? angle[1] : fromValue).trim()
  const at = address.lastIndexOf('@')
  if (at === -1) return ''
  return address.slice(at + 1).trim().toLowerCase()
}
