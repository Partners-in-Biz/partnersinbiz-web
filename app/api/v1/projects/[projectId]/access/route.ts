import crypto from 'node:crypto'
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { ensureClaimableRelationship } from '@/lib/claimable-relationships/store'
import { getProjectForUser } from '@/lib/projects/access'
import {
  canProjectRole,
  normalizeProjectRole,
  projectMemberDocId,
  projectOrganizationDocId,
  type ProjectMemberRole,
} from '@/lib/projects/collaboration'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ projectId: string }> }

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function cleanEmail(value: unknown): string {
  return cleanString(value).toLowerCase()
}

function ownerOrgId(project: Record<string, unknown>): string {
  return cleanString(project.ownerOrgId) || cleanString(project.sourceOrgId) || cleanString(project.orgId)
}

function inviteDocId(projectId: string, invite: { contactId?: string; recipientEmail?: string; companyId?: string }): string {
  const raw = invite.contactId || invite.recipientEmail || invite.companyId || crypto.randomBytes(8).toString('hex')
  return `${projectId}_${raw.replace(/[/.#?[\]]/g, '_')}`
}

async function requireProjectManager(projectId: string, user: Parameters<typeof getProjectForUser>[1]) {
  const access = await getProjectForUser(projectId, user)
  if (!access.ok) return access
  const role = access.projectAccess?.role ?? 'viewer'
  if (!canProjectRole(role, 'manage_access')) {
    return { ok: false as const, status: 403, error: 'Project manager access is required' }
  }
  return access
}

async function listCollection(collectionName: string, projectId: string) {
  const snap = await adminDb.collection(collectionName).where('projectId', '==', projectId).get()
  return snap.docs.map((doc: { id: string; data: () => Record<string, unknown> }) => ({ id: doc.id, ...doc.data() }))
}

function displayNameFromMember(member: Record<string, unknown>, userData: Record<string, unknown>): string {
  const embeddedName = [cleanString(member.firstName), cleanString(member.lastName)].filter(Boolean).join(' ')
  return cleanString(userData.displayName) || cleanString(member.displayName) || embeddedName || cleanEmail(userData.email) || cleanEmail(member.email)
}

async function listOwnerMemberCandidates(project: Record<string, unknown>, role?: string) {
  if (!canProjectRole(role ?? 'viewer', 'manage_access')) return []

  const sourceOrgId = ownerOrgId(project)
  if (!sourceOrgId) return []

  const snap = await adminDb.collection('orgMembers').where('orgId', '==', sourceOrgId).get()
  const candidates = await Promise.all(
    snap.docs.map(async (doc: { id: string; data: () => Record<string, unknown> }) => {
      const member = doc.data() ?? {}
      const uid = cleanString(member.uid) || cleanString(member.userId)
      if (!uid) return null

      const userSnap = await adminDb.collection('users').doc(uid).get()
      const userData = userSnap.exists ? userSnap.data() ?? {} : {}
      return {
        id: doc.id,
        uid,
        displayName: displayNameFromMember(member, userData) || uid,
        email: cleanEmail(userData.email) || cleanEmail(member.email),
        role: cleanString(member.role) || 'member',
        photoURL: cleanString(userData.photoURL) || cleanString(member.photoURL),
      }
    }),
  )

  return candidates
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
    .sort((a, b) => (a.displayName || a.email || a.uid).localeCompare(b.displayName || b.email || b.uid))
}

export const GET = withAuth('client', async (_req: NextRequest, user, ctx) => {
  const { projectId } = await (ctx as RouteContext).params
  const access = await getProjectForUser(projectId, user)
  if (!access.ok) return apiError(access.error, access.status)

  const project = (access.doc.data() ?? {}) as Record<string, unknown>
  const [members, organizations, invites, memberCandidates] = await Promise.all([
    listCollection('projectMembers', projectId),
    listCollection('projectOrganizations', projectId),
    listCollection('projectInvites', projectId),
    listOwnerMemberCandidates(project, access.projectAccess?.role),
  ])

  return apiSuccess({
    access: access.projectAccess,
    members,
    organizations,
    invites,
    memberCandidates,
  })
})

