import { lstat, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'

import { adminDb } from '@/lib/firebase/admin'
import type {
  ConversationWorkspaceContext,
  WorkspaceDispatchFailureCode,
} from '@/lib/client-provisioning/workspace-context'
import { projectLinkedToOrganization } from '@/lib/projects/organization-link'

export type AuthorizedWorkingDirectoryResult =
  | { ok: true; directory: string; pathClass: 'organisation' | 'project' }
  | { ok: false; code: WorkspaceDispatchFailureCode }

function failure(code: WorkspaceDispatchFailureCode): AuthorizedWorkingDirectoryResult {
  return { ok: false, code }
}

function isContained(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate)
  return fromRoot === '' || (!fromRoot.startsWith(`..${sep}`) && fromRoot !== '..' && !isAbsolute(fromRoot))
}

async function containsSymlink(root: string, candidate: string): Promise<boolean> {
  const fromRoot = relative(root, candidate)
  if (!fromRoot) return false

  let current = root
  for (const component of fromRoot.split(sep)) {
    current = resolve(current, component)
    if ((await lstat(current)).isSymbolicLink()) return true
  }
  return false
}

export async function resolveAuthorizedWorkingDirectory(input: {
  workspaceContext?: ConversationWorkspaceContext | null
  /** Server-authorized project identity for legacy contexts missing it. */
  projectId?: string | null
  /** Server-authorized active replica path for project sessions. */
  projectRelativePath?: string | null
}): Promise<AuthorizedWorkingDirectoryResult> {
  const workspace = input.workspaceContext
  if (!workspace) return failure('workspace_context_invalid')

  const localRuntime = workspace.runtimeTarget === 'local'
  const configuredRoot = localRuntime ? workspace.localPath : workspace.vpsPath
  const persistedDirectory = localRuntime ? workspace.localWorkingPath : workspace.vpsWorkingPath
  const serverProjectId = input.projectId?.trim()
  const effectiveProjectId = serverProjectId || workspace.projectId?.trim()
  const projectPathClass = workspace.folderScope === 'project' || Boolean(serverProjectId)
  const authorizedProjectRelativePath = input.projectRelativePath?.trim()
    || (effectiveProjectId ? `projects/${effectiveProjectId}` : '')
  const configuredDirectory = projectPathClass && authorizedProjectRelativePath && configuredRoot
    ? resolve(configuredRoot, authorizedProjectRelativePath)
    : persistedDirectory
  if (!configuredRoot || !configuredDirectory || !isAbsolute(configuredRoot) || !isAbsolute(configuredDirectory)) {
    return failure('workspace_root_invalid')
  }

  const lexicalRoot = resolve(configuredRoot)
  const lexicalDirectory = resolve(configuredDirectory)
  if (!isContained(lexicalRoot, lexicalDirectory)) return failure('workspace_directory_outside_root')

  try {
    const pathClass = projectPathClass ? 'project' : 'organisation'
    if (pathClass === 'organisation' && lexicalDirectory !== lexicalRoot) {
      return failure('workspace_directory_outside_root')
    }

    if (pathClass === 'project') {
      const projectId = effectiveProjectId
      if (!projectId || projectId.includes('/') || projectId.includes('\\')) {
        return failure('workspace_project_missing')
      }
      const projectRelativePath = authorizedProjectRelativePath
      if (lexicalDirectory !== resolve(lexicalRoot, projectRelativePath)) {
        return failure('workspace_directory_outside_root')
      }

      const projectDoc = await adminDb.collection('projects').doc(projectId).get()
      if (!projectDoc.exists) return failure('workspace_project_missing')
      const project = projectDoc.data() ?? {}
      if (!await projectLinkedToOrganization({ projectId, project, orgId: workspace.orgId })) {
        return failure('workspace_project_missing')
      }
      const status = typeof project.status === 'string' ? project.status.trim().toLowerCase() : ''
      if (project.archived === true || ['archived', 'completed', 'cancelled'].includes(status)) {
        return failure('workspace_project_archived')
      }
    }

    const rootStat = await lstat(lexicalRoot)
    if (!rootStat.isDirectory()) return failure('workspace_root_invalid')
    if (await containsSymlink(lexicalRoot, lexicalDirectory)) return failure('workspace_directory_symlink')

    const [canonicalRoot, canonicalDirectory] = await Promise.all([
      realpath(lexicalRoot),
      realpath(lexicalDirectory),
    ])
    if (!isContained(canonicalRoot, canonicalDirectory)) return failure('workspace_directory_outside_root')
    if (!(await lstat(canonicalDirectory)).isDirectory()) return failure('workspace_directory_missing')
    return { ok: true, directory: canonicalDirectory, pathClass }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return failure('workspace_directory_missing')
    return failure('workspace_context_invalid')
  }
}
