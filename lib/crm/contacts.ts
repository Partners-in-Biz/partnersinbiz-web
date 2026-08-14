// lib/crm/contacts.ts
import { sanitizeOtherLinks, sanitizeProfileUrl } from '@/lib/crm/profileLinks'

// Fields that must never come from the request body — the route handler
// (via middleware-authoritative ctx) controls these. Stripping them here
// blocks the cross-tenant-via-body-orgId attack at the source.
//
// Mirrors lib/companies/store.ts NEVER_FROM_BODY (commit 1907d8f).

const NEVER_FROM_BODY = new Set([
  'id', 'orgId',
  'createdBy', 'createdByRef', 'createdAt',
  'updatedBy', 'updatedByRef', 'updatedAt',
  'deleted',
  // Evidence-ledger ownership is computed server-side from human edits / accept decisions.
  'humanOwnedFields',
  // Cross-tenant links. Written server-side only, by an accepted partner invite
  // (lib/partner-links) or the platform-owner sync — never from a request body.
  'linkedUserId',
  'linkedOrgId',
])

export const CONTACT_AGREEMENT_ROLES = [
  'primary_contact',
  'accounts_contact',
  'authorized_signatory',
  'approval_contact',
] as const

const CONTACT_AGREEMENT_ROLE_SET = new Set<string>(CONTACT_AGREEMENT_ROLES)

export function cleanContactString(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined
}

export function normalizeAgreementRoles(value: unknown): string[] | null | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) return null

  const roles: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') return null
    const role = item.trim()
    if (!CONTACT_AGREEMENT_ROLE_SET.has(role)) return null
    if (!roles.includes(role)) roles.push(role)
  }
  return roles
}

export function sanitizeContactForWrite(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue
    if (NEVER_FROM_BODY.has(k)) continue
    if (
      (k === 'jobTitle' ||
        k === 'department' ||
        k === 'website' ||
        k === 'linkedinUrl' ||
        k === 'twitterUrl' ||
        k === 'githubUrl' ||
        k === 'facebookUrl' ||
        k === 'instagramUrl' ||
        k === 'youtubeUrl') &&
      typeof v === 'string'
    ) {
      out[k] = sanitizeProfileUrl(v) ?? v.trim()
      continue
    }
    if (k === 'otherLinks') {
      const links = sanitizeOtherLinks(v)
      if (links !== undefined) out[k] = links
      continue
    }
    if (k === 'agreementRoles') {
      const roles = normalizeAgreementRoles(v)
      if (roles !== null && roles !== undefined) out[k] = roles
      continue
    }
    out[k] = v
  }
  return out
}
