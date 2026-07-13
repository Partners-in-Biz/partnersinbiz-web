import { access, mkdtemp, mkdir, realpath, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const mockProjectGet = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => {
      if (name !== 'projects') throw new Error(`Unexpected collection: ${name}`)
      return { doc: () => ({ get: mockProjectGet }) }
    },
  },
}))

import { resolveAuthorizedWorkingDirectory } from '@/lib/client-provisioning/working-directory'

let sandbox: string
let root: string

function context(overrides: Record<string, unknown> = {}) {
  return {
    runtimeTarget: 'local',
    localPath: root,
    localWorkingPath: root,
    vpsPath: '/unused',
    vpsWorkingPath: '/unused',
    orgId: 'org-1',
    folderScope: 'organisation',
    ...overrides,
  } as never
}

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'pib-working-directory-'))
  root = join(sandbox, 'Acme')
  await mkdir(root)
  mockProjectGet.mockReset()
})

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true })
})

it('authorizes a canonical organisation root', async () => {
  const canonicalRoot = await realpath(root)
  await expect(resolveAuthorizedWorkingDirectory({ workspaceContext: context() })).resolves.toEqual({
    ok: true,
    directory: canonicalRoot,
    pathClass: 'organisation',
  })
})

it('authorizes an existing active project directory', async () => {
  const project = join(root, 'projects', 'project-1')
  await mkdir(project, { recursive: true })
  mockProjectGet.mockResolvedValue({
    exists: true,
    data: () => ({ orgId: 'org-1', archived: false, status: 'active' }),
  })
  const canonicalProject = await realpath(project)

  await expect(resolveAuthorizedWorkingDirectory({
    workspaceContext: context({ folderScope: 'project', projectId: 'project-1', localWorkingPath: project }),
  })).resolves.toEqual({ ok: true, directory: canonicalProject, pathClass: 'project' })
})

it('rejects a relative workspace root', async () => {
  await expect(resolveAuthorizedWorkingDirectory({
    workspaceContext: context({ localPath: 'relative/root', localWorkingPath: 'relative/root' }),
  })).resolves.toEqual({ ok: false, code: 'workspace_root_invalid' })
})

it('rejects a missing directory without creating it', async () => {
  const missing = join(root, 'missing')
  const result = await resolveAuthorizedWorkingDirectory({
    workspaceContext: context({ localPath: missing, localWorkingPath: missing }),
  })
  expect(result).toEqual({ ok: false, code: 'workspace_directory_missing' })
  await expect(access(missing)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('rejects a sibling-prefix escape', async () => {
  const sibling = `${root}-evil`
  await mkdir(sibling)
  await expect(resolveAuthorizedWorkingDirectory({
    workspaceContext: context({ localWorkingPath: sibling }),
  })).resolves.toEqual({ ok: false, code: 'workspace_directory_outside_root' })
})

it('rejects parent traversal outside the root', async () => {
  await expect(resolveAuthorizedWorkingDirectory({
    workspaceContext: context({ localWorkingPath: join(root, '..') }),
  })).resolves.toEqual({ ok: false, code: 'workspace_directory_outside_root' })
})

it('rejects a symlink path component', async () => {
  const target = join(root, 'real-project')
  const linked = join(root, 'projects', 'project-1')
  await mkdir(join(root, 'projects'), { recursive: true })
  await mkdir(target)
  await symlink(target, linked)
  mockProjectGet.mockResolvedValue({
    exists: true,
    data: () => ({ orgId: 'org-1', archived: false, status: 'active' }),
  })

  await expect(resolveAuthorizedWorkingDirectory({
    workspaceContext: context({ folderScope: 'project', projectId: 'project-1', localWorkingPath: linked }),
  })).resolves.toEqual({ ok: false, code: 'workspace_directory_symlink' })
})

it('rejects an archived project', async () => {
  const project = join(root, 'projects', 'project-1')
  await mkdir(project, { recursive: true })
  mockProjectGet.mockResolvedValue({
    exists: true,
    data: () => ({ orgId: 'org-1', archived: true, status: 'active' }),
  })

  await expect(resolveAuthorizedWorkingDirectory({
    workspaceContext: context({ folderScope: 'project', projectId: 'project-1', localWorkingPath: project }),
  })).resolves.toEqual({ ok: false, code: 'workspace_project_archived' })
})

it('rejects a missing project', async () => {
  const project = join(root, 'projects', 'project-1')
  await mkdir(project, { recursive: true })
  mockProjectGet.mockResolvedValue({ exists: false, data: () => undefined })

  await expect(resolveAuthorizedWorkingDirectory({
    workspaceContext: context({ folderScope: 'project', projectId: 'project-1', localWorkingPath: project }),
  })).resolves.toEqual({ ok: false, code: 'workspace_project_missing' })
})

it('returns a typed safe failure when the project lookup fails', async () => {
  const project = join(root, 'projects', 'project-1')
  await mkdir(project, { recursive: true })
  mockProjectGet.mockRejectedValue(new Error('Firestore unavailable at internal endpoint'))

  await expect(resolveAuthorizedWorkingDirectory({
    workspaceContext: context({ folderScope: 'project', projectId: 'project-1', localWorkingPath: project }),
  })).resolves.toEqual({ ok: false, code: 'workspace_context_invalid' })
})