export const POST = withAuth('client', async (req: NextRequest, user, ctx) => {
  const { projectId } = await (ctx as RouteContext).params
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const access = await requireProjectManager(projectId, user)
  if (!access.ok) return apiError(access.error, access.status)

  const project = (access.doc.data() ?? {}) as Record<string, unknown>
  const sourceOrgId = ownerOrgId(project)
  if (!sourceOrgId) return apiError('Project owner organisation is missing', 400)

  if (body.action === 'add_member') {
    const uid = cleanString(body.uid ?? body.userId)
    if (!uid) return apiError('uid is required', 400)

    const memberSnap = await adminDb.collection('orgMembers').doc(`${sourceOrgId}_${uid}`).get()
    if (!memberSnap.exists) {
      return apiError('User must belong to the project owner organisation before they can be added to the project', 400)
    }

    const role = normalizeProjectRole(body.role)
    const userSnap = await adminDb.collection('users').doc(uid).get()
    const userData = userSnap.exists ? userSnap.data() ?? {} : {}
    const payload = {
      projectId,
      uid,
      orgId: sourceOrgId,
      role,
      status: 'active',
      memberType: 'internal',
      displayName: cleanString(userData.displayName),
      email: cleanEmail(userData.email),
      invitedBy: user.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }

    await adminDb.collection('projectMembers').doc(projectMemberDocId(projectId, uid)).set(payload, { merge: true })
    return apiSuccess(payload, 201)
  }

  if (body.action === 'invite_organizations') {
    const rawInvites = Array.isArray(body.invites) ? body.invites : [body]
    const results: Array<Record<string, unknown>> = []

    for (const rawInvite of rawInvites) {
      const invite = rawInvite && typeof rawInvite === 'object' ? rawInvite as Record<string, unknown> : {}
      const companyId = cleanString(invite.companyId)
      const contactId = cleanString(invite.contactId)
      if (!companyId) return apiError('companyId is required for each organisation invite', 400)

      const companySnap = await adminDb.collection('companies').doc(companyId).get()
      if (!companySnap.exists) return apiError(`CRM company not found: ${companyId}`, 404)
      const company = companySnap.data() ?? {}
      if (company.orgId !== sourceOrgId) return apiError('CRM company does not belong to the project owner organisation', 400)

      let contact: Record<string, unknown> = {}
      if (contactId) {
        const contactSnap = await adminDb.collection('contacts').doc(contactId).get()
        if (!contactSnap.exists) return apiError(`CRM contact not found: ${contactId}`, 404)
        contact = contactSnap.data() ?? {}
        if (contact.orgId !== sourceOrgId) return apiError('CRM contact does not belong to the project owner organisation', 400)
      }

      const role: ProjectMemberRole = normalizeProjectRole(invite.role)
      const recipientEmail = cleanEmail(invite.recipientEmail) || cleanEmail(contact.email) || cleanEmail(company.email)
      const recipientName = cleanString(invite.recipientName) || cleanString(contact.name) || recipientEmail
      const recipientCompanyName = cleanString(invite.recipientCompanyName) || cleanString(company.name) || recipientName
      if (!recipientEmail) return apiError('recipientEmail is required for each project invite', 400)

      const relationship = await ensureClaimableRelationship({
        sourceOrgId,
        sourceCompanyId: companyId,
        sourceContactId: contactId || undefined,
        recipientOrgId: cleanString(invite.recipientOrgId) || cleanString(company.linkedOrgId) || undefined,
        recipientUserId: cleanString(invite.recipientUserId) || cleanString(contact.linkedUserId) || undefined,
        recipientEmail,
        recipientName,
        recipientCompanyName,
        resourceType: 'project',
        resourceId: projectId,
      })

      const linkedOrgId = cleanString(relationship.targetOrgId)
      const linkedUserId = cleanString(relationship.targetUserId)
      const status = linkedOrgId ? 'active' : 'pending'
      const now = FieldValue.serverTimestamp()
      const orgAccessId = linkedOrgId || companyId
      const organizationPayload = {
        projectId,
        orgId: linkedOrgId || undefined,
        companyId,
        contactId: contactId || undefined,
        role,
        status,
        recipientEmail: recipientEmail || undefined,
        recipientName: recipientName || undefined,
        recipientCompanyName: recipientCompanyName || undefined,
        invitedBy: user.uid,
        createdAt: now,
        updatedAt: now,
      }

      await adminDb
        .collection('projectOrganizations')
        .doc(projectOrganizationDocId(projectId, orgAccessId))
        .set(Object.fromEntries(Object.entries(organizationPayload).filter(([, value]) => value !== undefined)), { merge: true })

      if (linkedOrgId && linkedUserId) {
        await adminDb.collection('projectMembers').doc(projectMemberDocId(projectId, linkedUserId)).set({
          projectId,
          uid: linkedUserId,
          orgId: linkedOrgId,
          role,
          status: 'active',
          memberType: 'external',
          email: recipientEmail || undefined,
          displayName: recipientName || undefined,
          invitedBy: user.uid,
          createdAt: now,
          updatedAt: now,
        }, { merge: true })
      }

      const invitePayload = {
        projectId,
        companyId,
        contactId: contactId || undefined,
        orgId: linkedOrgId || undefined,
        uid: linkedUserId || undefined,
        role,
        recipientEmail: recipientEmail || undefined,
        recipientName: recipientName || undefined,
        recipientCompanyName: recipientCompanyName || undefined,
        claimableRelationshipId: relationship.id,
        claimToken: relationship.claimToken,
        status: relationship.status === 'claimed' || linkedOrgId ? 'claimed' : 'pending',
        invitedBy: user.uid,
        createdAt: now,
        updatedAt: now,
      }

      await adminDb
        .collection('projectInvites')
        .doc(inviteDocId(projectId, { contactId, recipientEmail, companyId }))
        .set(Object.fromEntries(Object.entries(invitePayload).filter(([, value]) => value !== undefined)), { merge: true })

      results.push({
        companyId,
        contactId: contactId || null,
        orgId: linkedOrgId || null,
        uid: linkedUserId || null,
        role,
        status,
        claimToken: relationship.claimToken,
      })
    }

    return apiSuccess({ invites: results }, 201)
  }

  return apiError('Unsupported project access action', 400)
})
