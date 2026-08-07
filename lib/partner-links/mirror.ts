import { Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { MemberRef } from '@/lib/orgMembers/memberRef'
import type { ContactCompanyLink } from '@/lib/crm/types'
import { cleanString, normalizeEmail, splitName } from './identity'

/**
 * Generic org-to-org CRM mirroring.
 *
 * `lib/platform-owner/relationships.ts` does the same job but is hardcoded to
 * the Partners in Biz platform org (it literally writes "Partners in Biz" and
 * partnersinbiz.online). These helpers take both sides as parameters so any
 * pair of orgs can be mirrored. The platform-owner module is deliberately left
 * alone — refactoring it onto these helpers touches client provisioning.
 */

type OrgLike = Record<string, unknown>

function normalizeComparable(value: unknown): string {
  return cleanString(value).toLowerCase()
}

function mergeTags(existing: unknown, additions: string[]): string[] {
  const values = Array.isArray(existing)
    ? existing.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
    : []
  const next = new Set(values)
  for (const tag of additions) next.add(tag)
  return Array.from(next)
}

function orgDisplayName(orgId: string, org: OrgLike | null, fallback?: string): string {
  return cleanString(fallback) || cleanString(org?.name) || cleanString(org?.displayName) || orgId
}

function orgDomain(org: OrgLike | null): string {
  const direct = cleanString(org?.domain)
  const source = direct || cleanString(org?.website)
  if (!source) return ''
  return source.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
}

async function loadOrg(orgId: string): Promise<OrgLike | null> {
  if (!orgId) return null
  const snap = await adminDb.collection('organizations').doc(orgId).get()
  return snap.exists ? snap.data() ?? null : null
}

export interface MirrorCompanyResult {
  companyId: string
  companyName: string
  created: boolean
}

/**
 * Ensure `ownerOrgId`'s CRM holds a company representing `representsOrgId`.
 *
 * Match order mirrors findDuplicateCompany: linkedOrgId, then domain, then
 * normalised name. Reads are index-free (`orgId ==` + in-memory filter), which
 * is the deliberate convention for this surface.
 */
export async function ensureMirrorCompany(input: {
  ownerOrgId: string
  representsOrgId: string
  preferCompanyId?: string
  actor: MemberRef
  tags?: string[]
}): Promise<MirrorCompanyResult | null> {
  const ownerOrgId = cleanString(input.ownerOrgId)
  const representsOrgId = cleanString(input.representsOrgId)
  if (!ownerOrgId || !representsOrgId || ownerOrgId === representsOrgId) return null

  const representsOrg = await loadOrg(representsOrgId)
  const companyName = orgDisplayName(representsOrgId, representsOrg)
  const domain = orgDomain(representsOrg)
  const now = Timestamp.now()
  const tags = input.tags ?? ['partner']

  const patch: Record<string, unknown> = {
    orgId: ownerOrgId,
    name: companyName,
    linkedOrgId: representsOrgId,
    lifecycleStage: 'customer',
    source: 'partner_link',
    visibility: 'relationship',
    allowedOrgIds: [ownerOrgId, representsOrgId],
    approvalState: 'approved',
    updatedByRef: input.actor,
    updatedAt: now,
    deleted: false,
  }
  if (domain) {
    patch.domain = domain
    patch.website = `https://${domain}`
  }

  // Explicit pick from the acceptor — "link your org to THIS company of mine".
  if (input.preferCompanyId) {
    const ref = adminDb.collection('companies').doc(input.preferCompanyId)
    const snap = await ref.get()
    if (!snap.exists) throw new Error('Selected company not found')
    const data = snap.data() ?? {}
    if (data.orgId !== ownerOrgId) throw new Error('Selected company not found')
    const existingLink = cleanString(data.linkedOrgId)
    if (existingLink && existingLink !== representsOrgId) {
      throw new Error('That company is already linked to a different organisation')
    }
    await ref.set({
      linkedOrgId: representsOrgId,
      source: 'partner_link',
      allowedOrgIds: [ownerOrgId, representsOrgId],
      tags: mergeTags(data.tags, tags),
      updatedByRef: input.actor,
      updatedAt: now,
      deleted: false,
    }, { merge: true })
    return {
      companyId: ref.id,
      companyName: cleanString(data.name) || companyName,
      created: false,
    }
  }

  const snap = await adminDb.collection('companies')
    .where('orgId', '==', ownerOrgId)
    .limit(1000)
    .get()

  const normalizedName = normalizeComparable(companyName)
  const normalizedDomain = normalizeComparable(domain)
  const existing = snap.docs.find((doc) => {
    const data = doc.data() ?? {}
    if (data.deleted === true) return false
    if (cleanString(data.linkedOrgId) === representsOrgId) return true
    if (normalizedDomain && normalizeComparable(data.domain) === normalizedDomain) return true
    return normalizeComparable(data.name) === normalizedName
  })

  if (existing) {
    const data = existing.data() ?? {}
    await existing.ref.set({
      ...patch,
      // Never rename an existing company the acceptor already curates.
      name: cleanString(data.name) || companyName,
      tags: mergeTags(data.tags, tags),
    }, { merge: true })
    return {
      companyId: existing.id,
      companyName: cleanString(data.name) || companyName,
      created: false,
    }
  }

  const ref = adminDb.collection('companies').doc()
  await ref.set({
    ...patch,
    tags,
    notes: '',
    ownerUid: input.actor.uid,
    ownerRef: input.actor,
    createdByRef: input.actor,
    createdAt: now,
  })
  return { companyId: ref.id, companyName, created: true }
}

export interface MirrorContactResult {
  contactId: string
  created: boolean
}

/**
 * Ensure `ownerOrgId`'s CRM holds a contact for a person in the partner org.
 *
 * Match order: linkedUserId, then normalised email within the org. If the email
 * already exists under a *different* company we attach a ContactCompanyLink
 * rather than creating a duplicate — the contacts API 409s on duplicate email,
 * so a blind create would fail anyway.
 */
export async function ensureMirrorContact(input: {
  ownerOrgId: string
  companyId: string
  companyName: string
  linkedUserId?: string
  linkedOrgId: string
  email: string
  displayName: string
  actor: MemberRef
  tags?: string[]
}): Promise<MirrorContactResult | null> {
  const ownerOrgId = cleanString(input.ownerOrgId)
  const email = normalizeEmail(input.email)
  const linkedUserId = cleanString(input.linkedUserId)
  if (!ownerOrgId || (!email && !linkedUserId)) return null

  const now = Timestamp.now()
  const displayName = cleanString(input.displayName) || email || linkedUserId
  const tags = input.tags ?? ['partner-contact']

  const snap = await adminDb.collection('contacts')
    .where('orgId', '==', ownerOrgId)
    .limit(1000)
    .get()

  const existing = snap.docs.find((doc) => {
    const data = doc.data() ?? {}
    if (data.deleted === true) return false
    if (linkedUserId && cleanString(data.linkedUserId) === linkedUserId) return true
    return Boolean(email) && normalizeEmail(data.email) === email
  })

  const patch: Record<string, unknown> = {
    orgId: ownerOrgId,
    name: displayName,
    email,
    company: input.companyName,
    companyId: input.companyId,
    companyName: input.companyName,
    linkedOrgId: input.linkedOrgId,
    type: 'client',
    stage: 'won',
    source: 'manual',
    updatedByRef: input.actor,
    updatedAt: now,
    deleted: false,
  }
  if (linkedUserId) patch.linkedUserId = linkedUserId

  if (existing) {
    const data = existing.data() ?? {}
    const currentCompanyId = cleanString(data.companyId)
    const merged: Record<string, unknown> = {
      ...patch,
      tags: mergeTags(data.tags, tags),
    }

    if (currentCompanyId && currentCompanyId !== input.companyId) {
      // Keep the contact where the acceptor filed it; record the partner
      // company as an additional affiliation instead of moving them.
      const links = Array.isArray(data.companyLinks)
        ? (data.companyLinks as ContactCompanyLink[]).filter((l) => l && typeof l === 'object')
        : []
      const alreadyLinked = links.some((l) => l.companyId === input.companyId)
      merged.companyId = currentCompanyId
      merged.companyName = cleanString(data.companyName) || input.companyName
      merged.company = cleanString(data.company) || input.companyName
      if (!alreadyLinked) {
        merged.companyLinks = [
          ...links,
          {
            companyId: input.companyId,
            companyName: input.companyName,
            relationshipType: 'partner',
            primary: false,
          },
        ]
      }
    }

    await existing.ref.set(merged, { merge: true })
    return { contactId: existing.id, created: false }
  }

  const { firstName, lastName } = splitName(displayName)
  const ref = adminDb.collection('contacts').doc()
  await ref.set({
    ...patch,
    firstName,
    lastName,
    phone: '',
    website: '',
    tags,
    notes: '',
    assignedTo: '',
    capturedFromId: '',
    subscribedAt: now,
    unsubscribedAt: null,
    bouncedAt: null,
    lastContactedAt: null,
    ownerUid: input.actor.uid,
    ownerRef: input.actor,
    createdByRef: input.actor,
    createdAt: now,
  })
  return { contactId: ref.id, created: true }
}
