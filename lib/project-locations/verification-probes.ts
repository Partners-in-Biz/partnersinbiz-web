import { Buffer } from 'node:buffer'
import { lstat, realpath, readdir } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { canonicalProjectRelativePath } from './model'

const SAFE_PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

export interface WorkspaceProjectProbeInput {
  workspaceRoot: string
  projects: Array<{ projectId: string; relativePath: string }>
}

export interface LocalWorkspaceProjectProbeInput extends WorkspaceProjectProbeInput {
  expectedWorkspaceRoot: string
}

export interface WorkspaceFolderObservation {
  workspaceRootMatches: boolean
  projectFolderIds: string[]
  nonEmptyProjectFolderCount: number
}

function assertCanonicalProjects(projects: WorkspaceProjectProbeInput['projects']): void {
  const seen = new Set<string>()
  for (const project of projects) {
    if (!SAFE_PROJECT_ID.test(project.projectId)) throw new Error('invalid project id in folder probe')
    if (project.relativePath !== canonicalProjectRelativePath(project.projectId)) {
      throw new Error('folder probe requires each canonical project path')
    }
    if (seen.has(project.projectId)) throw new Error('duplicate project id in folder probe')
    seen.add(project.projectId)
  }
}

async function isRealDirectoryWithin(root: string, path: string): Promise<boolean> {
  try {
    const stat = await lstat(path)
    if (!stat.isDirectory() || stat.isSymbolicLink()) return false
    const canonical = await realpath(path)
    const relation = relative(root, canonical)
    return relation !== '..' && !relation.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(relation)
  } catch {
    return false
  }
}

export async function inspectLocalWorkspaceProjectFolders(
  input: LocalWorkspaceProjectProbeInput,
): Promise<WorkspaceFolderObservation> {
  assertCanonicalProjects(input.projects)
  const configuredRoot = resolve(input.workspaceRoot)
  const expectedRoot = resolve(input.expectedWorkspaceRoot)
  if (configuredRoot !== expectedRoot) throw new Error('folder probe must use the exact expected workspace root')
  const rootStat = await lstat(configuredRoot).catch(() => null)
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error('exact expected workspace root is not a real directory')
  }
  const canonicalRoot = await realpath(configuredRoot)
  const canonicalExpectedRoot = await realpath(expectedRoot)
  if (canonicalRoot !== canonicalExpectedRoot) throw new Error('folder probe must use the exact expected workspace root')

  const projectFolderIds: string[] = []
  let nonEmptyProjectFolderCount = 0
  const projectRoot = join(canonicalRoot, 'projects')
  if (!await isRealDirectoryWithin(canonicalRoot, projectRoot)) {
    return { workspaceRootMatches: true, projectFolderIds, nonEmptyProjectFolderCount }
  }
  const entries = await readdir(projectRoot, { withFileTypes: true })
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue
    const path = join(projectRoot, entry.name)
    if (!await isRealDirectoryWithin(canonicalRoot, path)) continue
    projectFolderIds.push(entry.name)
    if ((await readdir(path)).length > 0) nonEmptyProjectFolderCount += 1
  }
  return { workspaceRootMatches: true, projectFolderIds, nonEmptyProjectFolderCount }
}

/**
 * Generates a read-only Python inventory program for `ssh ... python3 -`.
 * The manifest is base64 data rather than interpolated shell input.
 */
export function buildRemoteWorkspaceProbeScript(input: WorkspaceProjectProbeInput): string {
  assertCanonicalProjects(input.projects)
  if (!input.workspaceRoot.startsWith('/')) throw new Error('remote workspace root must be absolute')
  const manifest = Buffer.from(JSON.stringify(input), 'utf8').toString('base64')
  return [
    'import base64, json, pathlib',
    `manifest = json.loads(base64.b64decode(${JSON.stringify(manifest)}).decode("utf-8"))`,
    'configured = pathlib.Path(manifest["workspaceRoot"])',
    'root = configured.resolve(strict=True)',
    'root_ok = configured.is_absolute() and configured.is_dir() and not configured.is_symlink() and root == configured',
    'found = []',
    'non_empty = 0',
    'if root_ok:',
    '    project_root = root / "projects"',
    '    if project_root.is_dir() and not project_root.is_symlink() and project_root.resolve(strict=True) == project_root:',
    '        for candidate in sorted(project_root.iterdir(), key=lambda path: path.name):',
    '            if candidate.is_dir() and not candidate.is_symlink() and candidate.resolve(strict=True) == candidate:',
    '                found.append(candidate.name)',
    '                if any(candidate.iterdir()):',
    '                    non_empty += 1',
    'print(json.dumps({"workspaceRootMatches": root_ok, "projectFolderIds": found, "nonEmptyProjectFolderCount": non_empty}, separators=(",", ":")))',
    '',
  ].join('\n')
}

export function parseRemoteWorkspaceProbeOutput(output: string): WorkspaceFolderObservation {
  try {
    const parsed = JSON.parse(output.trim()) as Record<string, unknown>
    if (typeof parsed.workspaceRootMatches !== 'boolean' || !Array.isArray(parsed.projectFolderIds)
      || !parsed.projectFolderIds.every((id) => typeof id === 'string' && SAFE_PROJECT_ID.test(id))
      || !Number.isInteger(parsed.nonEmptyProjectFolderCount)
      || (parsed.nonEmptyProjectFolderCount as number) < 0
      || (parsed.nonEmptyProjectFolderCount as number) > parsed.projectFolderIds.length) {
      if (Array.isArray(parsed.projectFolderIds)
        && parsed.projectFolderIds.some((id) => typeof id !== 'string' || !SAFE_PROJECT_ID.test(id))) {
        throw new Error('invalid project id in remote folder evidence')
      }
      throw new Error('invalid remote folder evidence')
    }
    return {
      workspaceRootMatches: parsed.workspaceRootMatches,
      projectFolderIds: [...parsed.projectFolderIds] as string[],
      nonEmptyProjectFolderCount: parsed.nonEmptyProjectFolderCount as number,
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'invalid project id in remote folder evidence') throw error
    throw new Error('invalid remote folder evidence')
  }
}
