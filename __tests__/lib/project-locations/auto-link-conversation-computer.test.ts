import {
  autoLinkProjectToConversationComputer,
  conversationIdFromProjectCreateBody,
  getProjectConversationComputerLinkStatus,
  resolveConversationComputerLocationId,
} from '@/lib/project-locations/auto-link-conversation-computer'
import type { ProjectExecutionLocation, ProjectLocationReplica } from '@/lib/project-locations/model'

const workspaceContext = {
  workspaceId: 'ws-1',
  orgId: 'org-1',
  orgSlug: 'partners',
  orgName: 'Partners in Biz',
  agentDomain: 'partners',
  vpsPath: '/vps',
  localPath: '/local',
  agentDomainPath: '/vps/partners',
  localAgentDomainPath: '/local/partners',
  sourceOfTruth: 'vps' as const,
  runtimeTarget: 'linked-device:mac-mini',
  runtimeLabel: 'Peets-Mac-mini',
  shareMode: 'private' as const,
  ownerUserId: 'user-1',
  companyId: null,
  contactIds: [] as string[],
}

describe('autoLinkProjectToConversationComputer', () => {
  it('resolves linked-device location ids from conversation runtime targets', () => {
    expect(resolveConversationComputerLocationId('linked-device:mac-mini')).toBe('linked-device:mac-mini')
    expect(resolveConversationComputerLocationId('mac-mini')).toBe('linked-device:mac-mini')
    expect(resolveConversationComputerLocationId('vps')).toBeNull()
    expect(resolveConversationComputerLocationId('auto')).toBeNull()
  })

  it('reads conversationId from project create body variants', () => {
    expect(conversationIdFromProjectCreateBody({ conversationId: 'conv-1' })).toBe('conv-1')
    expect(conversationIdFromProjectCreateBody({ sourceConversationId: 'conv-2' })).toBe('conv-2')
    expect(conversationIdFromProjectCreateBody({
      conversationOrigin: { conversationId: 'conv-3' },
    })).toBe('conv-3')
    expect(conversationIdFromProjectCreateBody({})).toBeNull()
  })

  it('soft-skips when the conversation has no computer binding', async () => {
    const result = await autoLinkProjectToConversationComputer({
      projectId: 'project-1',
      orgId: 'org-1',
      actorUserId: 'user-1',
      workspaceContext: null,
    })
    expect(result).toEqual({ linked: false, reason: 'conversation_has_no_computer' })
  })

  it('links the project to the conversation computer location replica', async () => {
    const location: ProjectExecutionLocation = {
      locationId: 'linked-device:mac-mini',
      label: 'Peets-Mac-mini',
      kind: 'computer',
      platform: 'macos',
      runtimeTargetId: 'linked-device:mac-mini',
      owner: { type: 'user', userId: 'user-1' },
      visibility: 'private',
      allowedOrgIds: ['org-1'],
      status: 'active',
      availability: 'online',
      verificationStatus: 'verified',
      mappings: [{
        mappingId: 'map-1',
        orgId: 'org-1',
        workspaceId: 'ws-1',
        status: 'active',
      }],
      createdAt: null,
      updatedAt: null,
    }
    const replica = {
      replicaId: 'replica-1',
      projectId: 'project-new',
      orgId: 'org-1',
      locationId: location.locationId,
      workspaceId: 'ws-1',
      mappingId: 'map-1',
      relativePath: 'projects/project-new',
      active: true,
    } as ProjectLocationReplica

    const linkProjectLocation = jest.fn(async () => replica)
    const listExecutionLocationsForWorkspace = jest.fn(async () => [location])

    const result = await autoLinkProjectToConversationComputer({
      projectId: 'project-new',
      orgId: 'org-1',
      actorUserId: 'user-1',
      workspaceContext,
    }, {
      listExecutionLocationsForWorkspace,
      linkProjectLocation,
    })

    expect(result).toEqual({
      linked: true,
      locationId: 'linked-device:mac-mini',
      replica,
    })
    expect(linkProjectLocation).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-new',
      orgId: 'org-1',
      workspaceId: 'ws-1',
      locationId: 'linked-device:mac-mini',
      mappingId: 'map-1',
      actorUserId: 'user-1',
      relativePath: 'projects/project-new',
      isCanonical: true,
    }))
  })

  it('returns soft failure when the computer is not available to the org', async () => {
    const result = await autoLinkProjectToConversationComputer({
      projectId: 'project-new',
      orgId: 'org-1',
      actorUserId: 'user-1',
      workspaceContext,
    }, {
      listExecutionLocationsForWorkspace: jest.fn(async () => []),
      linkProjectLocation: jest.fn(),
    })
    expect(result).toEqual({ linked: false, reason: 'computer_not_available_to_org' })
  })
})

describe('getProjectConversationComputerLinkStatus', () => {
  it('reports no_computer when the conversation has no runtime target', async () => {
    const result = await getProjectConversationComputerLinkStatus({
      projectId: 'project-1',
      orgId: 'org-1',
      actorUserId: 'user-1',
      workspaceContext: null,
    })
    expect(result).toEqual({ status: 'no_computer', reason: 'conversation_has_no_computer' })
  })

  it('reports not_linked when no active replica exists on the chat computer', async () => {
    const result = await getProjectConversationComputerLinkStatus({
      projectId: 'project-1',
      orgId: 'org-1',
      actorUserId: 'user-1',
      workspaceContext,
    }, {
      listProjectLocations: jest.fn(async () => []),
    })
    expect(result).toEqual({
      status: 'not_linked',
      locationId: 'linked-device:mac-mini',
      computerLabel: 'Peets-Mac-mini',
      reason: 'no_replica',
    })
  })

  it('reports linked when an active replica matches the chat computer', async () => {
    const result = await getProjectConversationComputerLinkStatus({
      projectId: 'project-1',
      orgId: 'org-1',
      actorUserId: 'user-1',
      workspaceContext,
    }, {
      listProjectLocations: jest.fn(async () => [{
        replicaId: 'replica-1',
        projectId: 'project-1',
        orgId: 'org-1',
        locationId: 'linked-device:mac-mini',
        workspaceId: 'ws-1',
        mappingId: 'map-1',
        relativePath: 'projects/project-1',
        active: true,
        locationLabel: 'Peets-Mac-mini',
      } as ProjectLocationReplica]),
    })
    expect(result).toEqual({
      status: 'linked',
      locationId: 'linked-device:mac-mini',
      computerLabel: 'Peets-Mac-mini',
    })
  })
})
