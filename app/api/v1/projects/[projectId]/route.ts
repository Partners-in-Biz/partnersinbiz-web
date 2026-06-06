/**
 * GET   /api/v1/projects/[projectId]  — get a single project
 * PATCH /api/v1/projects/[projectId]  — update a project
 */
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { getProjectForUser } from '@/lib/projects/access'
import { logActivity } from '@/lib/activity/log'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { normalizeProjectLinks, pickProjectLinkFields, type ProjectLinkSet } from '@/lib/client-documents/linkedValidation'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ projectId: string }> }

const VALID_STATUSES = [
  'discovery',
  'design',
  'development',
  'review',
  'live',
  'maintenance',
] as const

type ProjectStatus = (typeof VALID_STATUSES)[number]

type LinkSafetyUser = Parameters<typeof canAccessOrg>[0]

async function loadOwnedCrmRecord(collection: 'companies' | 'contacts', id: string, orgId: string) {
  const snap = await adminDb.collection(collection).doc(id).get()
  if (!snap.exists) return null
  const data = (snap.data() ?? {}) as Record<string, unknown>
  if (data.deleted === true) return null
  return data.orgId === orgId ? data : null
}

async function assertProjectPatchLinkTenantSafety(
  links: ProjectLinkSet,
  sourceOrgId: string,
  user: LinkSafetyUser,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const linkedOrgIds = Array.from(new Set([...(links.recipientOrgIds ?? []), ...(links.clientOrgIds ?? [])]))
  for (const orgId of linkedOrgIds) {
    if (!canAccessOrg(user, orgId)) return { ok: false, error: `Forbidden linked recipient org: ${orgId}`, status: 403 }
  }

  const companyIds = Array.from(new Set([...(links.companyIds ?? []), ...(links.sourceCompanyIds ?? [])]))
  for (const companyId of companyIds) {
    const company = await loadOwnedCrmRecord('companies', companyId, sourceOrgId)
    if (!company) return { ok: false, error: `Project company link is outside the source org: ${companyId}`, status: 400 }
  }

  const contactIds = Array.from(new Set([...(links.contactIds ?? []), ...(links.sourceContactIds ?? [])]))
  for (const contactId of contactIds) {
    const contact = await loadOwnedCrmRecord('contacts', contactId, sourceOrgId)
    if (!contact) return { ok: false, error: `Project contact link is outside the source org: ${contactId}`, status: 400 }
  }

  return { ok: true }
}

export const GET = withAuth('client', async (req: NextRequest, user, ctx) => {
  const { projectId } = await (ctx as RouteContext).params
  const access = await getProjectForUser(projectId, user)

  if (!access.ok) return apiError(access.error, access.status)
  const doc = access.doc
  return apiSuccess({ id: doc.id, ...doc.data() })
})

export const PATCH = withAuth('client', async (req: NextRequest, user, ctx) => {
  const { projectId } = await (ctx as RouteContext).params
  const body = await req.json().catch(() => ({}))
  const access = await getProjectForUser(projectId, user)
  if (!access.ok) return apiError(access.error, access.status)

  const updates: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() }

  if (body.name !== undefined) {
    if (!body.name.trim()) return apiError('name cannot be empty', 400)
    updates.name = body.name.trim()
  }

  if (body.status !== undefined) {
    if (!VALID_STATUSES.includes(body.status as ProjectStatus)) {
      return apiError('Invalid status', 400)
    }
    updates.status = body.status
  }

  if (body.archived !== undefined) {
    updates.archived = body.archived === true
    updates.archivedAt = body.archived === true ? FieldValue.serverTimestamp() : null
    updates.archivedBy = body.archived === true ? user.uid : null
  }

  if (body.description !== undefined) {
    updates.description = body.description
  }

  if (body.brief !== undefined) {
    updates.brief = body.brief
  }

  const orgId = access.doc.data()?.orgId as string | undefined
  const sourceOrgId = (access.doc.data()?.sourceOrgId as string | undefined) || orgId
  const requestedLinks = pickProjectLinkFields(body)
  if (Object.keys(requestedLinks).length > 0) {
    const existing = access.doc.data() ?? {}
    const requestedProjectLinks = { ...requestedLinks }
    if (requestedProjectLinks.sourceCompanyId !== undefined && requestedProjectLinks.companyId === undefined) {
      requestedProjectLinks.companyId = requestedProjectLinks.sourceCompanyId
    }
    if (requestedProjectLinks.sourceContactId !== undefined && requestedProjectLinks.contactId === undefined) {
      requestedProjectLinks.contactId = requestedProjectLinks.sourceContactId
    }
    const normalizedLinks = normalizeProjectLinks({ ...pickProjectLinkFields(existing), ...requestedProjectLinks })
    if (normalizedLinks.ok === false) return apiError(normalizedLinks.error, 400)
    if (sourceOrgId) {
      const linkSafety = await assertProjectPatchLinkTenantSafety(normalizedLinks.value, sourceOrgId, user)
      if (linkSafety.ok === false) return apiError(linkSafety.error, linkSafety.status)
    }
    Object.assign(updates, normalizedLinks.value)
  }

  await adminDb.collection('projects').doc(projectId).update(updates)

  if (orgId) {
    logActivity({
      orgId,
      type: 'project_updated',
      actorId: user.uid,
      actorName: user.uid,
      actorRole: user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client',
      description: 'Updated project',
      entityId: projectId,
      entityType: 'project',
      entityTitle: (updates.name as string | undefined) ?? undefined,
    }).catch(() => {})
  }

  return apiSuccess({ id: projectId, ...updates })
})
