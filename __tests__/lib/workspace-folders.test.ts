import {
  normalizeWorkspaceFolderInput,
  canReadWorkspaceFolder,
  workspaceFolderMatchesLookup,
} from '@/lib/workspace-folders/model'

describe('workspace folder model', () => {
  it('normalizes a tenant-safe folder mapping with hierarchy, visibility, paths, permissions, and sync state', () => {
    const folder = normalizeWorkspaceFolderInput({
      name: 'Client Assets',
      resourceType: 'client_org',
      resourceId: 'org-client',
      parentId: 'parent-folder',
      visibility: 'admin_agents_clients',
      tags: [' assets ', 'drive', 'assets'],
      sortOrder: 10,
      driveFolderId: ' 1AbCd ',
      driveFolderUrl: 'https://drive.google.com/drive/folders/1AbCd',
      vpsPath: '/var/lib/hermes/Cowork/Client/Assets',
      localPathHint: '~/Cowork/Client/Assets',
      sourceOfTruth: 'google_drive',
      syncMode: 'full',
      syncTargets: ['vps', 'local', 'vps'],
      permissions: { inheritParent: false, allowedAgentIds: ['theo', 'maya'], allowedRoleIds: ['admin'] },
      syncState: { status: 'conflict', lastSyncedAt: '2026-05-23T00:00:00.000Z', conflictCount: 2 },
      audit: { conflictStatus: 'open', lastConflictAt: '2026-05-23T01:00:00.000Z', notes: 'Needs merge review' },
    }, 'org-1')

    expect(folder).toMatchObject({
      orgId: 'org-1',
      name: 'Client Assets',
      resourceType: 'client_org',
      resourceId: 'org-client',
      parentId: 'parent-folder',
      visibility: 'admin_agents_clients',
      tags: ['assets', 'drive'],
      sortOrder: 10,
      drive: { folderId: '1AbCd', folderUrl: 'https://drive.google.com/drive/folders/1AbCd' },
      paths: { vpsPath: '/var/lib/hermes/Cowork/Client/Assets', localPathHint: '~/Cowork/Client/Assets' },
      sourceOfTruth: 'google_drive',
      syncMode: 'full',
      syncTargets: ['vps', 'local'],
      permissions: { inheritParent: false, allowedAgentIds: ['theo', 'maya'], allowedRoleIds: ['admin'] },
      syncState: { status: 'conflict', lastSyncedAt: '2026-05-23T00:00:00.000Z', conflictCount: 2 },
      audit: { conflictStatus: 'open', lastConflictAt: '2026-05-23T01:00:00.000Z', notes: 'Needs merge review' },
      deleted: false,
    })
  })

  it('rejects unsafe or invalid folder payloads', () => {
    expect(() => normalizeWorkspaceFolderInput({ name: '', visibility: 'public' }, 'org-1')).toThrow('name is required')
    expect(() => normalizeWorkspaceFolderInput({ name: 'X', sourceOfTruth: 'dropbox' }, 'org-1')).toThrow('Invalid sourceOfTruth')
    expect(() => normalizeWorkspaceFolderInput({ name: 'X', driveFolderUrl: 'javascript:alert(1)' }, 'org-1')).toThrow('driveFolderUrl must be an http(s) URL')
    expect(() => normalizeWorkspaceFolderInput({ name: 'X', vpsPath: '../secret' }, 'org-1')).toThrow('vpsPath must be an absolute path')
  })

  it('enforces hybrid visibility for clients and agents', () => {
    const clientVisible = normalizeWorkspaceFolderInput({ name: 'Shared', visibility: 'admin_agents_clients' }, 'org-1')
    const agentOnly = normalizeWorkspaceFolderInput({ name: 'Agent Notes', visibility: 'admin_agents' }, 'org-1')
    const adminOnly = normalizeWorkspaceFolderInput({ name: 'Private', visibility: 'admin_only' }, 'org-1')

    expect(canReadWorkspaceFolder(clientVisible, { role: 'client', uid: 'u1', orgId: 'org-1' })).toBe(true)
    expect(canReadWorkspaceFolder(agentOnly, { role: 'client', uid: 'u1', orgId: 'org-1' })).toBe(false)
    expect(canReadWorkspaceFolder(adminOnly, { role: 'ai', uid: 'agent:theo', agentId: 'theo' })).toBe(false)
    expect(canReadWorkspaceFolder(agentOnly, { role: 'ai', uid: 'agent:theo', agentId: 'theo' })).toBe(true)
  })

  it('matches stable agent lookup filters without leaking unrelated resources', () => {
    const folder = normalizeWorkspaceFolderInput({
      name: 'Brief assets',
      resourceType: 'project',
      resourceId: 'proj-1',
      tags: ['brief', 'assets'],
    }, 'org-1')

    expect(workspaceFolderMatchesLookup(folder, { resourceType: 'project', resourceId: 'proj-1', tag: 'assets' })).toBe(true)
    expect(workspaceFolderMatchesLookup(folder, { resourceType: 'project', resourceId: 'proj-2' })).toBe(false)
    expect(workspaceFolderMatchesLookup(folder, { resourceType: 'client_org', resourceId: 'proj-1' })).toBe(false)
  })
})
