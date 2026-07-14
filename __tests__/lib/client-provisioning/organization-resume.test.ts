import {
  resumeClientOrganizationWorkspace,
  type ClientOrganizationResumeDependencies,
} from '@/lib/client-provisioning/organization-resume'

function dependencies(overrides: Partial<ClientOrganizationResumeDependencies> = {}): ClientOrganizationResumeDependencies {
  return {
    getOrganization: jest.fn().mockResolvedValue({
      id: 'client-org', name: 'Acme', slug: 'acme', type: 'client', createdBy: 'admin-1',
      provisioning: { status: 'failed', agentName: 'Pip' },
    }),
    provision: jest.fn().mockResolvedValue({
      profile: { agentId: 'pip' }, workspace: { directoriesCreated: [] },
    }),
    upsertWorkspace: jest.fn().mockResolvedValue({ workspaceId: 'acme' }),
    patchOrganization: jest.fn().mockResolvedValue(undefined),
    now: jest.fn(() => 'now'),
    ...overrides,
  }
}

describe('resumeClientOrganizationWorkspace', () => {
  it('retries provisioning on the already-created caller-owned organisation', async () => {
    const deps = dependencies()
    const result = await resumeClientOrganizationWorkspace({
      organizationId: 'client-org', organizationSlug: 'acme', clientName: 'Acme', agentName: 'Pip',
      actor: { uid: 'admin-1', role: 'admin', orgId: 'pib-org' },
    }, deps)

    expect(result).toEqual(expect.objectContaining({
      ok: true, status: 200, data: expect.objectContaining({ id: 'client-org', slug: 'acme' }),
    }))
    expect(deps.provision).toHaveBeenCalledWith(expect.objectContaining({
      clientName: 'Acme', domain: 'acme', orgId: 'client-org', agentName: 'Pip',
    }))
    expect(deps.patchOrganization).toHaveBeenCalledWith('client-org', expect.objectContaining({
      workspaceId: 'acme', provisioning: expect.objectContaining({ status: 'complete' }),
    }))
  })

  it('refuses to resume an organisation not created by the idempotent caller', async () => {
    const deps = dependencies({
      getOrganization: jest.fn().mockResolvedValue({
        id: 'client-org', name: 'Acme', slug: 'acme', type: 'client', createdBy: 'other-admin',
        provisioning: { status: 'failed' },
      }),
    })

    const result = await resumeClientOrganizationWorkspace({
      organizationId: 'client-org', organizationSlug: 'acme', clientName: 'Acme',
      actor: { uid: 'admin-1', role: 'admin', orgId: 'pib-org' },
    }, deps)

    expect(result).toEqual({ ok: false, status: 403, error: 'Client organisation resume is forbidden' })
    expect(deps.provision).not.toHaveBeenCalled()
  })

  it('returns the existing completed workspace without provisioning twice', async () => {
    const deps = dependencies({
      getOrganization: jest.fn().mockResolvedValue({
        id: 'client-org', name: 'Acme', slug: 'acme', type: 'client', createdBy: 'admin-1', workspaceId: 'acme',
        provisioning: { status: 'complete' },
      }),
    })

    const result = await resumeClientOrganizationWorkspace({
      organizationId: 'client-org', organizationSlug: 'acme', clientName: 'Acme',
      actor: { uid: 'admin-1', role: 'admin', orgId: 'pib-org' },
    }, deps)

    expect(result).toEqual({
      ok: true, status: 200, data: { id: 'client-org', slug: 'acme', provisioning: { status: 'complete' } },
    })
    expect(deps.provision).not.toHaveBeenCalled()
  })
})
