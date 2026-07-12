/**
 * GET /api/v1/workspaces — list VPS-canonical PiB workspaces for the caller/org.
 */
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiSuccess, apiError } from '@/lib/api/response'
import { ORG_WORKSPACES_COLLECTION, type OrgWorkspaceRecord } from '@/lib/client-provisioning/workspace-context'
import { publicRuntimeTargetPresence } from '@/lib/agents/runtime-targets'

export const dynamic = 'force-dynamic'

export interface PublicWorkspaceSummary {
  id: string
  workspaceId: string
  orgId: string
  orgSlug: string
  orgName: string
  agentDomain: string
  sourceOfTruth: OrgWorkspaceRecord['sourceOfTruth']
  syncMode: OrgWorkspaceRecord['syncMode']
  defaultRuntimeTarget: OrgWorkspaceRecord['defaultRuntimeTarget']
  folderVersion: number
  companyId: string | null
  contactIds: string[]
}

function toPublicWorkspaceSummary(workspace: OrgWorkspaceRecord): PublicWorkspaceSummary {
  return {
    id: workspace.id,
    workspaceId: workspace.workspaceId,
    orgId: workspace.orgId,
    orgSlug: workspace.orgSlug,
    orgName: workspace.orgName,
    agentDomain: workspace.agentDomain,
    sourceOfTruth: workspace.sourceOfTruth,
    syncMode: workspace.syncMode,
    defaultRuntimeTarget: workspace.defaultRuntimeTarget,
    folderVersion: workspace.folderVersion,
    companyId: workspace.companyId ?? null,
    contactIds: workspace.contactIds ?? [],
  }
}

export const GET = withAuth('client', async (req: NextRequest, user) => {
  const { searchParams } = new URL(req.url)
  const orgScope = resolveOrgScope(user, searchParams.get('orgId'))
  if (!orgScope.ok) return apiError(orgScope.error, orgScope.status)

  const [snap, runtimeDoc, ownProjects, clientProjects, targetProjects, recipientProjects] = await Promise.all([
    adminDb.collection(ORG_WORKSPACES_COLLECTION)
      .where('orgId', '==', orgScope.orgId)
      .where('status', '==', 'active')
      .get(),
    adminDb.collection('agent_dispatch_configs').doc('pip').get(),
    adminDb.collection('projects').where('orgId', '==', orgScope.orgId).get(),
    adminDb.collection('projects').where('clientOrgId', '==', orgScope.orgId).get(),
    adminDb.collection('projects').where('targetOrgId', '==', orgScope.orgId).get(),
    adminDb.collection('projects').where('recipientOrgId', '==', orgScope.orgId).get(),
  ])

  const workspaces = snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as OrgWorkspaceRecord)
    .sort((a, b) => a.orgName.localeCompare(b.orgName))
    .map(toPublicWorkspaceSummary)

  const runtimeTargets = publicRuntimeTargetPresence(runtimeDoc.data()?.runtimeTargets)
  const projectsById = new Map<string, { id: string; name: string }>()
  for (const projectSnap of [ownProjects, clientProjects, targetProjects, recipientProjects]) {
    for (const projectDoc of projectSnap.docs) {
      const data = projectDoc.data()
      if (data.deleted === true || data.archived === true) continue
      const name = typeof data.name === 'string' ? data.name.trim() : ''
      if (name) projectsById.set(projectDoc.id, { id: projectDoc.id, name })
    }
  }
  const projects = Array.from(projectsById.values()).sort((a, b) => a.name.localeCompare(b.name))

  return apiSuccess({ workspaces, runtimeTargets, projects })
})
