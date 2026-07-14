import { mkdtemp, mkdir, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildRemoteWorkspaceProbeScript,
  inspectLocalWorkspaceProjectFolders,
  parseRemoteWorkspaceProbeOutput,
} from '@/lib/project-locations/verification-probes'

describe('project-location verification folder probes', () => {
  it('checks the exact local workspace root and reports only real canonical project directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pib-location-verification-'))
    await mkdir(join(root, 'projects', 'project-a'), { recursive: true })
    await mkdir(join(root, 'projects', 'unexpected-project'), { recursive: true })
    const evidence = await inspectLocalWorkspaceProjectFolders({
      workspaceRoot: root,
      expectedWorkspaceRoot: root,
      projects: [
        { projectId: 'project-a', relativePath: 'projects/project-a' },
        { projectId: 'project-b', relativePath: 'projects/project-b' },
      ],
    })
    expect(evidence).toEqual({
      workspaceRootMatches: true,
      projectFolderIds: ['project-a', 'unexpected-project'],
      nonEmptyProjectFolderCount: 0,
    })
    expect(JSON.stringify(evidence)).not.toContain(root)
  })

  it('does not treat symlinked project folders as exact filesystem evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pib-location-verification-'))
    const outside = await mkdtemp(join(tmpdir(), 'pib-location-outside-'))
    await mkdir(join(root, 'projects'), { recursive: true })
    await symlink(outside, join(root, 'projects', 'project-a'))
    const evidence = await inspectLocalWorkspaceProjectFolders({
      workspaceRoot: root,
      expectedWorkspaceRoot: root,
      projects: [{ projectId: 'project-a', relativePath: 'projects/project-a' }],
    })
    expect(evidence.projectFolderIds).toEqual([])
  })

  it('fails closed for a different configured root or a non-canonical relative path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pib-location-verification-'))
    const other = await mkdtemp(join(tmpdir(), 'pib-location-verification-'))
    await expect(inspectLocalWorkspaceProjectFolders({
      workspaceRoot: other,
      expectedWorkspaceRoot: root,
      projects: [],
    })).rejects.toThrow('exact expected workspace root')
    await expect(inspectLocalWorkspaceProjectFolders({
      workspaceRoot: root,
      expectedWorkspaceRoot: root,
      projects: [{ projectId: 'project-a', relativePath: '../project-a' }],
    })).rejects.toThrow('canonical project path')
  })

  it('builds a data-only SSH Python probe and rejects malformed remote output', () => {
    const script = buildRemoteWorkspaceProbeScript({
      workspaceRoot: '/var/lib/hermes/Cowork/Partners in Biz',
      projects: [{ projectId: 'project-a', relativePath: 'projects/project-a' }],
    })
    expect(script).toContain('pathlib.Path')
    expect(script).toContain('is_symlink')
    expect(script).toContain('iterdir()')
    expect(script).not.toContain('rm -')
    expect(parseRemoteWorkspaceProbeOutput('{"workspaceRootMatches":true,"projectFolderIds":["project-a"],"nonEmptyProjectFolderCount":0}')).toEqual({
      workspaceRootMatches: true,
      projectFolderIds: ['project-a'],
      nonEmptyProjectFolderCount: 0,
    })
    expect(() => parseRemoteWorkspaceProbeOutput('{"workspaceRootMatches":true,"projectFolderIds":["../escape"]}'))
      .toThrow('invalid project id')
    expect(() => parseRemoteWorkspaceProbeOutput('not-json')).toThrow('invalid remote folder evidence')
  })
})
