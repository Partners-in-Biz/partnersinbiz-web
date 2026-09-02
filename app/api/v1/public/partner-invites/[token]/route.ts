import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import {
  enforcePublicRateLimit,
  publicRateLimitHash,
  publicRequestIp,
} from '@/lib/api/public-rate-limit'
import { buildHumanRef, type MemberRef } from '@/lib/orgMembers/memberRef'
import {
  activeMembershipsForUid,
  attachUserToOrg,
  authorizeAccept,
  cleanString,
  resolveInviteUser,
  sessionUser,
  slugify,
  uniqueOrgIdForName,
} from '@/lib/partner-links/identity'
import {
  acceptPartnerInvite,
  declinePartnerInvite,
  getPartnerInviteByToken,
} from '@/lib/partner-links/store'
import { isPartnerInviteExpired, type PartnerInvite } from '@/lib/partner-links/types'
import type { OrgRole } from '@/lib/organizations/types'
import type { SharedBusinessCapability } from '@/lib/business-relationships/types'
import { COMPANY_WORKSPACE_MODULES } from '@/lib/company-work/module-keys'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ token: string }> }

function normalizeComparable(value: unknown): string {
  return cleanString(value).toLowerCase()
}

function domainOf(value: unknown): string {
  const raw = cleanString(value)
  if (!raw) return ''
  return raw.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
}

/** Blocks accept/decline on anything that is not an open, unexpired invite. */
function inviteGate(invite: PartnerInvite): Response | null {
  if (invite.status === 'revoked') return apiError('This invitation has been revoked', 410)
  if (invite.status === 'accepted') return apiError('This invitation has already been accepted', 409)
  if (invite.status === 'declined') return apiError('This invitation was declined', 409)
  if (invite.status === 'expired' || isPartnerInviteExpired(invite)) {
    return apiError('This invitation has expired', 410)
  }
  return null
}

