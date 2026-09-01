import { provisionFullClientOnVps } from '@/lib/client-provisioning/vps'
import {
  buildClientProvisioningPayload,
  inferAgentName,
  inferCompanyCoworkDomain,
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
import { botComputerFoldersToEnsure } from '@/lib/messages/bot-computer-isolation'
import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'

export type EnsureCompanyCoworkFolderResult =
  | { ok: true; workspace: ConversationWorkspaceContext; createdOrVerified: true }
  | { ok: false; code: 'company_workspace_missing' | 'company_provision_failed'; error: string }

function provisioningIdentity(
  workspace: ConversationWorkspaceContext,
  company: OrgWorkspaceRecord | null,
) {
  const clientName = (workspace.companyName || company?.orgName || '').trim()
  const domain = (
    company?.agentDomain
    || company?.orgSlug
    || inferCompanyCoworkDomain({
      name: clientName,
      domain: workspace.companyDomain,
    })
  ).trim()
  const orgId = (
    company?.orgId
    || workspace.companyLinkedOrgId
    || workspace.orgId
    || ''
  ).trim()
  return { clientName, domain, orgId }
}

async function resolveOrBootstrapCompanyWorkspace(
  workspace: ConversationWorkspaceContext,
): Promise<OrgWorkspaceRecord | null> {
  if (workspace.companyId) {
    const byCompany = await getCompanyWorkspaceByCompanyId(workspace.companyId)
    if (byCompany) return byCompany
  }
  if (workspace.companyWorkspaceId) {
    const byId = await getOrgWorkspaceById(workspace.companyWorkspaceId)
    if (byId) return byId
  }

  const clientName = (workspace.companyName || '').trim()
  const companyId = (workspace.companyId || '').trim()
  if (!clientName || !companyId) return null

  const domain = inferCompanyCoworkDomain({
    name: clientName,
    domain: workspace.companyDomain,
  })
  const existingByDomain = await getOrgWorkspaceById(domain)
  if (existingByDomain) return existingByDomain

  const orgId = (workspace.companyLinkedOrgId || workspace.orgId || '').trim()
  if (!orgId) return null

  const payload = buildClientProvisioningPayload({
    clientName,
    domain,
    orgId,
    companyId,
    contactIds: workspace.contactIds,
    platformOwned: workspace.orgId === PIB_PLATFORM_ORG_ID,
  })
  return {
    id: payload.manifest.workspaceId,
    ...({
      workspaceId: payload.manifest.workspaceId,
      orgId: payload.manifest.orgId,
      orgSlug: payload.manifest.orgSlug,
      orgName: payload.manifest.orgName,
      agentDomain: payload.manifest.agentDomain,
      agentName: payload.manifest.agentName,
      vpsPath: payload.manifest.vpsPath,
      localPath: payload.manifest.localPath,
      agentDomainPath: payload.manifest.agentDomainPath,
      localAgentDomainPath: payload.manifest.localAgentDomainPath,
      sourceOfTruth: 'vps',
      syncMode: payload.manifest.syncMode,
      defaultRuntimeTarget: 'vps',
      status: 'active',
      folderVersion: payload.manifest.folderVersion,
      manifest: payload.manifest,
      companyId,
      contactIds: payload.manifest.linked.contactIds,
    } satisfies Omit<OrgWorkspaceRecord, 'id'>),
  }
}

/**
 * Ensure the company Cowork tree exists on the VPS (idempotent Pip admin provision),
 * refresh Firestore org_workspaces (creating the company Workspace link when missing),
 * and return an enriched conversation workspace context.
 */
export async function ensureCompanyCoworkFolderOnVps(
  workspace: ConversationWorkspaceContext,
): Promise<EnsureCompanyCoworkFolderResult> {
  if (!conversationUsesCompanyCoworkFolder(workspace)) {
    return { ok: true, workspace, createdOrVerified: true }
  }

  const company = await resolveOrBootstrapCompanyWorkspace(workspace)
  if (!company) {
    return {
      ok: false,
      code: 'company_workspace_missing',
      error: 'This company Cowork folder could not be prepared because the company name is missing.',
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
      contactIds: company.contactIds?.length ? company.contactIds : workspace.contactIds,
      // Partners CRM company Cowork always nests under partners/, even when the
      // workspace record is linked to a client organisation id.
      platformOwned: workspace.orgId === PIB_PLATFORM_ORG_ID,
      extraWorkspaceFolders: botComputerFoldersToEnsure(workspace.folderRelativePath),
    }
    await provisionFullClientOnVps(input)
    const payload = buildClientProvisioningPayload(input)
    await upsertOrgWorkspace({
      ...payload.manifest,
      // Preserve the existing company Workspace document id when present.
      workspaceId: company.workspaceId || payload.manifest.workspaceId,
      linked: {
        companyId: workspace.companyId || company.companyId || payload.manifest.linked.companyId,
        contactIds: input.contactIds?.length ? input.contactIds : payload.manifest.linked.contactIds,
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
    companyDomain: workspace.companyDomain || domain,
    companyLinkedOrgId: workspace.companyLinkedOrgId || orgId,
  })
  return { ok: true, workspace: enriched, createdOrVerified: true }
}
