import type { ApiUser } from '@/lib/api/types'
import type { ProjectExecutionLocation, ProjectLocationReplica } from '@/lib/project-locations/model'
import {
  ProjectSetupExecutionError,
  executeProjectSetup,
  type ProjectSetupExecutionCheckpoint,
  type ProjectSetupExecutionDependencies,
} from '@/lib/project-locations/project-setup-execution'

const actor: ApiUser = {
  uid: 'peet-user',
  role: 'admin',
  orgId: 'pib-org',
}

function location(input: {
  id: string
  kind: 'vps' | 'computer'
  mappingId: string
  availability?: 'online' | 'offline' | 'unknown'
}): ProjectExecutionLocation {
  return {
    locationId: input.id,
    label: input.kind === 'vps' ? 'Partners VPS' : "Peet's Mac",
    kind: input.kind,
    platform: input.kind === 'vps' ? 'linux' : 'macos',
    runtimeTargetId: input.id,
    owner: input.kind === 'vps'
      ? { type: 'organization', orgId: 'pib-org' }
      : { type: 'user', userId: 'peet-user' },
    visibility: input.kind === 'vps' ? 'organization' : 'private',
    allowedOrgIds: ['pib-org'],
    status: 'active',
    availability: input.availability ?? 'online',
    verificationStatus: 'verified',
    mappings: [{
      mappingId: input.mappingId,
      orgId: 'pib-org',
      workspaceId: 'partners',
      status: 'active',
    }],
    createdAt: 'now',
    updatedAt: 'now',
  }
}

const vps = location({ id: 'partners-vps', kind: 'vps', mappingId: 'vps-map' })
const mac = location({ id: 'peets-mac', kind: 'computer', mappingId: 'mac-map' })

function replica(locationInput: ProjectExecutionLocation, relativePath: string): ProjectLocationReplica {
  return {
    replicaId: `replica-${locationInput.locationId}`,
    projectId: 'project-1',
    orgId: 'pib-org',
    workspaceId: 'partners',
    locationId: locationInput.locationId,
    locationLabel: locationInput.label,
    locationKind: locationInput.kind,
    locationPlatform: locationInput.platform,
    locationOwner: locationInput.owner,
    locationVisibility: locationInput.visibility,
    mappingId: locationInput.mappings[0].mappingId,
    relativePath,
    availability: locationInput.availability,
    desiredRevision: null,
    currentRevision: null,
    syncStatus: locationInput.availability === 'offline' ? 'offline' : 'pending',
    lastSync: null,
    lastError: null,
    lastConflict: null,
    active: true,
    linkedByUserId: 'peet-user',
    createdAt: 'now',
    updatedAt: 'now',
  }
}

