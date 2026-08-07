import { NextRequest } from 'next/server'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { apiError } from '@/lib/api/response'
import { isActiveOrgMembershipRow } from '@/lib/linked-computers/policy'
import { ROLE_RANK } from '@/lib/orgMembers/types'
import type { OrgRole } from '@/lib/organizations/types'

/**
 * Account/org resolution shared by the token-accept flows (partner invites and
 * the older invoice/project claim route). Extracted so there is exactly one
 * implementation of the three-state account branching, which is easy to get
 * subtly wrong.
 */

export function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function normalizeEmail(value: unknown): string {
  return cleanString(value).toLowerCase()
}

export function slugify(input: string, fallback = 'partner-workspace'): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || fallback
}

export function splitName(displayName: string): { firstName: string; lastName: string } {
  const [firstName = '', ...rest] = displayName.trim().split(/\s+/).filter(Boolean)
  return { firstName, lastName: rest.join(' ') }
}

export interface SessionUser {
  uid: string
  email?: string
}

export async function sessionUser(req: NextRequest): Promise<SessionUser | null> {
  const cookieName = process.env.SESSION_COOKIE_NAME ?? '__session'
  const cookie = req.cookies.get(cookieName)?.value
  if (!cookie) return null
  try {
    const decoded = await adminAuth.verifySessionCookie(cookie, true)
    return {
      uid: decoded.uid,
      email: typeof decoded.email === 'string' ? normalizeEmail(decoded.email) : undefined,
    }
  } catch {
    return null
  }
}

/**
 * Three account states:
 *  - live session      → reuse it
 *  - existing Auth user, no session → 409 { requiresSignIn: true }
 *  - no user           → create one from the supplied password
 *
 * `requireSessionEmailMatch` controls what happens when a signed-in visitor's
 * email differs from the invited address. The invoice/project claim flow
 * rejects outright; the partner-invite flow allows it through so an org
 * owner/admin can accept on the recipient's behalf, and gates it separately
 * with authorizeAccept().
 */
export async function resolveInviteUser(
  req: NextRequest,
  input: {
    email: string
    displayName: string
    password?: string
    requireSessionEmailMatch?: boolean
  },
): Promise<{ uid: string; fromSession: boolean } | { error: Response }> {
  const current = await sessionUser(req)
  const email = normalizeEmail(input.email)

  if (current) {
    if (input.requireSessionEmailMatch && current.email && current.email !== email) {
      return { error: apiError('Signed-in account does not match the claim email.', 403) }
    }
    return { uid: current.uid, fromSession: true }
  }

  try {
    await adminAuth.getUserByEmail(email)
    return {
      error: apiError('Sign in to accept this invitation with your existing account.', 409, {
        requiresSignIn: true,
      }),
    }
  } catch (err: unknown) {
    const code = (err as { code?: string } | null)?.code
    if (code !== 'auth/user-not-found') throw err
  }

  if (!input.password || input.password.length < 8) {
    return { error: apiError('password must be at least 8 characters', 400) }
  }

  const created = await adminAuth.createUser({
    email,
    displayName: input.displayName,
    password: input.password,
  })
  return { uid: created.uid, fromSession: false }
}

export async function uniqueOrgIdForName(
  baseName: string,
  prefix = 'partner',
): Promise<{ orgId: string; slug: string }> {
  const baseSlug = slugify(baseName)
  for (let i = 0; i < 20; i += 1) {
    const suffix = i === 0 ? '' : `-${i + 1}`
    const slug = `${baseSlug}${suffix}`.slice(0, 60)
    const existing = await adminDb
      .collection('organizations')
      .where('slug', '==', slug)
      .limit(1)
      .get()
    if (existing.empty) return { orgId: `${prefix}-${slug}`, slug }
  }
  const fallback = `${baseSlug}-${Math.floor(Date.now() / 1000).toString(36)}`
  return { orgId: `${prefix}-${fallback}`, slug: fallback }
}

export interface OrgMembershipRow {
  orgId: string
  role: OrgRole
}

/** Active org memberships for a uid, read from the canonical `orgMembers` collection. */
export async function activeMembershipsForUid(uid: string): Promise<OrgMembershipRow[]> {
  if (!uid) return []
  const snap = await adminDb.collection('orgMembers').where('uid', '==', uid).limit(200).get()
  const rows: OrgMembershipRow[] = []
  for (const doc of snap.docs) {
    const data = doc.data() ?? {}
    if (!isActiveOrgMembershipRow(data)) continue
    const orgId = cleanString(data.orgId)
    if (!orgId) continue
    rows.push({ orgId, role: (data.role as OrgRole | undefined) ?? 'viewer' })
  }
  return rows
}

