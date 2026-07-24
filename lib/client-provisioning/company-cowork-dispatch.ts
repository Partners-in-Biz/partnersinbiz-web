import {
  getCompanyWorkspaceByCompanyId,
  getOrgWorkspaceById,
  type ConversationWorkspaceContext,
} from '@/lib/client-provisioning/workspace-context'
import { parseLinkedRuntimeVersion } from '@/lib/linked-computers/runtime-targets'

/** Runtime versions that honour optional linked-job workingDirectory (Cowork sibling folders). */
export const LINKED_COWORK_WORKING_DIRECTORY_MIN_VERSION = '1.1.3'

export function conversationUsesCompanyCoworkFolder(
  workspace: ConversationWorkspaceContext | null | undefined,
): boolean {
  if (!workspace) return false
  return workspace.folderScope === 'company'
    || (workspace.folderScope === 'project' && Boolean(workspace.companyWorkspaceId || workspace.companyId))
}

/**
 * Absolute or portable (~/) local working path the linked Mac/runtime must enter.
 * Required for company Cowork chats because org Workspace mappings typically point
 * at the Partners folder, while company folders are siblings under ~/Cowork/partners/.
 *
 * Prefer the VPS absolute path when dispatching to a Linux/VPS linked computer —
 * expanding ~/Cowork on the VPS service account home breaks claim acceptance.
 */
export function linkedCoworkWorkingDirectory(
  workspace: ConversationWorkspaceContext | null | undefined,
  options?: { preferVps?: boolean },
): string | undefined {
  if (!conversationUsesCompanyCoworkFolder(workspace)) return undefined
  if (options?.preferVps) {
    const vps = workspace?.vpsWorkingPath?.trim()
    if (vps) return vps
  }
  const directory = workspace?.localWorkingPath?.trim() || workspace?.vpsWorkingPath?.trim()
  return directory || undefined
}

export function linkedRuntimeSupportsCoworkWorkingDirectory(version: string): boolean {
  const current = parseLinkedRuntimeVersion(version)
  const required = parseLinkedRuntimeVersion(LINKED_COWORK_WORKING_DIRECTORY_MIN_VERSION)
  if (!current || !required) return false
  for (let i = 0; i < 3; i++) {
    if (current[i] !== required[i]) return current[i] > required[i]
  }
  return true
}

/**
 * Rehydrate company Cowork agent-domain fields on every send so older conversations
 * that still store Partners domain metadata do not steer recall into the wrong wiki.
 */
export async function enrichCompanyCoworkWorkspaceContext(
  workspace: ConversationWorkspaceContext,
): Promise<ConversationWorkspaceContext> {
  if (!conversationUsesCompanyCoworkFolder(workspace)) return workspace

  const companyWorkspace = workspace.companyId
    ? await getCompanyWorkspaceByCompanyId(workspace.companyId)
    : workspace.companyWorkspaceId
      ? await getOrgWorkspaceById(workspace.companyWorkspaceId)
      : null
  if (!companyWorkspace) return workspace

  const folderRelativePath = workspace.folderRelativePath?.trim() || ''
  const companyRootVps = companyWorkspace.vpsPath
  const companyRootLocal = companyWorkspace.localPath

  return {
    ...workspace,
    companyWorkspaceId: companyWorkspace.workspaceId,
    ...(companyWorkspace.orgName ? { companyName: workspace.companyName || companyWorkspace.orgName } : {}),
    agentDomain: companyWorkspace.agentDomain || workspace.agentDomain,
    agentDomainPath: companyWorkspace.agentDomainPath || workspace.agentDomainPath,
    localAgentDomainPath: companyWorkspace.localAgentDomainPath || workspace.localAgentDomainPath,
    vpsPath: companyRootVps,
    localPath: companyRootLocal,
    vpsWorkingPath: folderRelativePath
      ? `${companyRootVps}/${folderRelativePath}`
      : (workspace.folderScope === 'company' ? companyRootVps : workspace.vpsWorkingPath || companyRootVps),
    localWorkingPath: folderRelativePath
      ? `${companyRootLocal}/${folderRelativePath}`
      : (workspace.folderScope === 'company' ? companyRootLocal : workspace.localWorkingPath || companyRootLocal),
  }
}