function dependencies(overrides: Partial<ProjectSetupExecutionDependencies> = {}): ProjectSetupExecutionDependencies {
  return {
    createProject: jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      data: { id: 'project-1' },
    }),
    createOrganization: jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      data: { id: 'client-org', slug: 'acme', provisioning: { status: 'complete' } },
    }),
    resumeOrganization: jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      data: { id: 'client-org', slug: 'acme', provisioning: { status: 'complete' } },
    }),
    getWorkspace: jest.fn().mockResolvedValue({
      workspaceId: 'partners',
      orgId: 'pib-org',
      vpsPath: '/var/lib/hermes/Cowork/partners/Partners in Biz',
      localPath: '/Users/peetstander/Cowork/partners/Partners in Biz',
    }),
    getWorkspaceFolder: jest.fn().mockResolvedValue(null),
    listExecutionLocations: jest.fn().mockResolvedValue([vps, mac]),
    provisionProjectFolder: jest.fn().mockResolvedValue({
      projectId: 'project-1',
      relativePath: 'projects/project-1',
      folderStatus: 'provisioned',
      syncStatus: 'pending',
      manifestWritten: true,
      manifestPreserved: false,
      directoriesCreated: ['projects/project-1/docs'],
      directoriesPreserved: [],
    }),
    linkProjectLocation: jest.fn().mockImplementation(async (input) => {
      const selected = input.locationId === vps.locationId ? vps : mac
      return { ...replica(selected, input.relativePath), isCanonical: input.isCanonical === true }
    }),
    patchProject: jest.fn().mockResolvedValue(undefined),
    patchWorkspaceFolder: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('executeProjectSetup', () => {
  it('creates a standard project, provisions the canonical client-manager folder, and links every selected machine without claiming sync', async () => {
    const deps = dependencies()

    const result = await executeProjectSetup({
      mode: 'standard',
      orgId: 'pib-org',
      projectName: 'World-class email',
      workspaceId: 'partners',
      locationIds: ['partners-vps', 'peets-mac'],
    }, actor, deps)

    expect(deps.createProject).toHaveBeenCalledWith(expect.objectContaining({
      name: 'World-class email',
      orgId: 'pib-org',
    }))
    expect(deps.provisionProjectFolder).toHaveBeenCalledWith({
      projectId: 'project-1',
      orgId: 'pib-org',
      workspaceId: 'partners',
      workspacePath: '/var/lib/hermes/Cowork/partners/Partners in Biz',
    })
    expect(deps.linkProjectLocation).toHaveBeenNthCalledWith(1, expect.objectContaining({
      projectId: 'project-1',
      locationId: 'partners-vps',
      mappingId: 'vps-map',
      relativePath: 'projects/project-1',
      isCanonical: true,
    }))
    expect(deps.linkProjectLocation).toHaveBeenNthCalledWith(2, expect.objectContaining({
      locationId: 'peets-mac',
      mappingId: 'mac-map',
      relativePath: 'projects/project-1',
      isCanonical: false,
    }))
    expect(result).toMatchObject({
      status: 202,
      projectId: 'project-1',
      project: { id: 'project-1', name: 'World-class email', orgId: 'pib-org' },
      plan: {
        state: 'created_sync_pending',
        completed: false,
        syncCompleted: false,
      },
    })
    expect(result.replicas).toHaveLength(2)
    expect(result.replicas.every((row) => row.syncStatus !== 'synced')).toBe(true)
  })

  it('makes a single provisioned organisation VPS immediately ready as the authoritative location', async () => {
    const deps = dependencies()

    const result = await executeProjectSetup({
      mode: 'standard',
      orgId: 'pib-org',
      projectName: 'VPS-first project',
      workspaceId: 'partners',
      locationIds: ['partners-vps'],
    }, actor, deps)

    expect(result).toMatchObject({
      status: 201,
      replicas: [{ locationId: 'partners-vps', isCanonical: true }],
      plan: { state: 'ready', completed: true, syncCompleted: true },
    })
  })

  it('returns a truthful partial result when the canonical folder could not be created', async () => {
    const deps = dependencies({
      provisionProjectFolder: jest.fn().mockRejectedValue(new Error('VPS unavailable')),
    })

    const result = await executeProjectSetup({
      mode: 'standard',
      orgId: 'pib-org',
      projectName: 'Partial project',
      workspaceId: 'partners',
      locationIds: ['partners-vps'],
    }, actor, deps)

    expect(result).toMatchObject({
      status: 207,
      projectId: 'project-1',
      replicas: [],
      plan: { state: 'partial', completed: false, syncCompleted: false },
    })
    expect(result.plan.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'create_standard_project_folder', status: 'failed', error: 'VPS unavailable' }),
      expect.objectContaining({ type: 'link_project_location', status: 'blocked' }),
    ]))
    expect(deps.linkProjectLocation).not.toHaveBeenCalled()
  })

  it('keeps successful replicas and reports the failed machine when one location link is partial', async () => {
    const deps = dependencies({
      linkProjectLocation: jest.fn().mockImplementation(async (input) => {
        if (input.locationId === 'peets-mac') throw new Error('computer unavailable')
        return replica(vps, input.relativePath)
      }),
    })

    const result = await executeProjectSetup({
      mode: 'standard', orgId: 'pib-org', projectName: 'Mixed result', workspaceId: 'partners',
      locationIds: ['partners-vps', 'peets-mac'],
    }, actor, deps)

    expect(result.status).toBe(207)
    expect(result.replicas.map((row) => row.locationId)).toEqual(['partners-vps'])
    expect(result.plan).toMatchObject({ state: 'partial', completed: false, syncCompleted: false })
    expect(result.plan.actions).toContainEqual(expect.objectContaining({
      type: 'link_project_location', locationId: 'peets-mac', status: 'failed', error: 'computer unavailable',
    }))
  })

  it('links only a registered server-side folder path and derives the mapping instead of trusting browser paths', async () => {
    const deps = dependencies({
      getWorkspaceFolder: jest.fn().mockResolvedValue({
        id: 'folder-registered',
        orgId: 'pib-org',
        name: 'Existing campaign',
        deleted: false,
        projectId: null,
        resourceType: 'client_workspace',
        resourceId: 'partners:existing-campaign',
        paths: {
          vpsPath: '/var/lib/hermes/Cowork/partners/Partners in Biz/campaigns/existing',
          localPathHint: '/Users/peetstander/Cowork/partners/Partners in Biz/campaigns/existing',
        },
      }),
    })

    const result = await executeProjectSetup({
      mode: 'existing_folder',
      orgId: 'pib-org',
      projectName: 'Existing campaign',
      workspaceId: 'partners',
      workspaceFolderId: 'folder-registered',
      locationIds: ['partners-vps', 'peets-mac'],
      relativePath: '../../browser-supplied',
      mappingId: 'browser-supplied',
    }, actor, deps)

    expect(deps.getWorkspaceFolder).toHaveBeenCalledWith('folder-registered', 'pib-org', actor)
    expect(deps.linkProjectLocation).toHaveBeenNthCalledWith(1, expect.objectContaining({
      locationId: 'partners-vps', mappingId: 'vps-map', relativePath: 'campaigns/existing',
    }))
    expect(deps.linkProjectLocation).toHaveBeenNthCalledWith(2, expect.objectContaining({
      locationId: 'peets-mac', mappingId: 'mac-map', relativePath: 'campaigns/existing',
    }))
    expect(deps.patchWorkspaceFolder).toHaveBeenCalledWith('folder-registered', { projectId: 'project-1' })
    expect(deps.provisionProjectFolder).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      status: 202,
      plan: { state: 'created_sync_pending', completed: false, syncCompleted: false },
    })
  })

  it('accepts the wizard singular runtime target id while resolving the canonical location and server mapping', async () => {
    const runtimeVps = {
      ...vps,
      runtimeTargetId: 'vps',
      legacyCompatibilityTargetId: 'legacy-vps',
    }
    const deps = dependencies({
      listExecutionLocations: jest.fn().mockResolvedValue([runtimeVps]),
      getWorkspaceFolder: jest.fn().mockResolvedValue({
        id: 'folder-registered', orgId: 'pib-org', name: 'Existing campaign', deleted: false,
        projectId: null, resourceType: null, resourceId: null,
        paths: {
          vpsPath: '/var/lib/hermes/Cowork/partners/Partners in Biz/campaigns/existing',
          localPathHint: null,
        },
      }),
    })

    await executeProjectSetup({
      mode: 'existing_folder', orgId: 'pib-org', projectName: 'Existing campaign', workspaceId: 'partners',
      workspaceFolderId: 'folder-registered', locationId: 'vps', mappingId: 'untrusted-browser-map',
    }, actor, deps)

    expect(deps.linkProjectLocation).toHaveBeenCalledWith(expect.objectContaining({
      locationId: 'partners-vps', mappingId: 'vps-map', relativePath: 'campaigns/existing',
    }))
  })

  it('rejects a registered folder outside the workspace before creating a project', async () => {
    const deps = dependencies({
      getWorkspaceFolder: jest.fn().mockResolvedValue({
        id: 'folder-outside',
        orgId: 'pib-org',
        name: 'Outside',
        deleted: false,
        projectId: null,
        resourceType: null,
        resourceId: null,
        paths: { vpsPath: '/etc/private', localPathHint: '/tmp/private' },
      }),
    })

    await expect(executeProjectSetup({
      mode: 'existing_folder', orgId: 'pib-org', projectName: 'Outside', workspaceId: 'partners',
      workspaceFolderId: 'folder-outside', locationIds: ['partners-vps'],
    }, actor, deps)).rejects.toMatchObject<ProjectSetupExecutionError>({ status: 400 })
    expect(deps.createProject).not.toHaveBeenCalled()
  })

  it('does not let a forged request link an unverified execution location', async () => {
    const deps = dependencies({
      listExecutionLocations: jest.fn().mockResolvedValue([{ ...vps, verificationStatus: 'pending' }]),
    })

    await expect(executeProjectSetup({
      mode: 'standard', orgId: 'pib-org', projectName: 'Unverified', workspaceId: 'partners',
      locationIds: ['partners-vps'],
    }, actor, deps)).rejects.toMatchObject<ProjectSetupExecutionError>({ status: 403 })
    expect(deps.createProject).not.toHaveBeenCalled()
  })

  it('keeps an authorized but offline native computer non-selectable before project creation', async () => {
    const offlineNative = location({
      id: 'linked-device:office-mac', kind: 'computer', mappingId: 'native-map', availability: 'offline',
    })
    const deps = dependencies({
      listExecutionLocations: jest.fn().mockResolvedValue([offlineNative]),
    })

    await expect(executeProjectSetup({
      mode: 'standard', orgId: 'pib-org', projectName: 'Offline target', workspaceId: 'partners',
      locationIds: ['linked-device:office-mac'],
    }, actor, deps)).rejects.toMatchObject<ProjectSetupExecutionError>({
      status: 409,
      message: 'Computer unavailable',
    })
    expect(deps.createProject).not.toHaveBeenCalled()
  })

  it('rejects a standard project without its verified online organisation VPS before project creation', async () => {
    const deps = dependencies()

    await expect(executeProjectSetup({
      mode: 'standard', orgId: 'pib-org', projectName: 'Mac-only project', workspaceId: 'partners',
      locationIds: ['peets-mac'],
    }, actor, deps)).rejects.toMatchObject<ProjectSetupExecutionError>({
      status: 409,
      message: 'Standard projects require a verified online organisation VPS location',
    })
    expect(deps.createProject).not.toHaveBeenCalled()
    expect(deps.provisionProjectFolder).not.toHaveBeenCalled()
  })

  it('reuses full-client organisation provisioning before creating the linked project', async () => {
    const deps = dependencies({
      getWorkspace: jest.fn().mockImplementation(async (orgId) => ({
        workspaceId: 'acme', orgId, vpsPath: '/var/lib/hermes/Cowork/partners/Acme', localPath: '~/Cowork/partners/Acme',
      })),
      listExecutionLocations: jest.fn().mockResolvedValue([]),
    })

    const result = await executeProjectSetup({
      mode: 'full_client', clientName: 'Acme', domainSlug: 'acme-custom', projectName: 'Acme launch',
    }, actor, deps)

    expect(deps.createOrganization).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Acme', domainSlug: 'acme-custom', provisionWorkspace: true,
    }))
    expect(deps.createProject).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Acme launch', orgId: 'client-org',
    }))
    expect(deps.provisionProjectFolder).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'client-org', workspaceId: 'acme', projectId: 'project-1',
    }))
    expect(result).toMatchObject({
      organizationId: 'client-org', organizationSlug: 'acme', projectId: 'project-1', status: 202,
      plan: { state: 'location_selection_pending', completed: false, syncCompleted: false },
    })
  })

  it('does not continue after a partially provisioned client organisation', async () => {
    const deps = dependencies({
      createOrganization: jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        error: 'Organization created, but workspace provisioning failed',
        data: { id: 'client-org' },
      }),
    })

    const result = await executeProjectSetup({
      mode: 'full_client', clientName: 'Acme', projectName: 'Acme launch',
    }, actor, deps)

    expect(result).toMatchObject({
      organizationId: 'client-org', status: 207,
      plan: { state: 'partial', completed: false, syncCompleted: false },
    })
    expect(deps.createProject).not.toHaveBeenCalled()
  })

  it('reports the created client organisation when subsequent project creation fails', async () => {
    const deps = dependencies({
      getWorkspace: jest.fn().mockResolvedValue({
        workspaceId: 'acme', orgId: 'client-org', vpsPath: '/var/lib/hermes/Cowork/partners/Acme', localPath: '~/Cowork/partners/Acme',
      }),
      createProject: jest.fn().mockResolvedValue({
        ok: false, status: 403, error: 'Project creation is disabled for your organisation role',
      }),
    })

    const result = await executeProjectSetup({
      mode: 'full_client', clientName: 'Acme', domainSlug: 'acme', projectName: 'Acme launch',
    }, actor, deps)

    expect(result).toMatchObject({
      organizationId: 'client-org', status: 207, replicas: [],
      plan: { state: 'partial', completed: false, syncCompleted: false },
    })
    expect(result.projectId).toBeUndefined()
    expect(result.plan.actions).toContainEqual(expect.objectContaining({
      type: 'create_project_record', status: 'failed', error: 'Project creation is disabled for your organisation role',
    }))
  })

  it('resumes the same standard project after folder failure and retries only unfinished side effects', async () => {
    let checkpoint: ProjectSetupExecutionCheckpoint = {}
    const provisionProjectFolder = jest.fn()
      .mockRejectedValueOnce(new Error('VPS temporarily unavailable'))
      .mockResolvedValueOnce({
        projectId: 'project-1', relativePath: 'projects/project-1', folderStatus: 'provisioned', syncStatus: 'pending',
        manifestWritten: true, manifestPreserved: false, directoriesCreated: [], directoriesPreserved: [],
      })
    const deps = dependencies({ provisionProjectFolder })
    const input = {
      mode: 'standard', orgId: 'pib-org', projectName: 'Resume me', workspaceId: 'partners',
      locationIds: ['partners-vps'],
    }
    const saveCheckpoint = jest.fn(async (next: ProjectSetupExecutionCheckpoint) => {
      checkpoint = structuredClone(next)
    })

    const first = await executeProjectSetup(input, actor, deps, {
      requestId: 'setup_operation_resume',
      checkpoint: saveCheckpoint,
    })
    expect(first.status).toBe(207)
    expect(checkpoint).toEqual(expect.objectContaining({ projectId: 'project-1' }))

    const second = await executeProjectSetup(input, actor, deps, {
      requestId: 'setup_operation_resume',
      resume: checkpoint,
      checkpoint: saveCheckpoint,
    })

    expect(second.status).toBe(201)
    expect(second.projectId).toBe('project-1')
    expect(second.plan.requestId).toBe('setup_operation_resume')
    expect(deps.createProject).toHaveBeenCalledTimes(1)
    expect(provisionProjectFolder).toHaveBeenCalledTimes(2)
    expect(deps.linkProjectLocation).toHaveBeenCalledTimes(1)
  })

  it('resumes failed full-client provisioning without creating a second organisation or slug', async () => {
    let checkpoint: ProjectSetupExecutionCheckpoint = {}
    const createOrganization = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      error: 'Organization created, but workspace provisioning failed: private VPS detail',
      data: { id: 'client-org', slug: 'acme' },
    })
    const resumeOrganization = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      data: { id: 'client-org', slug: 'acme', provisioning: { status: 'complete' } },
    })
    const deps = dependencies({
      createOrganization,
      resumeOrganization,
      getWorkspace: jest.fn().mockImplementation(async (orgId) => ({
        workspaceId: 'acme', orgId, vpsPath: '/var/lib/hermes/Cowork/partners/Acme', localPath: '~/Cowork/partners/Acme',
      })),
      listExecutionLocations: jest.fn().mockResolvedValue([]),
    })
    const input = { mode: 'full_client', clientName: 'Acme', domainSlug: 'acme', projectName: 'Acme launch' }
    const saveCheckpoint = async (next: ProjectSetupExecutionCheckpoint) => {
      checkpoint = structuredClone(next)
    }

    const first = await executeProjectSetup(input, actor, deps, { checkpoint: saveCheckpoint })
    expect(first).toMatchObject({ status: 207, organizationId: 'client-org' })
    expect(checkpoint).toEqual(expect.objectContaining({
      organizationId: 'client-org', organizationSlug: 'acme', organizationReady: false,
    }))

    const second = await executeProjectSetup(input, actor, deps, { resume: checkpoint, checkpoint: saveCheckpoint })
    expect(second).toMatchObject({ organizationId: 'client-org', projectId: 'project-1' })
    expect(createOrganization).toHaveBeenCalledTimes(1)
    expect(resumeOrganization).toHaveBeenCalledTimes(1)
    expect(resumeOrganization).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: 'client-org', organizationSlug: 'acme', clientName: 'Acme', actor,
    }))
    expect(deps.createProject).toHaveBeenCalledTimes(1)
  })
})
