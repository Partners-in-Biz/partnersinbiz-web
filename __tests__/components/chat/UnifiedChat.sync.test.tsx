import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import UnifiedChat from '@/components/chat/UnifiedChat'

jest.mock('@/components/chat/VoiceInputButton', () => ({
  __esModule: true,
  default: () => <button type="button" aria-label="Voice input" />,
}))

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

const workspace = {
  workspaceId: 'acme',
  orgId: 'org-1',
  orgSlug: 'acme',
  orgName: 'Acme',
  agentDomain: 'acme',
  sourceOfTruth: 'vps',
  syncMode: 'hybrid',
  defaultRuntimeTarget: 'runtime-vps',
  folderVersion: 1,
}

const runtimes = [{
  id: 'runtime-vps',
  label: 'Partners VPS',
  locationId: 'location-vps',
  workspaceId: 'acme',
  selectable: true,
  enabled: true,
  isLocal: false,
  isFresh: true,
  isHealthy: true,
  lastSeenAt: null,
}, {
  id: 'runtime-mac',
  label: 'Studio Mac',
  locationId: 'location-mac',
  mappingId: 'mapping-mac',
  workspaceId: 'acme',
  selectable: true,
  enabled: true,
  isLocal: true,
  isFresh: true,
  isHealthy: true,
  lastSeenAt: null,
}]

const vpsReplica = {
  replicaId: 'replica-vps',
  locationId: 'location-vps',
  locationLabel: 'Partners VPS',
  locationKind: 'vps',
  locationVisibility: 'organization',
  availability: 'online',
  syncStatus: 'pending',
  isCanonical: true,
  authenticatedRuntime: true,
  active: true,
}

const macReplica = {
  replicaId: 'replica-mac',
  locationId: 'location-mac',
  locationLabel: 'Studio Mac',
  locationKind: 'computer',
  locationVisibility: 'private',
  availability: 'online',
  syncStatus: 'pending',
  authenticatedRuntime: true,
  active: true,
}

type ProjectSyncFetchOptions = {
  locations?: Record<string, unknown>[]
  syncPost?: () => Promise<Response> | Response
  syncGet?: () => Promise<Response> | Response
  syncDelete?: () => Promise<Response> | Response
  locationPost?: () => Promise<Response> | Response
}

function installProjectSyncFetch(options: ProjectSyncFetchOptions = {}) {
  const syncPosts: Array<Record<string, unknown>> = []
  const syncDeletes: Array<Record<string, unknown>> = []
  const locationPosts: Array<Record<string, unknown>> = []
  let locationReads = 0
  let workspaceReads = 0
  let syncReads = 0

  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/visible-agents')) return jsonResponse({ data: [] })
    if (url.startsWith('/api/v1/workspaces?')) {
      workspaceReads += 1
      return jsonResponse({ data: {
        workspaces: [workspace],
        runtimeTargetsByWorkspace: { acme: runtimes },
        projects: [{ id: 'project-1', name: 'Launch Project' }],
      } })
    }
    if (url.startsWith('/api/v1/conversations?')) return jsonResponse({ data: { conversations: [] } })
    if (url === '/api/v1/projects/project-1/locations?orgId=org-1' && (!init?.method || init.method === 'GET')) {
      locationReads += 1
      return jsonResponse({ data: { locations: options.locations ?? [vpsReplica, macReplica] } })
    }
    if (url === '/api/v1/projects/project-1/locations' && init?.method === 'POST') {
      locationPosts.push(JSON.parse(String(init.body)) as Record<string, unknown>)
      return options.locationPost?.() ?? jsonResponse({ data: { replica: macReplica } }, 201)
    }
    if (url === '/api/v1/projects/project-1/sync?orgId=org-1' && (!init?.method || init.method === 'GET')) {
      syncReads += 1
      return options.syncGet?.() ?? jsonResponse({ data: {
        request: null,
        continuousExecutorVerified: false,
        transferAvailable: false,
        blocker: null,
      } })
    }
    if (url === '/api/v1/projects/project-1/sync' && init?.method === 'POST') {
      syncPosts.push(JSON.parse(String(init.body)) as Record<string, unknown>)
      return options.syncPost?.() ?? jsonResponse({ data: {
        recorded: true,
        created: true,
        transferStarted: true,
        continuousExecutorVerified: true,
        executorStarted: true,
        blocker: null,
        message: 'Native sync executor started.',
        request: { requestId: 'sync-1', status: 'pending_inventory', replicaCount: 2, onlineReplicaCount: 2 },
      } }, 202)
    }
    if (url === '/api/v1/projects/project-1/sync' && init?.method === 'DELETE') {
      syncDeletes.push(JSON.parse(String(init.body)) as Record<string, unknown>)
      return options.syncDelete?.() ?? jsonResponse({ data: {
        cancelled: true,
        request: { requestId: 'sync-conflict', status: 'cancelled', replicaCount: 2, onlineReplicaCount: 2 },
      } })
    }
    throw new Error(`Unhandled fetch: ${url}`)
  })

  return {
    syncPosts,
    syncDeletes,
    locationPosts,
    get locationReads() { return locationReads },
    get workspaceReads() { return workspaceReads },
    get syncReads() { return syncReads },
  }
}

