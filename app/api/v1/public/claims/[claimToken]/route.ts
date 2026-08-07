import { NextRequest } from 'next/server'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { apiError, apiSuccess } from '@/lib/api/response'
import {
  applyClaimLinks,
  createPlatformLeadForClaim,
} from '@/lib/claimable-relationships/store'
import type { ClaimableRelationship } from '@/lib/claimable-relationships/types'
import { enforcePublicRateLimit, publicRequestIp, publicRateLimitHash } from '@/lib/api/public-rate-limit'
import {
  cleanString,
  normalizeEmail,
  resolveInviteUser,
  slugify as baseSlugify,
  splitName,
  uniqueOrgIdForName,
} from '@/lib/partner-links/identity'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ claimToken: string }> }

function slugify(input: string): string {
  return baseSlugify(input, 'claimed-business')
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
  return uniqueOrgIdForName(baseName, 'claimed')
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { claimToken } = await ctx.params
  if (!claimToken || claimToken.length < 12) return apiError('Invalid claim token', 400)
  // PUBLIC: claim invitation preview protected by claim token.
  const limited = await enforcePublicRateLimit(req, {
    key: `claim_view:${publicRateLimitHash(claimToken)}:${publicRequestIp(req)}`,
    limit: 120,
    windowMs: 60 * 60 * 1000,
  })
  if (limited) return limited

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
  const claimLimited = await enforcePublicRateLimit(req, {
    key: `claim_submit:${publicRateLimitHash(claimToken)}:${publicRequestIp(req)}`,
    limit: 20,
    windowMs: 60 * 60 * 1000,
  })
  if (claimLimited) return claimLimited

  const loaded = await loadRelationship(claimToken)
  if (!loaded) return apiError('Claim not found', 404)
  const relationship = loaded.data
  if (relationship.status === 'revoked') return apiError('Claim has been revoked', 410)

  const body = await req.json().catch(() => ({}))
  const email = normalizeEmail(typeof body.email === 'string' ? body.email : relationship.recipientEmail)
  if (email) {
    const emailLimited = await enforcePublicRateLimit(req, {
      key: `claim_submit_email:${publicRateLimitHash(claimToken)}:${publicRateLimitHash(email)}`,
      limit: 10,
      windowMs: 60 * 60 * 1000,
    })
    if (emailLimited) return emailLimited
  }
  const displayName = typeof body.displayName === 'string' && body.displayName.trim()
    ? body.displayName.trim()
    : relationship.recipientName || email
  const businessName = typeof body.businessName === 'string' && body.businessName.trim()
    ? body.businessName.trim()
    : relationship.recipientCompanyName || displayName

  if (!email || email !== normalizeEmail(relationship.recipientEmail)) {
    return apiError('Claim email must match the invitation email', 400)
  }

  const userResult = await resolveInviteUser(req, {
    email,
    displayName,
    password: typeof body.password === 'string' ? body.password : undefined,
    // Preserve the claim flow's stricter rule: a signed-in visitor whose email
    // differs from the claim address is rejected outright.
    requireSessionEmailMatch: true,
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
