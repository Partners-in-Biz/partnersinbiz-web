import { NextRequest } from 'next/server'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { apiError, apiSuccess } from '@/lib/api/response'
import {
  applyClaimLinks,
  createPlatformLeadForClaim,
} from '@/lib/claimable-relationships/store'
import type { ClaimableRelationship } from '@/lib/claimable-relationships/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ claimToken: string }> }

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'claimed-business'
}

function splitName(displayName: string) {
  const [firstName = '', ...rest] = displayName.trim().split(/\s+/).filter(Boolean)
  return { firstName, lastName: rest.join(' ') }
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function resourceCollection(resourceType: ClaimableRelationship['resourceType']): 'invoices' | 'projects' {
  return resourceType === 'invoice' ? 'invoices' : 'projects'
}

async function loadPublicResource(data: ClaimableRelationship) {
  const snap = await adminDb.collection(resourceCollection(data.resourceType)).doc(data.resourceId).get()
  if (!snap.exists) return null
  const resource = snap.data() ?? {}

  if (data.resourceType === 'invoice') {
    return {
      id: snap.id,
      type: 'invoice',
      invoiceNumber: resource.invoiceNumber,
      status: resource.status,
      issueDate: resource.issueDate,
      dueDate: resource.dueDate,
      lineItems: resource.lineItems,
      subtotal: resource.subtotal,
      taxRate: resource.taxRate,
      taxAmount: resource.taxAmount,
      total: resource.total,
      currency: resource.currency,
      notes: resource.notes,
      fromDetails: resource.fromDetails,
      clientDetails: resource.clientDetails,
    }
  }

  return {
    id: snap.id,
    type: 'project',
    name: resource.name,
    description: resource.description,
    brief: resource.brief,
    status: resource.status,
    targetDate: resource.targetDate,
    recipientCompanyName: resource.recipientCompanyName,
  }
}

async function loadRelationship(claimToken: string): Promise<{ id: string; data: ClaimableRelationship } | null> {
  const snap = await adminDb
    .collection('claimable_relationships')
    .where('claimToken', '==', claimToken)
    .limit(1)
    .get()
  if (snap.empty) return null
  const doc = snap.docs[0]
  return { id: doc.id, data: { id: doc.id, ...(doc.data() as ClaimableRelationship) } }
}

async function uniqueClaimedOrgId(baseName: string): Promise<{ orgId: string; slug: string }> {
  const baseSlug = slugify(baseName)
  let slug = baseSlug
  for (let i = 0; i < 20; i += 1) {
    const suffix = i === 0 ? '' : `-${i + 1}`
    slug = `${baseSlug}${suffix}`.slice(0, 60)
    const existing = await adminDb
      .collection('organizations')
      .where('slug', '==', slug)
      .limit(1)
      .get()
    if (existing.empty) {
      return { orgId: `claimed-${slug}`, slug }
    }
  }
  const fallback = `${baseSlug}-${Date.now().toString(36)}`
  return { orgId: `claimed-${fallback}`, slug: fallback }
}

async function sessionUser(req: NextRequest): Promise<{ uid: string; email?: string } | null> {
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

async function createOrResolveClaimUser(req: NextRequest, input: {
  email: string
  displayName: string
  password?: string
}): Promise<{ uid: string; fromSession: boolean } | { error: Response }> {
  const currentUser = await sessionUser(req)
  const email = normalizeEmail(input.email)

  if (currentUser) {
    if (currentUser.email && currentUser.email !== email) {
      return { error: apiError('Signed-in account does not match the claim email.', 403) }
    }
    return { uid: currentUser.uid, fromSession: true }
  }

  try {
    await adminAuth.getUserByEmail(email)
    return { error: apiError('Sign in to claim this workspace with your existing account.', 409, { requiresSignIn: true }) }
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

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { claimToken } = await ctx.params
  if (!claimToken || claimToken.length < 12) return apiError('Invalid claim token', 400)

  const relationship = await loadRelationship(claimToken)
  if (!relationship) return apiError('Claim not found', 404)

  const { data } = relationship
  const resource = await loadPublicResource(data)
  return apiSuccess({
    id: relationship.id,
    status: data.status,
    recipientEmail: data.recipientEmail,
    recipientName: data.recipientName,
    recipientCompanyName: data.recipientCompanyName,
    resourceType: data.resourceType,
    resourceId: data.resourceId,
    resource,
    targetOrgId: data.targetOrgId,
  })
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { claimToken } = await ctx.params
  if (!claimToken || claimToken.length < 12) return apiError('Invalid claim token', 400)

  const loaded = await loadRelationship(claimToken)
  if (!loaded) return apiError('Claim not found', 404)
  const relationship = loaded.data
  if (relationship.status === 'revoked') return apiError('Claim has been revoked', 410)

  const body = await req.json().catch(() => ({}))
  const email = normalizeEmail(typeof body.email === 'string' ? body.email : relationship.recipientEmail)
  const displayName = typeof body.displayName === 'string' && body.displayName.trim()
    ? body.displayName.trim()
    : relationship.recipientName || email
  const businessName = typeof body.businessName === 'string' && body.businessName.trim()
    ? body.businessName.trim()
    : relationship.recipientCompanyName || displayName

  if (!email || email !== normalizeEmail(relationship.recipientEmail)) {
    return apiError('Claim email must match the invitation email', 400)
  }

  const userResult = await createOrResolveClaimUser(req, {
    email,
    displayName,
    password: typeof body.password === 'string' ? body.password : undefined,
  })
  if ('error' in userResult) return userResult.error

  const now = FieldValue.serverTimestamp()
  const userRef = adminDb.collection('users').doc(userResult.uid)
  const existingUserDoc = await userRef.get()
  const existingUser = existingUserDoc.exists ? existingUserDoc.data() ?? {} : {}
  const existingOrgIds = Array.isArray(existingUser.orgIds)
    ? existingUser.orgIds.filter((value: unknown): value is string => typeof value === 'string' && value.length > 0)
    : (typeof existingUser.orgId === 'string' ? [existingUser.orgId] : [])

  const requestedOrgId = cleanString(body.orgId)
  const sessionOrgId = userResult.fromSession
    ? requestedOrgId && existingOrgIds.includes(requestedOrgId)
      ? requestedOrgId
      : cleanString(existingUser.activeOrgId) || cleanString(existingUser.orgId) || existingOrgIds[0]
    : ''
  const { orgId, slug } = relationship.targetOrgId
    ? { orgId: relationship.targetOrgId, slug: slugify(businessName) }
    : sessionOrgId
      ? { orgId: sessionOrgId, slug: slugify(businessName) }
      : await uniqueClaimedOrgId(businessName)

  const orgRef = adminDb.collection('organizations').doc(orgId)
  const usingSessionOrg = !relationship.targetOrgId && Boolean(sessionOrgId)
  const usingLinkedTargetOrg = Boolean(relationship.targetOrgId)
  const linkedMemberRole = usingLinkedTargetOrg ? 'member' : 'owner'
  const orgPatch = usingSessionOrg
    ? {
        claimedRelationshipIds: FieldValue.arrayUnion(loaded.id),
        updatedAt: now,
      }
    : usingLinkedTargetOrg
      ? {
          claimedRelationshipIds: FieldValue.arrayUnion(loaded.id),
          members: FieldValue.arrayUnion({
            userId: userResult.uid,
            role: linkedMemberRole,
            joinedAt: Timestamp.now(),
            invitedBy: 'system:claimable_relationship',
          }),
          updatedAt: now,
        }
    : {
        name: businessName,
        slug,
        type: 'client',
        status: 'active',
        description: '',
        logoUrl: '',
        website: '',
        source: 'claimable_relationship',
        createdFromRelationshipId: loaded.id,
        createdFromSourceOrgId: relationship.sourceOrgId,
        active: true,
        members: [{
          userId: userResult.uid,
          role: 'owner',
          joinedAt: Timestamp.now(),
          invitedBy: 'system:claimable_relationship',
        }],
        settings: {
          timezone: 'Africa/Johannesburg',
          currency: 'ZAR',
          defaultApprovalRequired: true,
          notificationEmail: email,
        },
        createdAt: now,
        updatedAt: now,
      }
  await orgRef.set(orgPatch, { merge: true })

  const nextOrgIds = existingOrgIds.includes(orgId) ? existingOrgIds : [...existingOrgIds, orgId]

  await userRef.set({
    uid: userResult.uid,
    email,
    displayName,
    role: 'client',
    orgId: typeof existingUser.orgId === 'string' && existingUser.orgId ? existingUser.orgId : orgId,
    orgIds: nextOrgIds,
    updatedAt: now,
    createdAt: existingUserDoc.exists ? existingUser.createdAt ?? now : now,
  }, { merge: true })

  const { firstName, lastName } = splitName(displayName)
  if (!usingSessionOrg) {
    await adminDb.collection('orgMembers').doc(`${orgId}_${userResult.uid}`).set({
      orgId,
      uid: userResult.uid,
      firstName,
      lastName,
      role: linkedMemberRole,
      createdAt: now,
      updatedAt: now,
    }, { merge: true })
  }

  await applyClaimLinks({
    relationshipId: loaded.id,
    sourceOrgId: relationship.sourceOrgId,
    sourceCompanyId: relationship.sourceCompanyId,
    sourceContactId: relationship.sourceContactId,
    targetOrgId: orgId,
    targetUserId: userResult.uid,
    resourceType: relationship.resourceType,
    resourceId: relationship.resourceId,
  })

  await createPlatformLeadForClaim({
    targetOrgId: orgId,
    targetUserId: userResult.uid,
    businessName,
    contactName: displayName,
    contactEmail: email,
    sourceOrgId: relationship.sourceOrgId,
    resourceType: relationship.resourceType,
    resourceId: relationship.resourceId,
  }).catch((err) => {
    console.error('[claim-platform-lead-error]', err)
  })

  return apiSuccess({
    orgId,
    uid: userResult.uid,
    relationshipId: loaded.id,
    resourceType: relationship.resourceType,
    resourceId: relationship.resourceId,
  })
}