async function orgSummary(orgId: string): Promise<{ id: string; name: string } | null> {
  const snap = await adminDb.collection('organizations').doc(orgId).get()
  if (!snap.exists) return null
  return { id: orgId, name: cleanString((snap.data() ?? {}).name) || orgId }
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  try {
    const { token } = await ctx.params
    if (!token || token.length < 12) return apiError('Invalid invitation token', 400)

    // PUBLIC: invitation preview, protected by the invite token.
    const limited = await enforcePublicRateLimit(req, {
      key: `partner_invite_view:${publicRateLimitHash(token)}:${publicRequestIp(req)}`,
      limit: 120,
      windowMs: 60 * 60 * 1000,
    })
    if (limited) return limited

    const invite = await getPartnerInviteByToken(token)
    if (!invite) return apiError('Invitation not found', 404)

    const inviterOrg = await orgSummary(invite.sourceOrgId)
    const session = await sessionUser(req)

    // Signed-in visitors get their own workspaces plus a fuzzy-matched company
    // shortlist, so the UI can offer "link to this company I already have".
    let candidateOrgs: Array<{ id: string; name: string; role: OrgRole }> = []
    let companies: Array<{ id: string; name: string; domain?: string; suggested: boolean; alreadyLinked: boolean }> = []
    let selectedOrgId = ''

    if (session) {
      const memberships = await activeMembershipsForUid(session.uid)
      const summaries = await Promise.all(memberships.map(async (m) => {
        const summary = await orgSummary(m.orgId)
        return summary ? { id: m.orgId, name: summary.name, role: m.role } : null
      }))
      candidateOrgs = summaries.filter((row): row is { id: string; name: string; role: OrgRole } => row !== null)

      const requestedOrgId = cleanString(req.nextUrl.searchParams.get('orgId'))
      selectedOrgId = requestedOrgId && candidateOrgs.some((o) => o.id === requestedOrgId)
        ? requestedOrgId
        : candidateOrgs[0]?.id ?? ''

      if (selectedOrgId) {
        const inviterName = normalizeComparable(inviterOrg?.name)
        const inviterDomain = domainOf((await adminDb.collection('organizations').doc(invite.sourceOrgId).get()).data()?.website)
        const snap = await adminDb.collection('companies')
          .where('orgId', '==', selectedOrgId)
          .limit(1000)
          .get()
        companies = snap.docs
          .filter((doc) => (doc.data() ?? {}).deleted !== true)
          .map((doc) => {
            const data = doc.data() ?? {}
            const name = cleanString(data.name)
            const domain = domainOf(data.domain)
            const suggested = Boolean(
              (inviterDomain && domain && domain === inviterDomain) ||
              (inviterName && normalizeComparable(name) === inviterName),
            )
            return {
              id: doc.id,
              name,
              domain: domain || undefined,
              suggested,
              alreadyLinked: Boolean(cleanString(data.linkedOrgId)),
            }
          })
          .sort((a, b) => (Number(b.suggested) - Number(a.suggested)) || a.name.localeCompare(b.name))
          .slice(0, 100)
      }
    }

    return apiSuccess({
      status: invite.status,
      expired: isPartnerInviteExpired(invite),
      kind: invite.kind,
      recipientEmail: invite.recipientEmail,
      recipientName: invite.recipientName,
      recipientCompanyName: invite.recipientCompanyName,
      message: invite.message,
      expiresAt: invite.expiresAt,
      inviterOrgName: inviterOrg?.name ?? invite.sourceOrgId,
      inviterName: invite.inviterName,
      proposedCapabilities: invite.proposedCapabilities ?? [],
      proposedFieldSharingPolicy: invite.proposedFieldSharingPolicy ?? {},
      signedIn: Boolean(session),
      sessionEmail: session?.email,
      candidateOrgs,
      selectedOrgId,
      companies,
    })
  } catch (err) {
    return apiErrorFromException(err)
  }
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const { token } = await ctx.params
    if (!token || token.length < 12) return apiError('Invalid invitation token', 400)

    const limited = await enforcePublicRateLimit(req, {
      key: `partner_invite_submit:${publicRateLimitHash(token)}:${publicRequestIp(req)}`,
      limit: 20,
      windowMs: 60 * 60 * 1000,
      failClosed: true,
    })
    if (limited) return limited

    const invite = await getPartnerInviteByToken(token)
    if (!invite) return apiError('Invitation not found', 404)
    const gate = inviteGate(invite)
    if (gate) return gate

    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const action = cleanString(body.action) || 'accept'

    const emailLimited = await enforcePublicRateLimit(req, {
      key: `partner_invite_email:${publicRateLimitHash(token)}:${publicRateLimitHash(invite.recipientEmail)}`,
      limit: 10,
      windowMs: 60 * 60 * 1000,
      failClosed: true,
    })
    if (emailLimited) return emailLimited

    const existingSession = await sessionUser(req)

    // --- Decline -----------------------------------------------------------
    if (action === 'decline') {
      if (!existingSession) return apiError('Sign in to decline this invitation', 401, { requiresSignIn: true })
      const auth = await authorizeAccept({ session: existingSession, recipientEmail: invite.recipientEmail })
      if (!auth.ok) return apiError(auth.error, auth.status)
      const actor = await memberRefFor(existingSession.uid)
      await declinePartnerInvite({ invite, actor, declinedByUserId: existingSession.uid })
      return apiSuccess({ id: invite.id, status: 'declined' })
    }

    if (action !== 'accept') return apiError('Unsupported action — use "accept" or "decline"', 400)

    // --- Identity ----------------------------------------------------------
    const displayName = cleanString(body.displayName)
      || invite.recipientName
      || invite.recipientEmail
    const businessName = cleanString(body.businessName)
      || invite.recipientCompanyName
      || displayName

    // The APPROVER is whoever clicked accept. The RECIPIENT identity is the
    // invited person's user id — it is only linked to the invited contact when
    // the accepting session's email matches the invite email. An owner/admin
    // accepting on the recipient's behalf is recorded as the approver and
    // never becomes the invited contact's linked user.
    let approverUid: string
    let recipientUid = ''
    let candidateOrgIds: string[] = []

    if (existingSession) {
      const auth = await authorizeAccept({ session: existingSession, recipientEmail: invite.recipientEmail })
      if (!auth.ok) return apiError(auth.error, auth.status)
      approverUid = existingSession.uid
      if (auth.reason === 'recipient') {
        recipientUid = existingSession.uid
      }
      candidateOrgIds = auth.candidateOrgIds
    } else {
      // No session: only the invited address itself can proceed, so the
      // newly created account IS the recipient identity.
      const resolved = await resolveInviteUser(req, {
        email: invite.recipientEmail,
        displayName,
        password: typeof body.password === 'string' ? body.password : undefined,
      })
      if ('error' in resolved) return resolved.error
      approverUid = resolved.uid
      recipientUid = resolved.uid
    }

    // --- Target workspace ---------------------------------------------------
    const requestedOrgId = cleanString(body.orgId)
    let targetOrgId = ''

    if (requestedOrgId) {
      if (!candidateOrgIds.includes(requestedOrgId)) {
        return apiError('You do not have permission to link that workspace', 403)
      }
      targetOrgId = requestedOrgId
    } else if (candidateOrgIds.length === 1) {
      targetOrgId = candidateOrgIds[0]
    } else if (candidateOrgIds.length > 1) {
      return apiError('Choose which workspace should be linked', 400, {
        requiresOrgChoice: true,
        orgIds: candidateOrgIds,
      })
    }

    if (targetOrgId === invite.sourceOrgId) {
      return apiError('You cannot link a workspace to itself', 400)
    }

    let createdOrg = false
    if (!targetOrgId) {
      const { orgId, slug } = await uniqueOrgIdForName(businessName)
      const now = FieldValue.serverTimestamp()
      await adminDb.collection('organizations').doc(orgId).set({
        name: businessName,
        slug: slug || slugify(businessName),
        type: 'client',
        status: 'active',
        description: '',
        logoUrl: '',
        website: '',
        source: 'partner_invite',
        createdBy: recipientUid || approverUid,
        createdFromInviteId: invite.id,
        createdFromSourceOrgId: invite.sourceOrgId,
        active: true,
        members: [],
        settings: {
          timezone: 'Africa/Johannesburg',
          currency: 'ZAR',
          defaultApprovalRequired: true,
          notificationEmail: invite.recipientEmail,
        },
        createdAt: now,
        updatedAt: now,
      }, { merge: true })
      targetOrgId = orgId
      createdOrg = true
    }

    // Only attach membership for a workspace we just created. When targetOrgId
    // came from candidateOrgIds the accepter is ALREADY an active member, and
    // re-writing the role here would silently downgrade an owner to a member.
    // A new workspace is only created when the RECIPIENT identity accepted
    // (no existing memberships), so the owner is the recipient.
    if (createdOrg) {
      await attachUserToOrg({
        uid: recipientUid || approverUid,
        orgId: targetOrgId,
        role: 'owner',
        email: invite.recipientEmail,
        displayName,
        invitedBy: 'system:partner_invite',
      })
    }

    const actor = await memberRefFor(approverUid)
    const allowedModules = new Set(COMPANY_WORKSPACE_MODULES as string[])
    const bodyCapabilities = Array.isArray(body.capabilities)
      ? body.capabilities
          .map((value) => cleanString(value))
          .filter((value): value is SharedBusinessCapability => allowedModules.has(value))
      : undefined
    const result = await acceptPartnerInvite({
      invite,
      targetOrgId,
      targetUserId: recipientUid || undefined,
      approvedByUserId: approverUid,
      recipientIdentityMatched: Boolean(recipientUid),
      preferTargetCompanyId: cleanString(body.preferTargetCompanyId) || undefined,
      ...(bodyCapabilities && bodyCapabilities.length > 0 ? { capabilities: bodyCapabilities } : {}),
      actor,
    })

    return apiSuccess({
      ...result,
      uid: approverUid,
      recipientLinked: Boolean(recipientUid),
      createdOrg,
      inviteId: invite.id,
    })
  } catch (err) {
    return apiErrorFromException(err)
  }
}

async function memberRefFor(uid: string): Promise<MemberRef> {
  const snap = await adminDb.collection('users').doc(uid).get()
  return buildHumanRef(uid, snap.exists ? snap.data() : undefined)
}
