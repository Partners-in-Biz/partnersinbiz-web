import { lstat, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'

import { adminDb } from '@/lib/firebase/admin'
import {
  collapseNestedCoworkWorkingPath,
  joinCoworkWorkingPath,
} from '@/lib/client-provisioning/cowork-working-path'
import type {
  ConversationWorkspaceContext,
  WorkspaceDispatchFailureCode,
} from '@/lib/client-provisioning/workspace-context'
import { projectLinkedToOrganization } from '@/lib/projects/organization-link'

export type AuthorizedWorkingDirectoryResult =
  | { ok: true; directory: string; pathClass: 'organisation' | 'company' | 'project' }
  | { ok: false; code: WorkspaceDispatchFailureCode }

function failure(code: WorkspaceDispatchFailureCode): AuthorizedWorkingDirectoryResult {
  return { ok: false, code }
}

function isContained(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate)
  return fromRoot === '' || (!fromRoot.startsWith(`..${sep}`) && fromRoot !== '..' && !isAbsolute(fromRoot))
}

function isPortableHomePath(value: string): boolean {
  return value.startsWith('~/') && !value.includes('\\')
}

function lexicalPath(value: string): string {
  return isPortableHomePath(value)
    ? resolve('/__runtime_home__', value.slice(2))
    : resolve(value)
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
  const persistedDirectoryRaw = localRuntime ? workspace.localWorkingPath : workspace.vpsWorkingPath
  const persistedDirectory = persistedDirectoryRaw
    ? collapseNestedCoworkWorkingPath(persistedDirectoryRaw)
    : persistedDirectoryRaw
  const serverProjectId = input.projectId?.trim()
  const effectiveProjectId = serverProjectId || workspace.projectId?.trim()
  const projectPathClass = workspace.folderScope === 'project' || Boolean(serverProjectId)
  const authorizedProjectRelativePath = input.projectRelativePath?.trim()
    || (effectiveProjectId ? `projects/${effectiveProjectId}` : '')
  // Replica relative paths may be mapping-scoped (partners/{Company}/…). Join
  // against the company root without nesting, matching conversation context.
  const configuredDirectory = projectPathClass && authorizedProjectRelativePath && configuredRoot
    ? joinCoworkWorkingPath(configuredRoot, authorizedProjectRelativePath)
    : persistedDirectory
  const portableHomePath = Boolean(
    configuredRoot
    && configuredDirectory
    && isPortableHomePath(configuredRoot)
    && isPortableHomePath(configuredDirectory),
  )
  if (!configuredRoot || !configuredDirectory
    || (!portableHomePath && (!isAbsolute(configuredRoot) || !isAbsolute(configuredDirectory)))) {
    return failure('workspace_root_invalid')
  }

  const lexicalRoot = lexicalPath(configuredRoot)
  const lexicalDirectory = lexicalPath(configuredDirectory)
  if (!isContained(lexicalRoot, lexicalDirectory)) return failure('workspace_directory_outside_root')

  try {
    const pathClass = projectPathClass
      ? 'project'
      : workspace.folderScope === 'company' ? 'company' : 'organisation'
    if (pathClass === 'organisation' && lexicalDirectory !== lexicalRoot) {
      return failure('workspace_directory_outside_root')
    }

    if (pathClass === 'project') {
      const projectId = effectiveProjectId
      if (!projectId || projectId.includes('/') || projectId.includes('\\')) {
        return failure('workspace_project_missing')
      }
      const projectRelativePath = authorizedProjectRelativePath
      const expectedDirectory = lexicalPath(joinCoworkWorkingPath(configuredRoot, projectRelativePath))
      if (lexicalDirectory !== expectedDirectory) {
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

    // The Next.js API runs on Vercel and cannot inspect a directory that lives
    // on the selected VPS. At this boundary we can prove only the server-owned
    // root, the contained relative path, and the organisation/project grant.
    // Hermes performs the realpath, symlink, existence, and directory checks
    // again on the authenticated runtime before accepting the run.
    if (!localRuntime || portableHomePath) {
      return { ok: true, directory: portableHomePath ? configuredDirectory : lexicalDirectory, pathClass }
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
