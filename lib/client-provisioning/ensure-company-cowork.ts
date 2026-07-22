import { provisionFullClientOnVps } from '@/lib/client-provisioning/vps'
import {
  buildClientProvisioningPayload,
  inferAgentName,
} from '@/lib/client-provisioning/provisioner'
import {
  conversationUsesCompanyCoworkFolder,
  enrichCompanyCoworkWorkspaceContext,
} from '@/lib/client-provisioning/company-cowork-dispatch'
import {
  getCompanyWorkspaceByCompanyId,
  getOrgWorkspaceById,
  upsertOrgWorkspace,
  type ConversationWorkspaceContext,
  type OrgWorkspaceRecord,
} from '@/lib/client-provisioning/workspace-context'

export type EnsureCompanyCoworkFolderResult =
  | { ok: true; workspace: ConversationWorkspaceContext; createdOrVerified: true }
  | { ok: false; code: 'company_workspace_missing' | 'company_provision_failed'; error: string }

function provisioningIdentity(workspace: ConversationWorkspaceContext, company: OrgWorkspaceRecord) {
  const clientName = (workspace.companyName || company.orgName || '').trim()
  const domain = (company.agentDomain || company.orgSlug || '').trim()
  const orgId = (company.orgId || workspace.orgId || '').trim()
  return { clientName, domain, orgId }
}

/**
 * Ensure the company Cowork tree exists on the VPS (idempotent Pip admin provision),
 * refresh Firestore org_workspaces, and return an enriched conversation workspace context.
 */
export async function ensureCompanyCoworkFolderOnVps(
  workspace: ConversationWorkspaceContext,
): Promise<EnsureCompanyCoworkFolderResult> {
  if (!conversationUsesCompanyCoworkFolder(workspace)) {
    return { ok: true, workspace, createdOrVerified: true }
  }

  const company = workspace.companyId
    ? await getCompanyWorkspaceByCompanyId(workspace.companyId)
    : workspace.companyWorkspaceId
      ? await getOrgWorkspaceById(workspace.companyWorkspaceId)
      : null
  if (!company) {
    return {
      ok: false,
      code: 'company_workspace_missing',
      error: 'This company Cowork folder is not linked to a Workspace yet.',
    }
  }

  const { clientName, domain, orgId } = provisioningIdentity(workspace, company)
  if (!clientName || !domain || !orgId) {
    return {
      ok: false,
      code: 'company_workspace_missing',
      error: 'This company Cowork folder is missing a name or domain for provisioning.',
    }
  }

  try {
    const input = {
      clientName,
      domain,
      orgId,
      agentName: company.agentName || inferAgentName(clientName),
      companyId: workspace.companyId || company.companyId,
      contactIds: company.contactIds,
    }
    await provisionFullClientOnVps(input)
    const payload = buildClientProvisioningPayload(input)
    await upsertOrgWorkspace({
      ...payload.manifest,
      // Preserve the existing company Workspace document id when present.
      workspaceId: company.workspaceId || payload.manifest.workspaceId,
      linked: {
        companyId: workspace.companyId || company.companyId || payload.manifest.linked.companyId,
        contactIds: company.contactIds?.length ? company.contactIds : payload.manifest.linked.contactIds,
      },
    })
  } catch (error) {
    return {
      ok: false,
      code: 'company_provision_failed',
      error: error instanceof Error ? error.message : 'Company Cowork folder could not be created on the VPS',
    }
  }

  const enriched = await enrichCompanyCoworkWorkspaceContext({
    ...workspace,
    companyWorkspaceId: company.workspaceId,
    companyName: workspace.companyName || clientName,
  })
  return { ok: true, workspace: enriched, createdOrVerified: true }
}
