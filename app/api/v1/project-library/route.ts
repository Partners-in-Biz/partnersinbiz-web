import { NextRequest } from 'next/server'

import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiError, apiSuccess } from '@/lib/api/response'
import { getAccessibleCompanyForUser } from '@/lib/companies/api-access'
import { getProjectForUser } from '@/lib/projects/access'
import {
  addProjectToUserLibrary,
  listUserLibraryProjectIds,
  removeProjectFromUserLibrary,
} from '@/lib/projects/user-library'

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function projectCompanyId(project: Record<string, unknown>): string {
  return clean(project.sourceCompanyId) || clean(project.companyId)
}

export const GET = withAuth('client', async (req: NextRequest, user) => {
  const orgScope = resolveOrgScope(user, req.nextUrl.searchParams.get('orgId'))
  if (!orgScope.ok) return apiError(orgScope.error, orgScope.status)
  const companyId = clean(req.nextUrl.searchParams.get('companyId'))
  if (!companyId) return apiError('companyId is required', 400)
  const company = await getAccessibleCompanyForUser(companyId, orgScope.orgId, user)
  if (!company) return apiError('Company is not available in this organisation', 403)

  const [snapshot, addedProjectIds] = await Promise.all([
    adminDb.collection('projects').where('sourceOrgId', '==', orgScope.orgId).limit(1000).get(),
    listUserLibraryProjectIds(orgScope.orgId, user.uid),
  ])
  const added = new Set(addedProjectIds)
  const projects = snapshot.docs
    .map((doc) => ({ id: doc.id, data: doc.data() as Record<string, unknown> }))
    .filter(({ data }) => data.deleted !== true && data.archived !== true)
    .filter(({ data }) => projectCompanyId(data) === companyId)
    .map(({ id, data }) => ({
      id,
      name: clean(data.name) || clean(company.name) || 'Company Cowork',
      companyId,
      added: added.has(id),
    }))
    .sort((left, right) => left.name.localeCompare(right.name))

  return apiSuccess({ company: { id: company.id, name: clean(company.name) }, projects })
})

export const POST = withAuth('client', async (req: NextRequest, user) => {
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return apiError('Invalid JSON body', 400)
  const orgScope = resolveOrgScope(user, clean(body.orgId) || null)
  if (!orgScope.ok) return apiError(orgScope.error, orgScope.status)
  const projectId = clean(body.projectId)
  if (!projectId) return apiError('projectId is required', 400)
  const access = await getProjectForUser(projectId, user, orgScope.orgId)
  if (!access.ok) return apiError(access.error, access.status)
  const project = access.doc.data() ?? {}
  const companyId = projectCompanyId(project)
  if (!companyId) return apiError('Project is not linked to a CRM company', 409)
  const company = await getAccessibleCompanyForUser(companyId, orgScope.orgId, user)
  if (!company) return apiError('Company is not available in this organisation', 403)

  await addProjectToUserLibrary({
    orgId: orgScope.orgId,
    userId: user.uid,
    projectId,
    companyId,
  })
  return apiSuccess({ projectId, companyId, added: true })
})

export const DELETE = withAuth('client', async (req: NextRequest, user) => {
  const orgScope = resolveOrgScope(user, req.nextUrl.searchParams.get('orgId'))
  if (!orgScope.ok) return apiError(orgScope.error, orgScope.status)
  const projectId = clean(req.nextUrl.searchParams.get('projectId'))
  if (!projectId) return apiError('projectId is required', 400)
  await removeProjectFromUserLibrary({ orgId: orgScope.orgId, userId: user.uid, projectId })
  return apiSuccess({ projectId, removed: true })
})