async function openLocationManager() {
  render(<UnifiedChat orgId="org-1" currentUserUid="user-1" currentUserDisplayName="Peet" layoutVariant="hermes" />)
  const project = await screen.findByTestId('hermes-project-project-1')
  fireEvent.click(within(project).getByRole('button', { name: 'More actions for Launch Project' }))
  fireEvent.click(within(project).getByRole('button', { name: 'Manage locations for Launch Project' }))
  return await within(project).findByRole('region', { name: 'Manage locations for Launch Project' })
}

describe('UnifiedChat project replica sync control', () => {
  it.skip('keeps the preflight blocker visible before a request exists and live-refreshes a later conflict', async () => {
    let status: 'idle' | 'conflict' = 'idle'
    const setIntervalSpy = jest.spyOn(window, 'setInterval')
    const clearIntervalSpy = jest.spyOn(window, 'clearInterval')
    const fetchState = installProjectSyncFetch({
      syncGet: () => jsonResponse({ data: status === 'idle' ? {
        request: null,
        continuousExecutorVerified: false,
        transferAvailable: false,
        blocker: 'native_sync_worker_unavailable',
      } : {
        request: {
          requestId: 'sync-conflict', status: 'conflict', replicaCount: 2, onlineReplicaCount: 2,
          conflict: { kind: 'competing_revisions', status: 'open', detectedAt: '2026-07-14T08:00:00.000Z' },
        },
        continuousExecutorVerified: true,
        transferAvailable: true,
        blocker: null,
      } }),
    })

    const manager = await openLocationManager()
    expect(await within(manager).findByText(/waiting for every linked computer and VPS to install and authenticate its sync worker/i)).toBeInTheDocument()
    expect(fetchState.syncReads).toBe(1)

    const pollIndex = setIntervalSpy.mock.calls.findIndex(([, delay]) => delay === 5_000)
    expect(pollIndex).toBeGreaterThanOrEqual(0)
    status = 'conflict'
    await act(async () => {
      const refresh = setIntervalSpy.mock.calls[pollIndex][0] as TimerHandler
      if (typeof refresh === 'function') refresh()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(await within(manager).findByText(/different linked machines contain competing edits/i)).toBeInTheDocument()
    expect(within(manager).getByRole('button', { name: 'Reset sync safely' })).toBeInTheDocument()
    expect(fetchState.syncReads).toBeGreaterThanOrEqual(2)

    const pollHandle = setIntervalSpy.mock.results[pollIndex].value
    fireEvent.click(within(screen.getByTestId('hermes-project-project-1')).getByRole('button', { name: 'Close location manager for Launch Project' }))
    expect(clearIntervalSpy).toHaveBeenCalledWith(pollHandle)
    setIntervalSpy.mockRestore()
    clearIntervalSpy.mockRestore()
  })

  it('explains that the compatibility retention flag attests both Firestore TTL and Storage lifecycle readbacks', async () => {
    installProjectSyncFetch({
      syncGet: () => jsonResponse({ data: {
        request: null,
        continuousExecutorVerified: false,
        transferAvailable: false,
        blocker: 'project_sync_storage_lifecycle_unverified',
      } }),
    })

    const manager = await openLocationManager()

    expect(await within(manager).findByText(/project-sync retention controls.*five Firestore TTL policies.*Storage lifecycle rule/i)).toBeInTheDocument()
    expect(within(manager).getByRole('button', { name: 'Sync now' })).toBeDisabled()
  })

  it('starts native sync, prevents duplicate clicks, and refreshes project state', async () => {
    let resolveSync!: (response: Response) => void
    const pendingSync = new Promise<Response>((resolve) => { resolveSync = resolve })
    const fetchState = installProjectSyncFetch({ syncPost: () => pendingSync })
    const manager = await openLocationManager()

    const button = await within(manager).findByRole('button', { name: 'Sync now' })
    expect(within(manager).getByText(/Current status: Not started/i)).toBeInTheDocument()
    expect(button).toBeEnabled()
    fireEvent.click(button)
    fireEvent.click(button)

    expect(within(manager).getByRole('button', { name: 'Syncing…' })).toBeDisabled()
    expect(fetchState.syncPosts).toEqual([{ orgId: 'org-1' }])

    resolveSync(jsonResponse({ data: {
      recorded: true,
      created: true,
      transferStarted: true,
      continuousExecutorVerified: true,
      executorStarted: true,
      blocker: null,
      message: 'Native sync executor started. Authenticated runtimes will inventory on their next poll.',
      request: { requestId: 'sync-1', status: 'pending_inventory', replicaCount: 2, onlineReplicaCount: 2 },
    } }, 202))

    expect(await within(manager).findByText(/Sync started\. Native sync executor started/i)).toBeInTheDocument()
    await waitFor(() => expect(fetchState.locationReads).toBeGreaterThanOrEqual(2))
    await waitFor(() => expect(fetchState.workspaceReads).toBeGreaterThanOrEqual(2))
    expect(within(manager).getByText(/Current status: Pending inventory/i)).toBeInTheDocument()
  })

  it('reports a recorded request as blocked when native workers are unavailable', async () => {
    installProjectSyncFetch({ syncPost: () => jsonResponse({ data: {
      recorded: true,
      created: true,
      transferStarted: false,
      continuousExecutorVerified: false,
      executorStarted: false,
      blocker: 'native_sync_worker_unavailable',
      message: 'Sync request recorded. File transfer will not start until every replica has an authenticated workspace.sync runtime.',
      request: { requestId: 'sync-2', status: 'waiting_for_locations', replicaCount: 2, onlineReplicaCount: 2 },
    } }, 202) })
    const manager = await openLocationManager()

    fireEvent.click(await within(manager).findByRole('button', { name: 'Sync now' }))

    expect(await within(manager).findByText(/Sync requested, but file transfer is waiting for every linked computer and VPS to install and authenticate its sync worker/i)).toBeInTheDocument()
    expect(within(manager).queryByText(/^Sync started/i)).not.toBeInTheDocument()
    expect(within(manager).getByText(/Current status: Waiting for locations/i)).toBeInTheDocument()
  })

  it('surfaces sync API errors without claiming that sync started', async () => {
    installProjectSyncFetch({ syncPost: () => jsonResponse({ error: 'Project sync state changed concurrently; reload before retrying' }, 409) })
    const manager = await openLocationManager()

    fireEvent.click(await within(manager).findByRole('button', { name: 'Sync now' }))

    expect(await within(manager).findByRole('alert')).toHaveTextContent('Project sync state changed concurrently; reload before retrying')
    expect(within(manager).queryByText(/^Sync started/i)).not.toBeInTheDocument()
  })

  it('keeps sync disabled until two linked replicas including an organisation VPS are eligible', async () => {
    const fetchState = installProjectSyncFetch({ locations: [macReplica] })
    const manager = await openLocationManager()

    expect(await within(manager).findByRole('button', { name: 'Sync now' })).toBeDisabled()
    expect(within(manager).getByText(/Link at least two locations, including an organisation VPS, to keep this project synced/i)).toBeInTheDocument()
    expect(fetchState.syncPosts).toHaveLength(0)
  })

  it('keeps legacy location placeholders out of native sync and explains that pairing is required', async () => {
    const fetchState = installProjectSyncFetch({
      locations: [{ ...vpsReplica, authenticatedRuntime: false }, macReplica],
    })
    const manager = await openLocationManager()

    expect(await within(manager).findByText('Legacy · pairing required')).toBeInTheDocument()
    expect(within(manager).getByText(/Pair every legacy location with an authenticated runtime before enabling sync/i)).toBeInTheDocument()
    expect(within(manager).getByRole('button', { name: 'Sync now' })).toBeDisabled()
    expect(fetchState.syncPosts).toHaveLength(0)
  })

  it('automatically starts sync once after linking the second eligible location', async () => {
    let locations = [vpsReplica]
    const fetchState = installProjectSyncFetch({
      get locations() { return locations },
      locationPost: () => {
        locations = [vpsReplica, macReplica]
        return jsonResponse({ data: { replica: macReplica } }, 201)
      },
    })
    const manager = await openLocationManager()

    fireEvent.click(await within(manager).findByRole('checkbox', { name: 'Studio Mac · online' }))
    fireEvent.click(within(manager).getByRole('button', { name: 'Link selected locations' }))

    await waitFor(() => expect(fetchState.locationPosts).toEqual([{
      orgId: 'org-1', workspaceId: 'acme', locationId: 'location-mac', mappingId: 'mapping-mac',
    }]))
    await waitFor(() => expect(fetchState.syncPosts).toEqual([{ orgId: 'org-1' }]))
    expect(await within(manager).findByText(/Sync started/i)).toBeInTheDocument()
  })

  it('surfaces the preserved conflict and resets it once through the exact organisation-scoped DELETE', async () => {
    let resolveReset!: (response: Response) => void
    const pendingReset = new Promise<Response>((resolve) => { resolveReset = resolve })
    const fetchState = installProjectSyncFetch({
      syncGet: () => jsonResponse({ data: {
        request: {
          requestId: 'sync-conflict', status: 'conflict', replicaCount: 2, onlineReplicaCount: 2,
          conflict: { kind: 'non_destructive_apply_required', status: 'open', detectedAt: '2026-07-14T08:00:00.000Z' },
        },
        continuousExecutorVerified: true, transferAvailable: true, blocker: null,
      } }),
      syncDelete: () => pendingReset,
    })
    const manager = await openLocationManager()

    expect(await within(manager).findByText(/deletion or file\/folder type change needs manual reconciliation/i)).toBeInTheDocument()
    expect(within(manager).getByText(/Both versions were preserved.*before resetting and re-inventorying/i)).toBeInTheDocument()
    const reset = within(manager).getByRole('button', { name: 'Reset sync safely' })
    fireEvent.click(reset)
    fireEvent.click(reset)

    expect(within(manager).getByRole('button', { name: 'Resetting…' })).toBeDisabled()
    expect(fetchState.syncDeletes).toEqual([{ orgId: 'org-1' }])

    resolveReset(jsonResponse({ data: {
      cancelled: true,
      request: { requestId: 'sync-conflict', status: 'cancelled', replicaCount: 2, onlineReplicaCount: 2 },
    } }))
    expect(await within(manager).findByText(/without overwriting either version.*After reconciling the files.*select Sync now/i)).toBeInTheDocument()
    expect(within(manager).getByText(/Current status: Cancelled/i)).toBeInTheDocument()
  })

  it('keeps a failed reset visibly conflicted and never claims the versions were reset', async () => {
    const fetchState = installProjectSyncFetch({
      syncGet: () => jsonResponse({ data: {
        request: {
          requestId: 'sync-conflict', status: 'conflict', replicaCount: 2, onlineReplicaCount: 2,
          conflict: { kind: 'target_drift', status: 'open', detectedAt: '2026-07-14T08:00:00.000Z' },
        },
        continuousExecutorVerified: true, transferAvailable: true, blocker: null,
      } }),
      syncDelete: () => jsonResponse({ error: 'Project sync state changed concurrently; reload before retrying' }, 409),
    })
    const manager = await openLocationManager()

    fireEvent.click(await within(manager).findByRole('button', { name: 'Reset sync safely' }))

    expect(await within(manager).findByRole('alert')).toHaveTextContent('Project sync state changed concurrently; reload before retrying')
    expect(within(manager).getByText(/Current status: Conflict/i)).toBeInTheDocument()
    expect(within(manager).getByText(/Both versions were preserved/i)).toBeInTheDocument()
    expect(within(manager).queryByText(/without overwriting either version/i)).not.toBeInTheDocument()
    expect(fetchState.syncDeletes).toEqual([{ orgId: 'org-1' }])
  })
})
