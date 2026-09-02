/**
 * GET  /api/v1/projects  — list projects (admin all/scoped, client own org)
 * POST /api/v1/projects  — create a new project (admin selected org, client own org)
 */
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import type * as FirebaseFirestore from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { actorFrom } from '@/lib/api/actor'
import { withIdempotency } from '@/lib/api/idempotency'
import { apiSuccess, apiError } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { logActivity } from '@/lib/activity/log'
import { canAccessOrg, restrictedAdminOrgIds } from '@/lib/api/platformAdmin'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { ensureClaimableRelationship } from '@/lib/claimable-relationships/store'
import {
  ensurePlatformCompanyForOrg,
  resolvePlatformOwnerOrgId,
} from '@/lib/platform-owner/relationships'
import { canAccessProject } from '@/lib/projects/access'
import { ensureProjectOwnerMembership, filterProjectsForMemberScope, projectOrganizationDocId } from '@/lib/projects/collaboration'
import { publicProjectView } from '@/lib/projects/public'
import { isSurfaceMode } from '@/lib/design/surface-modes'
import { normalizeProjectLinks, pickProjectLinkFields, type ProjectLinkSet } from '@/lib/client-documents/linkedValidation'
import { assertUserCanPerformOrganizationModuleAction } from '@/lib/organizations/module-policy-access'
import { touchPortalDashboardSummary } from '@/lib/portal/dashboard-summary'
import { getConversation } from '@/lib/conversations/conversations'
import {
  autoLinkProjectToConversationComputer,
  conversationIdFromProjectCreateBody,
} from '@/lib/project-locations/auto-link-conversation-computer'
import { clientVisibilityFieldsForWrite, companyFieldsForWrite } from '@/lib/work-scope'

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

export interface TrustedProjectCreateOptions {
  documentId: string
  setupOperationId: string
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isAlreadyExistsError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = (error as { code?: unknown }).code
  return code === 6 || code === 'already-exists'
}

