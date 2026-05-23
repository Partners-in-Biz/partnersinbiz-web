import { normalizeWorkspaceFolderMappings } from '@/lib/workspace-folder-mappings'

describe('normalizeWorkspaceFolderMappings', () => {
  it('supports many folder records with visibility, hierarchy, drive links and sync metadata', () => {
    const mappings = normalizeWorkspaceFolderMappings([
      {
        id: 'folder-assets',
        name: 'Source assets',
        parentId: 'root',
        resourceType: 'client_workspace',
        resourceId: 'org_1',
        folderType: 'assets',
        tags: 'drive, source, drive',
        sortOrder: '2',
        driveFolderId: ' 1AbC ',
        driveFolderUrl: 'https://drive.google.com/drive/folders/1AbC',
        pathHints: { vps: '/var/lib/hermes/Cowork/Client/assets', local: '~/Cowork/Client/assets' },
        visibility: 'admin_agents_clients',
        sourceOfTruth: 'google_drive',
        syncMode: 'full',
        syncTargets: ['vps', 'local_cowork'],
        syncStatus: 'conflict',
        auditStatus: 'needs_review',
        permissionNotes: 'Drive ACL excludes clients unless folder visibility is explicitly client-safe.',
      },
      {
        id: 'folder-internal',
        name: 'Internal Ops',
        visibility: 'clients',
        syncTargets: ['unknown', 'vps'],
      },
    ])

    expect(mappings).toHaveLength(2)
    expect(mappings[0]).toMatchObject({
      id: 'folder-assets',
      name: 'Source assets',
      parentId: 'root',
      folderType: 'assets',
      tags: ['drive', 'source'],
      sortOrder: 2,
      driveFolderId: '1AbC',
      driveFolderUrl: 'https://drive.google.com/drive/folders/1AbC',
      pathHints: { vps: '/var/lib/hermes/Cowork/Client/assets', local: '~/Cowork/Client/assets' },
      visibility: 'admin_agents_clients',
      sourceOfTruth: 'google_drive',
      syncMode: 'full',
      syncTargets: ['vps', 'local_cowork'],
      syncStatus: 'conflict',
      auditStatus: 'needs_review',
    })
    expect(mappings[1]).toMatchObject({
      id: 'folder-internal',
      name: 'Internal Ops',
      visibility: 'admin_agents',
      syncTargets: ['vps'],
    })
  })

  it('keeps client portal exposure deferred unless a folder explicitly opts in', () => {
    const mappings = normalizeWorkspaceFolderMappings([
      { id: 'client-safe', name: 'Client uploads', visibility: 'admin_agents_clients' },
      { id: 'private', name: 'Agent notes', visibility: 'admin_agents' },
    ])

    expect(mappings.map(folder => folder.exposeInClientPortal)).toEqual([false, false])
    expect(mappings[0].visibility).toBe('admin_agents_clients')
  })
})
