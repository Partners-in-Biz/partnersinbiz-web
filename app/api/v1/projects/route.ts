/**
 * GET  /api/v1/projects  — list projects (admin all/scoped, client own org)
 * POST /api/v1/projects  — create a new project (admin selected org, client own org)
 */
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import type * as FirebaseFirestore from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { logActivity } from '@/lib/activity/log'
import { canAccessOrg, restrictedAdminOrgIds } from '@/lib/api/platformAdmin'
import { ensureClaimableRelationship } from '@/lib/claimable-relationships/store'
import {
  ensurePlatformCompanyForOrg,
  resolvePlatformOwnerOrgId,
} from '@/lib/platform-owner/relationships'
import { canAccessProject } from '@/lib/projects/access'
import { ensureProjectOwnerMembership } from '@/lib/projects/collaboration'

const VALID_STATUSES = [
  'discovery',
  'design',
  'development',
  'review',
  'live',
  'maintenance',
] as const

type ProjectStatus = (typeof VALID_STATUSES)[number]

type ProjectListItem = {
  id: string
  createdAt?: unknown
  [key: string]: unknown
}

type ProjectArchiveMode = 'active' | 'only' | 'include'

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false
  return Object.getPrototypeOf(value) === Object.prototype
}

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)) as T
  }

  if (!isPlainRecord(value)) return value

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .map(([key, entryValue]) => [key, stripUndefined(entryValue)]),
  ) as T
}

function normalizeEmail(value: unknown): string {
  return cleanString(value).toLowerCase()
}

function explicitAdminOrgIds(user: { allowedOrgIds?: string[] | null }): string[] {
  if (!Array.isArray(user.allowedOrgIds) || user.allowedOrgIds.length === 0) return []
  const ids = new Set<string>()
  for (const orgId of user.allowedOrgIds) {
    if (orgId) ids.add(orgId)
  }
  return Array.from(ids)
}

function hasClaimableTarget(body: Record<string, unknown>): boolean {
  return Boolean(
    cleanString(body.companyId) ||
    cleanString(body.contactId) ||
    cleanString(body.recipientEmail) ||
    cleanString(body.recipientOrgId),
  )
}

async function loadOwnedCrmRecord(
  collectionName: 'companies' | 'contacts',
  id: string,
  orgId: string,
): Promise<Record<string, unknown> | null> {
  if (!id) return null
  const snap = await adminDb.collection(collectionName).doc(id).get()
  if (!snap.exists) return null
  const data = (snap.data() ?? {}) as Record<string, unknown>
  return data.orgId === orgId ? data : null
}

async function resolveProjectCrmTarget(body: Record<string, unknown>, sourceOrgId: string) {
  const companyId = cleanString(body.companyId)
  const contactId = cleanString(body.contactId)
  const [company, contact] = await Promise.all([
    loadOwnedCrmRecord('companies', companyId, sourceOrgId),
    loadOwnedCrmRecord('contacts', contactId, sourceOrgId),
  ])

  const recipientEmail = normalizeEmail(body.recipientEmail ?? contact?.email ?? company?.email)
  const recipientName = cleanString(body.recipientName) ||
    cleanString(contact?.name) ||
    recipientEmail
  const recipientCompanyName = cleanString(body.recipientCompanyName) ||
    cleanString(company?.name) ||
    cleanString(contact?.companyName) ||
    cleanString(contact?.company) ||
    recipientName
  const recipientOrgId = cleanString(body.recipientOrgId) || cleanString(company?.linkedOrgId)
  const recipientUserId = cleanString(body.recipientUserId) || cleanString(contact?.linkedUserId)

  return {
    companyId,
    contactId,
    company,
    contact,
    recipientEmail,
    recipientName,
    recipientCompanyName,
    recipientOrgId,
    recipientUserId,
  }
}

function createdAtMillis(value: unknown): number {
  if (!value) return 0
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  if (typeof value === 'object') {
    const timestamp = value as {
      toMillis?: () => number
      seconds?: number
      _seconds?: number
    }
    if (typeof timestamp.toMillis === 'function') return timestamp.toMillis()
    const seconds = timestamp.seconds ?? timestamp._seconds
    if (typeof seconds === 'number') return seconds * 1000
  }
  return 0
}