function validTrustedProjectCreateOptions(value: TrustedProjectCreateOptions): boolean {
  return /^setup_project_[a-f0-9]{40}$/.test(value.documentId)
    && Boolean(value.setupOperationId.trim())
    && value.setupOperationId.length <= 256
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

async function assertProjectLinkTenantSafety(
  links: ProjectLinkSet,
  sourceOrgId: string,
  user: ApiUser,
  trustedCompanyIds: string[] = [],
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const linkedOrgIds = Array.from(new Set([...(links.recipientOrgIds ?? []), ...(links.clientOrgIds ?? [])]))
  for (const orgId of linkedOrgIds) {
    if (!canAccessOrg(user, orgId)) return { ok: false, error: `Forbidden linked recipient org: ${orgId}`, status: 403 }
  }

  const trustedCompanies = new Set(trustedCompanyIds)
  const companyIds = Array.from(new Set([...(links.companyIds ?? []), ...(links.sourceCompanyIds ?? [])]))
  for (const companyId of companyIds) {
    if (trustedCompanies.has(companyId)) continue
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

function dashboardActiveProjectStatus(status: unknown): boolean {
  return ['active', 'in_progress', 'development', 'review', 'live', 'maintenance'].includes(projectStatus(status))
}

function parseOptionalListLimit(value: string | null): number | null {
  if (!value) return null
  const parsed = parseInt(value, 10)
  return Number.isFinite(parsed) ? Math.max(1, Math.min(parsed, 200)) : null
}

function withOptionalLimit(query: FirebaseFirestore.Query, limit: number | null): FirebaseFirestore.Query {
  return limit ? query.limit(limit) : query
}

async function loadClientVisibleProjectsForOrg(orgId: string, limit: number | null = null): Promise<ProjectListItem[]> {
  const [receivedSnap, targetSnap, clientSnap, legacySnap, organizationAccessSnap] = await Promise.all([
    withOptionalLimit(adminDb.collection('projects').where('recipientOrgId', '==', orgId), limit).get(),
    withOptionalLimit(adminDb.collection('projects').where('targetOrgId', '==', orgId), limit).get(),
    withOptionalLimit(adminDb.collection('projects').where('clientOrgId', '==', orgId), limit).get(),
    withOptionalLimit(adminDb.collection('projects').where('orgId', '==', orgId), limit).get(),
    adminDb.collection('projectOrganizations').where('orgId', '==', orgId).get(),
  ])
  const canonicalAccess = new Map<string, Record<string, unknown>>()
  for (const doc of organizationAccessSnap.docs) {
    const row = doc.data() as Record<string, unknown>
    const projectId = cleanString(row.projectId)
    if (!projectId || cleanString(row.orgId) !== orgId) continue
    const canonical = doc.id === projectOrganizationDocId(projectId, orgId)
    if (!canonicalAccess.has(projectId) || canonical) canonicalAccess.set(projectId, row)
  }
  const byId = new Map<string, ProjectListItem>()
  for (const snap of [receivedSnap, targetSnap, clientSnap, legacySnap]) {
    for (const doc of snap.docs) {
      const access = canonicalAccess.get(doc.id)
      if (access && access.status !== 'active') continue
      byId.set(doc.id, { id: doc.id, ...doc.data() })
    }
  }
  const activeAccessProjectIds = Array.from(canonicalAccess.entries())
    .filter(([, access]) => access.status === 'active')
    .map(([projectId]) => projectId)
  const activeAccessProjects = await Promise.all(activeAccessProjectIds.map((projectId) => (
    adminDb.collection('projects').doc(projectId).get()
  )))
  for (const doc of activeAccessProjects) {
    if (doc.exists) byId.set(doc.id, { id: doc.id, ...doc.data() })
  }
  return Array.from(byId.values())
}

async function loadClientVisibleProjectsForOrgs(orgIds: string[], limit: number | null = null): Promise<ProjectListItem[]> {
  const byId = new Map<string, ProjectListItem>()
  const uniqueOrgIds = Array.from(new Set(orgIds.filter(Boolean)))
  const results = await Promise.all(uniqueOrgIds.map((orgId) => loadClientVisibleProjectsForOrg(orgId, limit)))
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
  const listLimit = parseOptionalListLimit(searchParams.get('limit'))

  let query: FirebaseFirestore.Query = adminDb.collection('projects')

  if (user.role === 'client') {
    const scope = resolveOrgScope(user, searchParams.get('orgId'))
    if (!scope.ok) return apiSuccess([])
    const orgId = scope.orgId
    if (view === 'received' || view === 'shared') {
      const projects = await filterProjectsForMemberScope(
        user,
        (await loadClientVisibleProjectsForOrg(orgId, listLimit))
          .filter((project) => !sharedOnly || Boolean(project.claimableRelationshipId))
          .filter((project) => filterProjectByArchiveMode(project, archives)),
      )
      const sorted = projects
        .sort((a, b) => createdAtMillis(b.createdAt) - createdAtMillis(a.createdAt))
        .slice(0, listLimit ?? undefined)
      return apiSuccess(sorted.map(publicProjectView))
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
      const projects = await filterProjectsForMemberScope(
        user,
        (await loadClientVisibleProjectsForOrg(orgId, listLimit))
          .filter((project) => !sharedOnly || Boolean(project.claimableRelationshipId))
          .filter((project) => filterProjectByArchiveMode(project, archives)),
      )
      const sorted = projects
        .sort((a, b) => createdAtMillis(b.createdAt) - createdAtMillis(a.createdAt))
        .slice(0, listLimit ?? undefined)
      return apiSuccess(sorted.map(publicProjectView))
    }
    query = query.where('orgId', '==', orgId)
  } else if (user.role === 'admin') {
    const allowedOrgIds = view === 'received' || view === 'shared'
      ? explicitAdminOrgIds(user)
      : restrictedAdminOrgIds(user)
    if ((view === 'received' || view === 'shared') && allowedOrgIds.length > 0) {
      const projects = await filterProjectsForMemberScope(
        user,
        (await loadClientVisibleProjectsForOrgs(allowedOrgIds.slice(0, 30), listLimit))
          .filter((project) => !sharedOnly || Boolean(project.claimableRelationshipId))
          .filter((project) => filterProjectByArchiveMode(project, archives)),
      )
      const sorted = projects
        .sort((a, b) => createdAtMillis(b.createdAt) - createdAtMillis(a.createdAt))
        .slice(0, listLimit ?? undefined)
      return apiSuccess(sorted.map(publicProjectView))
    }
    if (allowedOrgIds.length > 0) {
      query = query.where('orgId', 'in', allowedOrgIds.slice(0, 30))
    }
  }

  const snapshot = await withOptionalLimit(query, listLimit).get()
  const companyIdFilter = (searchParams.get('companyId') || searchParams.get('sourceCompanyId') || '').trim()

  const projects: ProjectListItem[] = await filterProjectsForMemberScope(
    user,
    snapshot.docs
      .map((doc): ProjectListItem => ({ id: doc.id, ...doc.data() }))
      .filter((project) => !sharedOnly || Boolean(project.claimableRelationshipId))
      .filter((project) => filterProjectByArchiveMode(project, archives))
      .filter((project) => {
        if (!companyIdFilter) return true
        const ids = [
          cleanString(project.companyId),
          cleanString(project.sourceCompanyId),
          ...((project.companyIds as string[] | undefined) ?? []).map(cleanString),
          ...((project.sourceCompanyIds as string[] | undefined) ?? []).map(cleanString),
        ].filter(Boolean)
        return ids.includes(companyIdFilter)
      }),
  )
  const sorted = projects
    .sort((a, b) => createdAtMillis(b.createdAt) - createdAtMillis(a.createdAt))
    .slice(0, listLimit ?? undefined)

  return apiSuccess(sorted.map(publicProjectView))
})

export async function handleProjectCreate(
  req: NextRequest,
  user: ApiUser,
  trustedSetup?: TrustedProjectCreateOptions,
) {
  const body = await req.json()
  if (trustedSetup && !validTrustedProjectCreateOptions(trustedSetup)) {
    return apiError('Project setup resource identity is invalid', 500)
  }
  // Work-scope company from the query (portal scoped routing) — stamps the
  // project without forcing the CRM claimable-share flow.
  const requestParams = new URL(req.url).searchParams
  const scopedCompanyId = cleanString(body.companyId)
    || cleanString(body.sourceCompanyId)
    || cleanString(requestParams.get('companyId'))
    || cleanString(requestParams.get('sourceCompanyId'))
  const normalizedLinks = normalizeProjectLinks(pickProjectLinkFields(body))
  if (normalizedLinks.ok === false) return apiError(normalizedLinks.error, 400)
  Object.assign(body, normalizedLinks.value)

  if (!body.name?.trim()) return apiError('Name is required')
  if (body.status && !VALID_STATUSES.includes(body.status as ProjectStatus)) {
    return apiError('Invalid status')
  }
  if (body.surfaceMode !== undefined && body.surfaceMode !== null && !isSurfaceMode(body.surfaceMode)) {
    return apiError('surfaceMode must be one of persuade, operate, read, experience')
  }

  const requestedOrgId = user.role === 'client'
    ? cleanString(body.orgId) || null
    : cleanString(body.orgId) || cleanString(body.clientOrgId) || cleanString(body.clientId) || null
  let orgId = ''
  if (requestedOrgId || user.role === 'client') {
    const projectScope = resolveOrgScope(user, requestedOrgId)
    if (!projectScope.ok) return apiError(projectScope.error, projectScope.status)
    orgId = projectScope.orgId
  }

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
  const orgDoc = await adminDb.collection('organizations').doc(orgId).get()
  if (!orgDoc.exists) return apiError('Organization not found', 404)
  const orgData = orgDoc.data() ?? {}
  const createAccess = await assertUserCanPerformOrganizationModuleAction(
    user,
    orgId,
    'projects',
    'create',
    'Project creation is disabled for your organisation role',
    orgData,
  )
  if (!createAccess.ok) return apiError(createAccess.error, createAccess.status)

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
    ? (recipientOrgId === orgId ? orgDoc : await adminDb.collection('organizations').doc(recipientOrgId).get())
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

  const finalLinks = normalizeProjectLinks({
    ...normalizedLinks.value,
    sourceCompanyId: crmTarget?.companyId || platformCompany?.companyId || normalizedLinks.value.sourceCompanyId || scopedCompanyId || undefined,
    sourceContactId: crmTarget?.contactId || normalizedLinks.value.sourceContactId,
    companyId: crmTarget?.companyId || platformCompany?.companyId || normalizedLinks.value.companyId || scopedCompanyId || undefined,
    contactId: crmTarget?.contactId || normalizedLinks.value.contactId,
    recipientOrgId: crmTarget?.recipientOrgId || recipientOrgId || normalizedLinks.value.recipientOrgId,
    clientOrgId: crmTarget?.recipientOrgId || recipientOrgId || normalizedLinks.value.clientOrgId,
  })
  if (finalLinks.ok === false) return apiError(finalLinks.error, 400)
  const trustedCompanyIds = platformCompany?.companyId ? [platformCompany.companyId] : []
  const linkSafety = await assertProjectLinkTenantSafety(finalLinks.value, sourceOrgId, user, trustedCompanyIds)
  if (linkSafety.ok === false) return apiError(linkSafety.error, linkSafety.status)

  const name = body.name.trim()
  const ownerUid = user.uid
  const ownerOrgId = sourceOrgId
  const projectDocument = stripUndefined({
    ...finalLinks.value,
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
    ...(body.surfaceMode !== undefined && body.surfaceMode !== null ? { surfaceMode: body.surfaceMode } : {}),
    planningDiscovery: {
      schemaVersion: 1,
      revision: 1,
      status: 'interviewing',
      mode: 'interview',
      enforced: true,
      startedBy: user.uid,
      startedAt: new Date().toISOString(),
      updatedBy: user.uid,
      updatedAt: new Date().toISOString(),
    },
    startDate: FieldValue.serverTimestamp(),
    targetDate: body.targetDate ?? null,
    sourceCompanyId: crmTarget?.companyId || platformCompany?.companyId || scopedCompanyId || undefined,
    sourceContactId: crmTarget?.contactId || undefined,
    companyId: crmTarget?.companyId || platformCompany?.companyId || scopedCompanyId || undefined,
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
    ...companyFieldsForWrite(crmTarget?.companyId || platformCompany?.companyId || scopedCompanyId),
    ...clientVisibilityFieldsForWrite(body.clientVisibility),
    ...actorFrom(user),
    ...(trustedSetup ? {
      setupOperationId: trustedSetup.setupOperationId,
      setupCreationStatus: 'creating',
    } : {}),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })
  let setupReplay = false
  let setupAlreadyComplete = false
  let docRef: FirebaseFirestore.DocumentReference
  if (trustedSetup) {
    docRef = adminDb.collection('projects').doc(trustedSetup.documentId)
    let existing = await docRef.get()
    if (!existing.exists) {
      try {
        await docRef.create(projectDocument)
      } catch (error) {
        if (!isAlreadyExistsError(error)) throw error
        existing = await docRef.get()
      }
    }
    if (existing.exists) {
      const existingProject = existing.data() ?? {}
      if (existingProject.setupOperationId !== trustedSetup.setupOperationId
        || cleanString(existingProject.name) !== name) {
        return apiError('Project setup resource conflict', 409)
      }
      setupReplay = true
      setupAlreadyComplete = existingProject.setupCreationStatus === 'complete'
    }
  } else {
    docRef = await adminDb.collection('projects').add(projectDocument)
  }
  if (setupAlreadyComplete) return apiSuccess({ id: docRef.id }, 200)
  const summaryOrgIds = Array.from(new Set([
    sourceOrgId,
    recipientOrgId,
    cleanString(finalLinks.value.recipientOrgId),
    cleanString(finalLinks.value.clientOrgId),
  ].filter(Boolean)))
  await Promise.all(summaryOrgIds.map((summaryOrgId) => touchPortalDashboardSummary(trustedSetup
    ? { orgId: summaryOrgId, staleReason: 'project.created' }
    : {
        orgId: summaryOrgId,
        increments: {
          'counts.projects': 1,
          'projects.total': 1,
          ...(dashboardActiveProjectStatus(body.status ?? 'discovery')
            ? { 'counts.activeProjects': 1, 'projects.active': 1 }
            : {}),
        },
        staleReason: 'project.created',
      })))
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

  if (trustedSetup) {
    await docRef.set({
      setupCreationStatus: 'complete',
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
  }

  if (!setupReplay) logActivity({
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

  // Agents creating projects from Messages often pin the project next and then
  // send — that requires a project↔computer replica. Auto-link when the create
  // body carries conversation origin / conversationId.
  let computerLink: { linked: boolean; locationId?: string; reason?: string } | undefined
  const sourceConversationId = conversationIdFromProjectCreateBody(body as Record<string, unknown>)
  if (sourceConversationId && !setupReplay) {
    try {
      const conversation = await getConversation(sourceConversationId)
      if (conversation && conversation.orgId === orgId) {
        // Create payloads do not set projectFolderRelativePath; auto-link falls
        // back to the canonical projects/{id} relative path.
        const linkResult = await autoLinkProjectToConversationComputer({
          projectId: docRef.id,
          orgId,
          actorUserId: user.uid,
          workspaceContext: conversation.workspaceContext,
        })
        computerLink = linkResult.linked
          ? { linked: true, locationId: linkResult.locationId }
          : { linked: false, reason: linkResult.reason }
      } else {
        computerLink = { linked: false, reason: 'conversation_not_found_or_org_mismatch' }
      }
    } catch (error) {
      if (process.env.NODE_ENV !== 'test') {
        console.error('[project-create-auto-link-computer]', error)
      }
      computerLink = { linked: false, reason: 'auto_link_error' }
    }
  }

  return apiSuccess(stripUndefined({
    id: docRef.id,
    claimToken,
    claimStatus,
    ...(computerLink ? { computerLink } : {}),
  }), setupReplay ? 200 : 201)
}

export const POST = withAuth(
  'client',
  withIdempotency((req: NextRequest, user: ApiUser) => handleProjectCreate(req, user)),
)

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

  await docRef.update({
    archived: true,
    archivedAt: FieldValue.serverTimestamp(),
    archivedBy: user.uid,
    updatedAt: FieldValue.serverTimestamp(),
  })
  const summaryOrgIds = Array.from(new Set([
    typeof orgId === 'string' ? orgId : String(orgId ?? ''),
    typeof projectData.recipientOrgId === 'string' ? projectData.recipientOrgId : '',
    typeof projectData.targetOrgId === 'string' ? projectData.targetOrgId : '',
    typeof projectData.clientOrgId === 'string' ? projectData.clientOrgId : '',
  ].filter(Boolean)))
  await Promise.all(summaryOrgIds.map((summaryOrgId) => touchPortalDashboardSummary({
    orgId: summaryOrgId,
    staleReason: 'project.archived',
  })))

  logActivity({
    orgId: typeof orgId === 'string' ? orgId : String(orgId ?? ''),
    type: 'project_archived',
    actorId: user.uid,
    actorName: user.uid,
    actorRole: user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client',
    description: 'Archived project',
    entityId: id,
    entityType: 'project',
  }).catch(() => {})

  return apiSuccess({ id, archived: true })
})
