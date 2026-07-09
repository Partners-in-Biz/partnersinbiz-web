/**
 * GET /api/v1/workspaces — list VPS-canonical PiB workspaces for the caller/org.
 */
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiSuccess, apiError } from '@/lib/api/response'
import { ORG_WORKSPACES_COLLECTION, type OrgWorkspaceRecord } from '@/lib/client-provisioning/workspace-context'

export const dynamic = 'force-dynamic'

export const GET = withAuth('client', async (req: NextRequest, user) => {
  const { searchParams } = new URL(req.url)
  const orgScope = resolveOrgScope(user, searchParams.get('orgId'))
  if (!orgScope.ok) return apiError(orgScope.error, orgScope.status)

  const snap = await adminDb.collection(ORG_WORKSPACES_COLLECTION)
    .where('orgId', '==', orgScope.orgId)
    .where('status', '==', 'active')
    .get()

  const workspaces = snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as OrgWorkspaceRecord)
    .sort((a, b) => a.orgName.localeCompare(b.orgName))
    .map((workspace) => ({
      id: workspace.id,
      workspaceId: workspace.workspaceId,
      orgId: workspace.orgId,
      orgSlug: workspace.orgSlug,
      orgName: workspace.orgName,
      agentDomain: workspace.agentDomain,
      vpsPath: workspace.vpsPath,
      localPath: workspace.localPath,
      agentDomainPath: workspace.agentDomainPath,
      localAgentDomainPath: workspace.localAgentDomainPath,
      sourceOfTruth: workspace.sourceOfTruth,
      syncMode: workspace.syncMode,
      defaultRuntimeTarget: workspace.defaultRuntimeTarget,
      folderVersion: workspace.folderVersion,
      companyId: workspace.companyId ?? null,
      contactIds: workspace.contactIds ?? [],
    }))

  return apiSuccess({ workspaces })
})
