import { lstat, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'

import { adminDb } from '@/lib/firebase/admin'
import type {
  ConversationWorkspaceContext,
  WorkspaceDispatchFailureCode,
} from '@/lib/client-provisioning/workspace-context'

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
}): Promise<AuthorizedWorkingDirectoryResult> {
  const workspace = input.workspaceContext
  if (!workspace) return failure('workspace_context_invalid')

  const localRuntime = workspace.runtimeTarget === 'local'
  const configuredRoot = localRuntime ? workspace.localPath : workspace.vpsPath
  const configuredDirectory = localRuntime ? workspace.localWorkingPath : workspace.vpsWorkingPath
  if (!configuredRoot || !configuredDirectory || !isAbsolute(configuredRoot) || !isAbsolute(configuredDirectory)) {
    return failure('workspace_root_invalid')
  }

  const lexicalRoot = resolve(configuredRoot)
  const lexicalDirectory = resolve(configuredDirectory)
  if (!isContained(lexicalRoot, lexicalDirectory)) return failure('workspace_directory_outside_root')

  const pathClass = workspace.folderScope === 'project' ? 'project' : 'organisation'
  if (pathClass === 'organisation' && lexicalDirectory !== lexicalRoot) {
    return failure('workspace_directory_outside_root')
  }

  if (pathClass === 'project') {
    const projectId = workspace.projectId?.trim()
    if (!projectId || projectId.includes('/') || projectId.includes('\\')) {
      return failure('workspace_project_missing')
    }
    if (lexicalDirectory !== resolve(lexicalRoot, 'projects', projectId)) {
      return failure('workspace_directory_outside_root')
    }

    const projectDoc = await adminDb.collection('projects').doc(projectId).get()
    if (!projectDoc.exists) return failure('workspace_project_missing')
    const project = projectDoc.data() ?? {}
    const projectOrgId = typeof project.orgId === 'string' ? project.orgId : ''
    if (projectOrgId !== workspace.orgId) return failure('workspace_project_missing')
    const status = typeof project.status === 'string' ? project.status.trim().toLowerCase() : ''
    if (project.archived === true || ['archived', 'completed', 'cancelled'].includes(status)) {
      return failure('workspace_project_archived')
    }
  }

  try {
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