export async function orgRoleFor(orgId: string, uid: string): Promise<OrgRole | null> {
  const snap = await adminDb.collection('orgMembers').doc(`${orgId}_${uid}`).get()
  if (!snap.exists) return null
  const data = snap.data() ?? {}
  if (!isActiveOrgMembershipRow(data)) return null
  return (data.role as OrgRole | undefined) ?? 'viewer'
}

export type AcceptAuthorization =
  | { ok: true; reason: 'recipient' | 'org_admin'; candidateOrgIds: string[] }
  | { ok: false; status: number; error: string }

/**
 * Who may accept an invite:
 *  1. the invited email itself, or
 *  2. an owner/admin of an org the invited email already belongs to — so the
 *     invite survives being forwarded from a staffer to the person who
 *     actually signs off.
 */
export async function authorizeAccept(input: {
  session: SessionUser
  recipientEmail: string
}): Promise<AcceptAuthorization> {
  const recipientEmail = normalizeEmail(input.recipientEmail)
  const sessionEmail = normalizeEmail(input.session.email)

  if (sessionEmail && sessionEmail === recipientEmail) {
    const memberships = await activeMembershipsForUid(input.session.uid)
    return { ok: true, reason: 'recipient', candidateOrgIds: memberships.map((m) => m.orgId) }
  }

  let recipientUid = ''
  try {
    const record = await adminAuth.getUserByEmail(recipientEmail)
    recipientUid = record.uid
  } catch {
    return {
      ok: false,
      status: 403,
      error: 'This invitation was sent to a different email address.',
    }
  }

  const recipientOrgIds = (await activeMembershipsForUid(recipientUid)).map((m) => m.orgId)
  if (recipientOrgIds.length === 0) {
    return {
      ok: false,
      status: 403,
      error: 'This invitation was sent to a different email address.',
    }
  }

  const adminOf: string[] = []
  for (const orgId of recipientOrgIds) {
    const role = await orgRoleFor(orgId, input.session.uid)
    if (role && ROLE_RANK[role] >= ROLE_RANK.admin) adminOf.push(orgId)
  }

  if (adminOf.length === 0) {
    return {
      ok: false,
      status: 403,
      error: 'Only the invited recipient or an owner/admin of their workspace can accept this invitation.',
    }
  }

  return { ok: true, reason: 'org_admin', candidateOrgIds: adminOf }
}

/**
 * Writes all three membership sources of truth together. They are written
 * separately in ~6 routes today and drift; keep them in one place for new code.
 */
export async function attachUserToOrg(input: {
  uid: string
  orgId: string
  role: OrgRole
  email: string
  displayName: string
  invitedBy?: string
}): Promise<void> {
  const now = FieldValue.serverTimestamp()
  const { firstName, lastName } = splitName(input.displayName)

  await adminDb.collection('organizations').doc(input.orgId).set({
    members: FieldValue.arrayUnion({
      userId: input.uid,
      role: input.role,
      joinedAt: Timestamp.now(),
      invitedBy: input.invitedBy ?? 'system:partner_invite',
    }),
    updatedAt: now,
  }, { merge: true })

  await adminDb.collection('orgMembers').doc(`${input.orgId}_${input.uid}`).set({
    orgId: input.orgId,
    uid: input.uid,
    firstName,
    lastName,
    role: input.role,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }, { merge: true })

  const userRef = adminDb.collection('users').doc(input.uid)
  const userSnap = await userRef.get()
  const existing = userSnap.exists ? userSnap.data() ?? {} : {}
  const existingOrgIds = Array.isArray(existing.orgIds)
    ? existing.orgIds.filter((v: unknown): v is string => typeof v === 'string' && v.length > 0)
    : (typeof existing.orgId === 'string' && existing.orgId ? [existing.orgId] : [])
  const nextOrgIds = existingOrgIds.includes(input.orgId)
    ? existingOrgIds
    : [...existingOrgIds, input.orgId]

  await userRef.set({
    uid: input.uid,
    email: input.email,
    displayName: input.displayName,
    role: typeof existing.role === 'string' && existing.role ? existing.role : 'client',
    orgId: typeof existing.orgId === 'string' && existing.orgId ? existing.orgId : input.orgId,
    orgIds: nextOrgIds,
    updatedAt: now,
    createdAt: userSnap.exists ? existing.createdAt ?? now : now,
  }, { merge: true })
}