function projectStatus(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function isCompletedProject(project: ProjectListItem): boolean {
  return projectStatus(project.status) === 'completed'
}

function isHistoricalProject(project: ProjectListItem): boolean {
  return project.archived === true || isCompletedProject(project)
}

function archiveMode(value: string | null): ProjectArchiveMode {
  if (value === 'only' || value === 'include') return value
  return 'active'
}

function filterProjectByArchiveMode(project: ProjectListItem, mode: ProjectArchiveMode): boolean {
  if (project.deleted === true) return false
  if (mode === 'include') return true
  const historical = isHistoricalProject(project)
  return mode === 'only' ? historical : !historical
}

async function loadClientVisibleProjectsForOrg(orgId: string): Promise<ProjectListItem[]> {
  const [receivedSnap, targetSnap, clientSnap, legacySnap] = await Promise.all([
    adminDb.collection('projects').where('recipientOrgId', '==', orgId).get(),
    adminDb.collection('projects').where('targetOrgId', '==', orgId).get(),
    adminDb.collection('projects').where('clientOrgId', '==', orgId).get(),
    adminDb.collection('projects').where('orgId', '==', orgId).get(),
  ])
  const byId = new Map<string, ProjectListItem>()
  for (const snap of [receivedSnap, targetSnap, clientSnap, legacySnap]) {
    for (const doc of snap.docs) {
      byId.set(doc.id, { id: doc.id, ...doc.data() })
    }
  }
  return Array.from(byId.values())
}

async function loadClientVisibleProjectsForOrgs(orgIds: string[]): Promise<ProjectListItem[]> {
  const byId = new Map<string, ProjectListItem>()
  const uniqueOrgIds = Array.from(new Set(orgIds.filter(Boolean)))
  const results = await Promise.all(uniqueOrgIds.map((orgId) => loadClientVisibleProjectsForOrg(orgId)))
  for (const projects of results) {
    for (const project of projects) byId.set(project.id, project)
  }
  return Array.from(byId.values())
}

export const GET = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const { searchParams } = new URL(req.url)
  const orgSlug = searchParams.get('orgSlug')
  const view = searchParams.get('view') ?? 'sent'
  const sharedOnly = view === 'shared'
  const archives = archiveMode(searchParams.get('archive'))

  let query: FirebaseFirestore.Query = adminDb.collection('projects')

  if (user.role === 'client') {
    const orgId = searchParams.get('orgId') ?? user.orgId
    if (!orgId || !canAccessOrg(user, orgId)) return apiSuccess([])
    if (view === 'received' || view === 'shared') {
      const projects = (await loadClientVisibleProjectsForOrg(orgId))
        .filter((project) => !sharedOnly || Boolean(project.claimableRelationshipId))
        .filter((project) => filterProjectByArchiveMode(project, archives))
        .sort((a, b) => createdAtMillis(b.createdAt) - createdAtMillis(a.createdAt))
      return apiSuccess(projects)
    }
    query = query.where(view === 'received' ? 'recipientOrgId' : 'orgId', '==', orgId)
  }

  // If orgSlug is provided, look up org by slug and filter by orgId
  if (user.role !== 'client' && orgSlug) {
    const orgSnapshot = await adminDb
      .collection('organizations')
      .where('slug', '==', orgSlug)
      .limit(1)
      .get()

    if (orgSnapshot.empty) {
      return apiSuccess([])
    }

    const orgId = orgSnapshot.docs[0].id
    if (!canAccessOrg(user, orgId)) {
      return apiError('Forbidden', 403)
    }
    if (view === 'received' || view === 'shared') {
      const projects = (await loadClientVisibleProjectsForOrg(orgId))
        .filter((project) => !sharedOnly || Boolean(project.claimableRelationshipId))
        .filter((project) => filterProjectByArchiveMode(project, archives))
        .sort((a, b) => createdAtMillis(b.createdAt) - createdAtMillis(a.createdAt))
      return apiSuccess(projects)
    }
    query = query.where('orgId', '==', orgId)
  } else if (user.role === 'admin') {
    const allowedOrgIds = view === 'received' || view === 'shared'
      ? explicitAdminOrgIds(user)
      : restrictedAdminOrgIds(user)
    if ((view === 'received' || view === 'shared') && allowedOrgIds.length > 0) {
      const projects = (await loadClientVisibleProjectsForOrgs(allowedOrgIds.slice(0, 30)))
        .filter((project) => !sharedOnly || Boolean(project.claimableRelationshipId))
        .filter((project) => filterProjectByArchiveMode(project, archives))
        .sort((a, b) => createdAtMillis(b.createdAt) - createdAtMillis(a.createdAt))
      return apiSuccess(projects)
    }
    if (allowedOrgIds.length > 0) {
      query = query.where('orgId', 'in', allowedOrgIds.slice(0, 30))
    }
  }

  const snapshot = await query.get()

  const projects: ProjectListItem[] = snapshot.docs
    .map((doc): ProjectListItem => ({ id: doc.id, ...doc.data() }))
    .filter((project) => !sharedOnly || Boolean(project.claimableRelationshipId))
    .filter((project) => filterProjectByArchiveMode(project, archives))
    .sort((a, b) => createdAtMillis(b.createdAt) - createdAtMillis(a.createdAt))

  return apiSuccess(projects)
})

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const body = await req.json()

  if (!body.name?.trim()) return apiError('Name is required')
  if (body.status && !VALID_STATUSES.includes(body.status as ProjectStatus)) {
    return apiError('Invalid status')
  }

  let orgId = user.role === 'client'
    ? user.orgId ?? ''
    : cleanString(body.orgId) || cleanString(body.clientOrgId) || cleanString(body.clientId)

  // If orgSlug is provided, look up the org by slug and get its ID
  const orgSlugInput = cleanString(body.orgSlug)
  if (user.role !== 'client' && !orgId && orgSlugInput) {
    const orgSnapshot = await adminDb
      .collection('organizations')
      .where('slug', '==', orgSlugInput)
      .limit(1)
      .get()

    if (!orgSnapshot.empty) {
      orgId = orgSnapshot.docs[0].id
    } else {
      return apiError('Organization not found', 404)
    }
  }

  if (!orgId) return apiError('Organization is required', 400)
  if (!canAccessOrg(user, orgId)) {
    return apiError('Forbidden', 403)
  }

  const claimableProject = hasClaimableTarget(body)
  const platformIssuedProject = !claimableProject && (user.role === 'admin' || user.role === 'ai')
  const sourceOrgId = platformIssuedProject ? await resolvePlatformOwnerOrgId() : orgId
  const recipientOrgId = platformIssuedProject ? orgId : cleanString(body.recipientOrgId)
  const clientId = cleanString(body.clientId) || recipientOrgId || orgId
  const crmTarget = claimableProject ? await resolveProjectCrmTarget(body, sourceOrgId) : null
  if (claimableProject && crmTarget?.companyId && !crmTarget.company) {
    return apiError('CRM company not found', 404)
  }
  if (claimableProject && crmTarget?.contactId && !crmTarget.contact) {
    return apiError('CRM contact not found', 404)
  }
  if (claimableProject && !crmTarget?.recipientEmail) {
    return apiError('recipientEmail is required for CRM project sharing', 400)
  }
  const recipientOrgDoc = platformIssuedProject && recipientOrgId
    ? await adminDb.collection('organizations').doc(recipientOrgId).get()
    : null
  const recipientOrg = recipientOrgDoc?.exists ? recipientOrgDoc.data() ?? {} : {}
  const platformCompany = platformIssuedProject && recipientOrgId
    ? await ensurePlatformCompanyForOrg({
        clientOrgId: recipientOrgId,
        clientOrg: recipientOrg,
        platformOrgId: sourceOrgId,
        lifecycleStage: 'customer',
        source: 'platform_resource_create',
        tags: ['client-org'],
      }).catch((err) => {
        console.error('[project-platform-company-link-error]', err)
        return null
      })
    : null

  const name = body.name.trim()
  const ownerUid = user.uid
  const ownerOrgId = sourceOrgId
  const docRef = await adminDb.collection('projects').add(stripUndefined({
    name,
    ownerUid,
    ownerOrgId,
    orgId: sourceOrgId,
    sourceOrgId,
    issuerOrgId: sourceOrgId,
    clientId,
    clientOrgId: crmTarget?.recipientOrgId || recipientOrgId || cleanString(body.clientOrgId) || clientId || null,
    description: body.description?.trim() ?? '',
    brief: body.brief?.trim() ?? '',
    status: (body.status as ProjectStatus) ?? 'discovery',
    startDate: FieldValue.serverTimestamp(),
    targetDate: body.targetDate ?? null,
    sourceCompanyId: crmTarget?.companyId || platformCompany?.companyId || undefined,
    sourceContactId: crmTarget?.contactId || undefined,
    companyId: crmTarget?.companyId || platformCompany?.companyId || undefined,
    contactId: crmTarget?.contactId || undefined,
    recipientEmail: crmTarget?.recipientEmail || undefined,
    recipientName: crmTarget?.recipientName || undefined,
    recipientCompanyName: crmTarget?.recipientCompanyName || platformCompany?.companyName || undefined,
    recipientOrgId: crmTarget?.recipientOrgId || recipientOrgId || undefined,
    recipientUserId: crmTarget?.recipientUserId || undefined,
    targetOrgId: crmTarget?.recipientOrgId || recipientOrgId || undefined,
    targetUserId: crmTarget?.recipientUserId || undefined,
    claimStatus: claimableProject
      ? (crmTarget?.recipientOrgId ? 'claimed' : 'pending')
      : recipientOrgId ? 'claimed' : undefined,
    createdBy: user.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }))
  await ensureProjectOwnerMembership({
    projectId: docRef.id,
    ownerUid,
    ownerOrgId,
    actorUid: user.uid,
  })
  let claimToken: string | undefined
  let claimStatus: string | undefined

  if (claimableProject && crmTarget) {
    const relationship = await ensureClaimableRelationship({
      sourceOrgId: orgId,
      sourceCompanyId: crmTarget.companyId || undefined,
      sourceContactId: crmTarget.contactId || undefined,
      recipientOrgId: crmTarget.recipientOrgId || undefined,
      recipientUserId: crmTarget.recipientUserId || undefined,
      recipientEmail: crmTarget.recipientEmail,
      recipientName: crmTarget.recipientName,
      recipientCompanyName: crmTarget.recipientCompanyName,
      resourceType: 'project',
      resourceId: docRef.id,
    })

    claimToken = relationship.claimToken
    claimStatus = relationship.targetOrgId || relationship.status === 'claimed' ? 'claimed' : 'pending'
    await adminDb.collection('projects').doc(docRef.id).update(stripUndefined({
      claimableRelationshipId: relationship.id,
      claimToken: relationship.claimToken,
      claimStatus,
      recipientOrgId: relationship.targetOrgId,
      recipientUserId: relationship.targetUserId,
      targetOrgId: relationship.targetOrgId,
      targetUserId: relationship.targetUserId,
      clientOrgId: relationship.targetOrgId || crmTarget.recipientOrgId || cleanString(body.clientOrgId) || clientId,
      updatedAt: FieldValue.serverTimestamp(),
    }))
  }

  logActivity({
    orgId: sourceOrgId,
    type: 'project_created',
    actorId: user.uid,
    actorName: user.uid,
    actorRole: user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client',
    description: `Created project: "${name}"`,
    entityId: docRef.id,
    entityType: 'project',
    entityTitle: name,
  }).catch(() => {})

  return apiSuccess(stripUndefined({ id: docRef.id, claimToken, claimStatus }), 201)
})

export const DELETE = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')

  if (!id) return apiError('Project ID is required', 400)

  const docRef = adminDb.collection('projects').doc(id)
  const snap = await docRef.get()
  if (!snap.exists) return apiError('Project not found', 404)
  const projectData = snap.data() ?? {}
  const orgId = projectData.orgId
  if (!canAccessProject(user, projectData)) {
    return apiError('Forbidden', 403)
  }

  await adminDb.recursiveDelete(docRef)

  logActivity({
    orgId: typeof orgId === 'string' ? orgId : String(orgId ?? ''),
    type: 'project_deleted',
    actorId: user.uid,
    actorName: user.uid,
    actorRole: user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client',
    description: 'Deleted project',
    entityId: id,
    entityType: 'project',
  }).catch(() => {})

  return apiSuccess({ id })
})
