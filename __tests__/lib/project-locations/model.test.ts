import {
  buildProjectReplica,
  canonicalProjectRelativePath,
  projectReplicaId,
  scopedProjectReplicaId,
  resolveProjectOrgScope,
  type ProjectExecutionLocation,
} from '@/lib/project-locations/model'

const orgLocation: ProjectExecutionLocation = {
  locationId: 'partners-vps',
  label: 'Partners VPS',
  kind: 'vps',
  platform: 'linux',
  runtimeTargetId: 'vps',
  owner: { type: 'organization', orgId: 'pib-platform-owner' },
  visibility: 'organization',
  allowedOrgIds: ['pib-platform-owner'],
  status: 'active',
  availability: 'online',
  verificationStatus: 'verified',
  mappings: [{ mappingId: 'partners-vps-workspace', orgId: 'pib-platform-owner', workspaceId: 'partners', status: 'active' }],
  createdAt: 'now',
  updatedAt: 'now',
}

describe('project location model', () => {
  it('normalises a safe relative path without accepting host paths', () => {
    expect(canonicalProjectRelativePath('project-1', 'projects//project-1/')).toBe('projects/project-1')
    expect(canonicalProjectRelativePath('project-1')).toBe('projects/project-1')
    expect(() => canonicalProjectRelativePath('project-1', '/Users/peetstander/Cowork/project-1')).toThrow('relativePath must be relative')
    expect(() => canonicalProjectRelativePath('project-1', 'projects/../secrets')).toThrow('relativePath contains unsafe segments')
  })

  it('builds a pending replica with explicit revision and sync metadata', () => {
    const replica = buildProjectReplica({
      projectId: 'project-1',
      orgId: 'pib-platform-owner',
      workspaceId: 'partners',
      location: orgLocation,
      mappingId: 'partners-vps-workspace',
      actorUserId: 'peet',
      desiredRevision: 'rev-2',
      currentRevision: 'rev-1',
      now: 'now',
    })

    expect(replica).toEqual(expect.objectContaining({
      replicaId: scopedProjectReplicaId({
        projectId: 'project-1',
        orgId: 'pib-platform-owner',
        workspaceId: 'partners',
        locationId: 'partners-vps',
        mappingId: 'partners-vps-workspace',
      }),
      projectId: 'project-1',
      orgId: 'pib-platform-owner',
      locationId: 'partners-vps',
      mappingId: 'partners-vps-workspace',
      relativePath: 'projects/project-1',
      availability: 'online',
      desiredRevision: 'rev-2',
      currentRevision: 'rev-1',
      syncStatus: 'pending',
      lastSync: null,
      lastError: null,
      lastConflict: null,
      active: true,
    }))
  })

  it('scopes new replica identities by organisation, Workspace, and mapping', () => {
    const base = { projectId: 'shared-project', locationId: 'shared-device' }
    expect(scopedProjectReplicaId({
      ...base, orgId: 'org-a', workspaceId: 'workspace-a', mappingId: 'mapping-a',
    })).not.toBe(scopedProjectReplicaId({
      ...base, orgId: 'org-b', workspaceId: 'workspace-b', mappingId: 'mapping-b',
    }))
    expect(projectReplicaId('shared-project', 'shared-device')).toMatch(/^replica_/)
  })

  it('requires the mapping to belong to the requested organisation and Workspace', () => {
    expect(() => buildProjectReplica({
      projectId: 'project-1', orgId: 'other-org', workspaceId: 'partners', location: orgLocation,
      mappingId: 'partners-vps-workspace', actorUserId: 'peet', now: 'now',
    })).toThrow('location mapping is not active for this organisation and Workspace')
  })

  it('resolves source, recipient, and client-linked organisation scope but denies unrelated orgs', () => {
    const project = {
      orgId: 'source-org',
      sourceOrgId: 'source-org',
      recipientOrgId: 'recipient-org',
      clientOrgIds: ['client-org', 'client-org-2'],
      linkedOrgIds: ['collaborator-org'],
    }
    expect(resolveProjectOrgScope(project, 'source-org')).toBe('source-org')
    expect(resolveProjectOrgScope(project, 'recipient-org')).toBe('recipient-org')
    expect(resolveProjectOrgScope(project, 'client-org-2')).toBe('client-org-2')
    expect(resolveProjectOrgScope(project, 'collaborator-org')).toBe('collaborator-org')
    expect(() => resolveProjectOrgScope(project, 'unrelated-org')).toThrow('project is not linked to this organisation')
  })
})
