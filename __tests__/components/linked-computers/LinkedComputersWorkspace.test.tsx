import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { LinkedComputersWorkspace } from '@/components/linked-computers/LinkedComputersWorkspace'

const device = {
  deviceId: 'device-a', label: 'Studio Mac', platform: 'macos', architecture: 'arm64',
  runtimeVersion: '2.4.1', capabilities: ['workspace.execute'], status: 'active', credentialVersion: 3,
  health: 'ok', lastSeenAt: '2026-07-13T08:59:30.000Z', createdAt: '', updatedAt: '',
  grants: [{ orgId: 'org-a', orgLabel: 'Acme', status: 'active', accessMode: 'organization' }],
  mappings: [{ mappingId: 'map-a', orgId: 'org-a', workspaceId: 'workspace-a', label: 'Acme Workspace', status: 'active' }],
}

function response(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 400, json: async () => body } as Response
}

describe('LinkedComputersWorkspace', () => {
  const originalBootstrapPlatforms = process.env.NEXT_PUBLIC_LINKED_RUNTIME_BOOTSTRAP_PLATFORMS

  beforeEach(() => {
    process.env.NEXT_PUBLIC_LINKED_RUNTIME_BOOTSTRAP_PLATFORMS = 'macos,windows,linux'
    jest.useFakeTimers().setSystemTime(new Date('2026-07-13T09:00:00.000Z'))
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/v1/linked-computers') return response({ data: [device] })
      if (String(input) === '/api/v1/workspaces') return response({ data: { workspaces: [{ workspaceId: 'workspace-b', orgId: 'org-b', orgName: 'Beta Workspace' }] } })
      return response({ success: true, data: { challengeId: 'challenge-a', secret: 'PAIR-123', expiresAt: '2026-07-13T09:10:00.000Z' } })
    })
  })
  afterEach(() => jest.useRealTimers())
  afterAll(() => {
    if (originalBootstrapPlatforms === undefined) delete process.env.NEXT_PUBLIC_LINKED_RUNTIME_BOOTSTRAP_PLATFORMS
    else process.env.NEXT_PUBLIC_LINKED_RUNTIME_BOOTSTRAP_PLATFORMS = originalBootstrapPlatforms
  })

  it('renders a grant chip per organisation including teams and selected people', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/v1/linked-computers') return response({
        data: [{
          ...device,
          grants: [
            { orgId: 'org-a', orgLabel: 'Acme', status: 'active', accessMode: 'organization' },
            { orgId: 'org-b', orgLabel: 'Beta', status: 'active', accessMode: 'teams' },
            { orgId: 'org-c', status: 'active', accessMode: 'selected_users' },
          ],
        }],
      })
      if (String(input) === '/api/v1/workspaces') return response({ data: { workspaces: [] } })
      return response({ data: [] })
    })
    render(<LinkedComputersWorkspace />)
    const card = await screen.findByRole('article', { name: 'Studio Mac' })
    expect(card).toHaveTextContent('Acme · Everyone in organisation')
    expect(card).toHaveTextContent('Beta · Teams')
    expect(card).toHaveTextContent('org-c · Selected people')
  })

  it('shows safe health, version, grant, and mapping status without internal data', async () => {
    render(<LinkedComputersWorkspace />)
    const card = await screen.findByRole('article', { name: 'Studio Mac' })
    expect(card).toHaveTextContent('Online')
    expect(card).toHaveTextContent('Version 2.4.1')
    expect(card).toHaveTextContent('Acme')
    expect(card).toHaveTextContent('Everyone in organisation')
    expect(card).toHaveTextContent('Acme Workspace')
    expect(card).toHaveTextContent('Mapped')
    expect(card).not.toHaveTextContent(/\/var\/|~\/|token|credential|endpoint/i)
  })

  it('refreshes live device health so an expired heartbeat becomes Computer unavailable', async () => {
    render(<LinkedComputersWorkspace />)
    const card = await screen.findByRole('article', { name: 'Studio Mac' })
    expect(card).toHaveTextContent('Online')

    await act(async () => {
      jest.setSystemTime(new Date('2026-07-13T09:06:00.000Z'))
      jest.advanceTimersByTime(30_000)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(card).toHaveTextContent('Computer unavailable')
  })

  it('treats a Firestore JSON timestamp heartbeat as online', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/v1/linked-computers') return response({
        data: [{ ...device, lastSeenAt: { _seconds: Date.parse('2026-07-13T08:59:30.000Z') / 1000, _nanoseconds: 0 } }],
      })
      if (String(input) === '/api/v1/workspaces') return response({ data: { workspaces: [] } })
      return response({ data: [] })
    })

    render(<LinkedComputersWorkspace />)
    expect(await screen.findByRole('article', { name: 'Studio Mac' })).toHaveTextContent('Online')
  })

  it('exposes the exact preserved mapping command for a pending adopted Workspace', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/v1/linked-computers') return response({ data: [{
        ...device,
        mappings: [{
          mappingId: 'partners-vps-workspace', orgId: 'org-a', workspaceId: 'workspace-a',
          label: 'Partners Workspace', status: 'pending',
        }],
      }] })
      if (String(input) === '/api/v1/workspaces') return response({ data: { workspaces: [] } })
      return response({ data: [] })
    })

    render(<LinkedComputersWorkspace />)
    expect(await screen.findByLabelText('Map Partners Workspace')).toHaveTextContent(
      'pib-runtime map --mapping partners-vps-workspace --folder <local folder>',
    )
    expect(screen.getByRole('button', { name: 'Copy mapping command' })).toBeInTheDocument()
    expect(screen.getByRole('article', { name: 'Studio Mac' })).toHaveTextContent('Pending local setup')
  })

  it('shows the current organisation VPS and private Mac execution locations even before native pairing', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/v1/linked-computers') return response({ data: [] })
      if (String(input) === '/api/v1/workspaces') return response({ data: {
        workspaces: [{ workspaceId: 'partners', orgId: 'pib-platform-owner', orgName: 'Partners in Biz' }],
        runtimeTargets: [
          { id: 'vps', locationId: 'partners-vps', label: 'Partners VPS', kind: 'vps', platform: 'linux', ownerType: 'organization', visibility: 'organization', selectable: true },
          { id: 'local', locationId: 'peets-mac-mini', label: "Peet's Mac", kind: 'computer', platform: 'macos', ownerType: 'user', visibility: 'private', selectable: false },
        ],
      } })
      return response({})
    })

    render(<LinkedComputersWorkspace />)
    const vps = await screen.findByRole('article', { name: 'Partners VPS' })
    const mac = screen.getByRole('article', { name: "Peet's Mac" })
    expect(vps).toHaveTextContent('VPS')
    expect(vps).toHaveTextContent('Organisation-owned')
    expect(vps).toHaveTextContent('Everyone in organisation')
    expect(vps).toHaveTextContent('Online')
    expect(vps).toHaveTextContent('Legacy project location')
    expect(vps).toHaveTextContent('Authenticated runtime pairing required')
    expect(mac).toHaveTextContent('User-owned')
    expect(mac).toHaveTextContent('Only me')
    expect(mac).toHaveTextContent('Computer unavailable')
    expect(screen.queryByText('No computers linked yet.')).not.toBeInTheDocument()
  })

  it('labels a native project location as authenticated and never offers it for legacy adoption', async () => {
    jest.useRealTimers()
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/linked-computers') return response({ data: [] })
      if (url === '/api/v1/organizations') return response({ data: [{ id: 'org-a', name: 'Acme' }] })
      if (url === '/api/v1/workspaces?orgId=org-a') return response({ data: {
        workspaces: [{ workspaceId: 'workspace-a', orgId: 'org-a', orgName: 'Acme' }],
        runtimeTargets: [{
          id: 'linked-device:native-vps', locationId: 'linked-device:native-vps', label: 'Native VPS',
          kind: 'vps', platform: 'linux', ownerType: 'organization', visibility: 'organization', selectable: true,
        }],
      } })
      return response({ data: { workspaces: [], runtimeTargets: [] } })
    })

    render(<LinkedComputersWorkspace />)
    expect(await screen.findByRole('article', { name: 'Native VPS' })).toHaveTextContent('Authenticated runtime')
    expect(screen.getByRole('article', { name: 'Native VPS' })).not.toHaveTextContent('Legacy project location')
    fireEvent.click(screen.getByRole('button', { name: 'Link a computer or VPS' }))
    fireEvent.click(screen.getByRole('radio', { name: 'VPS' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Organisation' }))
    fireEvent.change(await screen.findByLabelText('Owning organisation'), { target: { value: 'org-a' } })
    expect(screen.queryByLabelText('Existing project location')).not.toBeInTheDocument()
  })

  it('binds an eligible legacy location to the challenge and explains that pairing is still pending proof', async () => {
    jest.useRealTimers()
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/linked-computers') return response({ data: [] })
      if (url === '/api/v1/organizations') return response({ data: [{ id: 'org-a', name: 'Acme' }] })
      if (url === '/api/v1/workspaces?orgId=org-a') return response({ data: {
        workspaces: [{ workspaceId: 'workspace-a', orgId: 'org-a', orgName: 'Acme' }],
        runtimeTargets: [{
          id: 'vps', locationId: 'partners-vps', label: 'Partners VPS', kind: 'vps', platform: 'linux',
          ownerType: 'organization', visibility: 'organization', selectable: true,
        }],
      } })
      if (url === '/api/v1/linked-computers/pairing') return response({ data: {
        challengeId: 'challenge-adopt', secret: 'ADOPT-PAIR', expiresAt: '2026-07-14T10:10:00.000Z',
        adoption: { sourceLocationId: 'partners-vps', state: 'awaiting_runtime_proof' },
      } })
      return response({ data: { workspaces: [], runtimeTargets: [] } })
    })
    global.fetch = fetchMock
    render(<LinkedComputersWorkspace />)
    await screen.findByRole('article', { name: 'Partners VPS' })
    fireEvent.click(screen.getByRole('button', { name: 'Link a computer or VPS' }))
    fireEvent.click(screen.getByRole('radio', { name: 'VPS' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Organisation' }))
    fireEvent.change(await screen.findByLabelText('Owning organisation'), { target: { value: 'org-a' } })
    const adoption = screen.getByLabelText('Existing project location')
    fireEvent.change(adoption, { target: { value: 'partners-vps' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create pairing code' }))

    expect(await screen.findByText('ADOPT-PAIR')).toBeInTheDocument()
    expect(screen.getByText(/stays a legacy project location until this runtime proves ownership/i)).toBeInTheDocument()
    const call = fetchMock.mock.calls.find(([url]) => url === '/api/v1/linked-computers/pairing')
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      deviceKind: 'vps', ownerType: 'organization', ownerOrgId: 'org-a', orgId: 'org-a', agentIds: ['pip'], adoptLocationId: 'partners-vps',
    })
  })

  it('refreshes an adopted legacy location into an authenticated runtime without a page reload', async () => {
    let workspaceReads = 0
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/linked-computers') return response({ data: [] })
      if (url === '/api/v1/organizations') return response({ data: [{ id: 'org-a', name: 'Acme' }] })
      if (url === '/api/v1/workspaces?orgId=org-a') {
        workspaceReads += 1
        return response({ data: {
          workspaces: [{ workspaceId: 'workspace-a', orgId: 'org-a', orgName: 'Acme' }],
          runtimeTargets: workspaceReads === 1 ? [{
            id: 'vps', locationId: 'partners-vps', label: 'Partners VPS', kind: 'vps', platform: 'linux',
            ownerType: 'organization', visibility: 'organization', selectable: true,
          }] : [{
            id: 'linked-device:native-vps', locationId: 'linked-device:native-vps', label: 'Partners VPS',
            kind: 'vps', platform: 'linux', ownerType: 'organization', visibility: 'organization', selectable: true,
          }],
        } })
      }
      if (url === '/api/v1/linked-computers/pairing') return response({ data: {
        challengeId: 'challenge-adopt', secret: 'ADOPT-PAIR', expiresAt: '2026-07-14T10:10:00.000Z',
        adoption: { sourceLocationId: 'partners-vps', state: 'awaiting_runtime_proof' },
      } })
      return response({ data: { workspaces: [], runtimeTargets: [] } })
    })
    global.fetch = fetchMock

    render(<LinkedComputersWorkspace />)
    await screen.findByRole('article', { name: 'Partners VPS' })
    fireEvent.click(screen.getByRole('button', { name: 'Link a computer or VPS' }))
    fireEvent.click(screen.getByRole('radio', { name: 'VPS' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Organisation' }))
    const organizationSelect = await screen.findByLabelText('Owning organisation')
    await within(organizationSelect).findByRole('option', { name: 'Acme' })
    fireEvent.change(organizationSelect, { target: { value: 'org-a' } })
    fireEvent.change(await screen.findByLabelText('Existing project location'), { target: { value: 'partners-vps' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create pairing code' }))
    expect(await screen.findByText(/stays a legacy project location until this runtime proves ownership/i)).toBeInTheDocument()

    await act(async () => {
      jest.advanceTimersByTime(30_000)
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(await screen.findByRole('status')).toHaveTextContent(/Authenticated runtime linked.*project links were preserved/i)
    expect(screen.queryByText(/stays a legacy project location until this runtime proves ownership/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(await screen.findByRole('article', { name: 'Partners VPS' })).toHaveTextContent('Authenticated runtime')
  })

  it('loads Workspace and execution-location choices across every accessible organisation', async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/linked-computers') return response({ data: [device] })
      if (url === '/api/v1/organizations') return response({ data: [
        { id: 'org-a', name: 'Acme' }, { id: 'org-b', name: 'Beta' },
      ] })
      if (url === '/api/v1/workspaces?orgId=org-a') return response({ data: {
        workspaces: [{ workspaceId: 'workspace-a', orgId: 'org-a', orgName: 'Acme' }],
        runtimeTargets: [],
      } })
      if (url === '/api/v1/workspaces?orgId=org-b') return response({ data: {
        workspaces: [{ workspaceId: 'workspace-b', orgId: 'org-b', orgName: 'Beta' }],
        runtimeTargets: [{
          id: 'beta-vps', locationId: 'beta-vps', label: 'Beta VPS', kind: 'vps', platform: 'linux',
          ownerType: 'organization', visibility: 'organization', selectable: true,
        }],
      } })
      return response({})
    })
    global.fetch = fetchMock

    render(<LinkedComputersWorkspace />)
    expect(await screen.findByRole('article', { name: 'Beta VPS' })).toHaveTextContent('Beta')
    fireEvent.click(screen.getByRole('button', { name: 'Manage access for Studio Mac' }))
    const organization = screen.getByRole('combobox', { name: 'Organisation' })
    expect(within(organization).getByRole('option', { name: 'Acme' })).toBeInTheDocument()
    expect(within(organization).getByRole('option', { name: 'Beta' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/workspaces?orgId=org-a')
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/workspaces?orgId=org-b')
  })

  it('traps and restores focus while dialogs and action menus support Escape dismissal', async () => {
    render(<LinkedComputersWorkspace />)
    await screen.findByText('Studio Mac')
    const pairTrigger = screen.getByRole('button', { name: 'Link a computer or VPS' })
    pairTrigger.focus()
    fireEvent.click(pairTrigger)
    const pairDialog = screen.getByRole('dialog', { name: 'Link a computer or VPS' })
    expect(pairDialog).toContainElement(document.activeElement as HTMLElement)
    fireEvent.keyDown(pairDialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Link a computer or VPS' })).not.toBeInTheDocument()
    expect(pairTrigger).toHaveFocus()

    const more = screen.getByRole('button', { name: 'More actions for Studio Mac' })
    more.focus()
    fireEvent.click(more)
    expect(more).toHaveAttribute('aria-haspopup', 'menu')
    expect(more).toHaveAttribute('aria-expanded', 'true')
    const menu = screen.getByRole('menu', { name: 'Actions for Studio Mac' })
    expect(more).toHaveAttribute('aria-controls', menu.id)
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(4)
    const items = within(menu).getAllByRole('menuitem')
    expect(items[0]).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(items[3]).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'Home' })
    expect(items[0]).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'End' })
    expect(items[3]).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'Tab' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(more).toHaveFocus()
    fireEvent.click(more)
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    more.focus(); fireEvent.click(more)
    const reopened = screen.getByRole('menu')
    fireEvent.keyDown(reopened, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(more).toHaveFocus()
  })

  it('keeps rename context open and reports refresh-needed when mutation succeeds but reload fails', async () => {
    let listCalls = 0
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/workspaces') return response({ data: { workspaces: [] } })
      if (url === '/api/v1/linked-computers') return ++listCalls === 1 ? response({ data: [device] }) : response({}, false)
      return response({ success: true })
    })
    render(<LinkedComputersWorkspace />)
    fireEvent.click(await screen.findByRole('button', { name: 'Rename Studio Mac' }))
    fireEvent.change(screen.getByLabelText('Computer name'), { target: { value: 'Office Mac' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))
    expect(await screen.findByRole('dialog', { name: 'Rename computer' })).toBeInTheDocument()
    expect(await screen.findByRole('alert', { hidden: true })).toHaveTextContent('saved, but the latest computer status could not be refreshed')
  })

  it('links a computer to an organisation for only its owner', async () => {
    const fetchMock = global.fetch as jest.Mock
    render(<LinkedComputersWorkspace />)
    fireEvent.click(await screen.findByRole('button', { name: 'Manage access for Studio Mac' }))
    const access = screen.getByRole('dialog', { name: 'Manage computer access' })

    fireEvent.change(within(access).getByLabelText('Organisation'), { target: { value: 'org-b' } })
    expect(within(access).getByRole('radio', { name: 'Only me' })).toBeChecked()
    expect(within(access).getByRole('radio', { name: 'Everyone in organisation' })).not.toBeChecked()
    fireEvent.click(within(access).getByRole('button', { name: 'Save organisation access' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/linked-computers/device-a/grants',
      expect.objectContaining({ method: 'PUT' }),
    ))
    const grantCall = fetchMock.mock.calls.find(([url]) => url === '/api/v1/linked-computers/device-a/grants')
    expect(JSON.parse(String(grantCall?.[1]?.body))).toEqual({ orgId: 'org-b', status: 'active', accessMode: 'owner' })
  })

  it('shows the saved access level when an organisation is already linked', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/v1/linked-computers') return response({ data: [device] })
      if (String(input) === '/api/v1/workspaces') return response({ data: { workspaces: [{ workspaceId: 'workspace-a', orgId: 'org-a', orgName: 'Acme Workspace' }] } })
      return response({ success: true })
    })
    render(<LinkedComputersWorkspace />)
    fireEvent.click(await screen.findByRole('button', { name: 'Manage access for Studio Mac' }))
    const access = screen.getByRole('dialog', { name: 'Manage computer access' })

    fireEvent.change(within(access).getByLabelText('Organisation'), { target: { value: 'org-a' } })
    expect(within(access).getByRole('radio', { name: 'Everyone in organisation' })).toBeChecked()
    expect(within(access).getByRole('radio', { name: 'Only me' })).not.toBeChecked()
  })

  it('pairs, names, grants, maps, rotates, pauses, revokes, and removes through safe lifecycle APIs', async () => {
    const fetchMock = global.fetch as jest.Mock
    render(<LinkedComputersWorkspace />)
    await screen.findByText('Studio Mac')

    fireEvent.click(screen.getByRole('button', { name: 'Link a computer or VPS' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create pairing code' }))
    expect(await screen.findByText('PAIR-123')).toBeInTheDocument()
    expect(screen.getByText(/expires in 10 minutes/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    fireEvent.click(screen.getByRole('button', { name: 'Rename Studio Mac' }))
    fireEvent.change(screen.getByLabelText('Computer name'), { target: { value: 'Office Mac' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Rename computer' })).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Manage access for Studio Mac' }))
    const access = screen.getByRole('dialog', { name: 'Manage computer access' })
    fireEvent.change(within(access).getByLabelText('Organisation'), { target: { value: 'org-b' } })
    fireEvent.click(within(access).getByRole('radio', { name: 'Everyone in organisation' }))
    fireEvent.click(within(access).getByRole('button', { name: 'Save organisation access' }))
    fireEvent.change(within(access).getByLabelText('Workspace'), { target: { value: 'workspace-b' } })
    fireEvent.click(within(access).getByRole('button', { name: 'Map Workspace' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/linked-computers/device-a/mappings',
      expect.objectContaining({ method: 'PUT' }),
    ))
    fireEvent.click(within(access).getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Manage computer access' })).not.toBeInTheDocument())

    for (const label of ['Rotate credential', 'Pause computer', 'Revoke computer', 'Remove computer']) {
      fireEvent.click(screen.getByRole('button', { name: 'More actions for Studio Mac' }))
      fireEvent.click(screen.getByRole('menuitem', { name: label }))
      if (label === 'Remove computer') fireEvent.click(screen.getByRole('button', { name: 'Confirm remove' }))
    }

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/linked-computers/device-a', expect.objectContaining({ method: 'PATCH' }))
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/linked-computers/device-a/grants', expect.objectContaining({ method: 'PUT' }))
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/linked-computers/device-a/mappings', expect.objectContaining({ method: 'PUT' }))
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/linked-computers/device-a/credentials/rotate', expect.objectContaining({ method: 'POST' }))
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/linked-computers/device-a', expect.objectContaining({ method: 'DELETE' }))
    })
    const grantCall = fetchMock.mock.calls.find(([url]) => url === '/api/v1/linked-computers/device-a/grants')
    expect(JSON.parse(String(grantCall?.[1]?.body))).toEqual({ orgId: 'org-b', status: 'active', accessMode: 'organization' })
  })

  it('offers Linux when creating a pairing handoff', async () => {
    render(<LinkedComputersWorkspace />)
    fireEvent.click(screen.getByRole('button', { name: 'Link a computer or VPS' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Linux' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create pairing code' }))
    expect(await screen.findByLabelText('One-command computer setup')).toHaveValue(
      "curl -fsSL https://partnersinbiz.online/runtime/bootstrap/linux.sh | bash -s -- --challenge 'challenge-a' --profiles 'pip' --providers 'nous'",
    )
  })

  it('creates an organisation-owned VPS handoff directly from Linked Computers', async () => {
    jest.useRealTimers()
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/linked-computers') return response({ data: [] })
      if (url === '/api/v1/organizations') return response({ data: [{ id: 'org-a', name: 'Acme' }] })
      if (url.startsWith('/api/v1/workspaces')) return response({ data: { workspaces: [], runtimeTargets: [] } })
      if (url === '/api/v1/linked-computers/pairing') return response({ data: { challengeId: 'challenge-vps', secret: 'VPS-PAIR', expiresAt: '2026-07-13T09:10:00.000Z' } })
      return response({ success: true })
    })
    global.fetch = fetchMock
    render(<LinkedComputersWorkspace />)
    fireEvent.click(screen.getByRole('button', { name: 'Link a computer or VPS' }))
    fireEvent.click(screen.getByRole('radio', { name: 'VPS' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Organisation' }))
    const organizationSelect = await screen.findByLabelText('Owning organisation')
    fireEvent.change(organizationSelect, { target: { value: 'org-a' } })
    await waitFor(() => expect(organizationSelect).toHaveValue('org-a'))
    const createPairing = screen.getByRole('button', { name: 'Create pairing code' })
    expect(createPairing).toBeEnabled()
    fireEvent.click(createPairing)

    expect(await screen.findByText('VPS-PAIR')).toBeInTheDocument()
    const pairingCall = fetchMock.mock.calls.find(([url]) => url === '/api/v1/linked-computers/pairing')
    expect(JSON.parse(String(pairingCall?.[1]?.body))).toEqual({
      deviceKind: 'vps', ownerType: 'organization', ownerOrgId: 'org-a', orgId: 'org-a', agentIds: ['pip'],
    })
    expect(screen.getByLabelText('One-command computer setup')).toHaveValue(
      "curl -fsSL https://partnersinbiz.online/runtime/bootstrap/linux.sh | bash -s -- --challenge 'challenge-vps' --profiles 'pip' --providers 'nous'",
    )
  })

  it.each([
    [410, 'This pairing code has expired. Create a new code and try again.'],
    [409, 'This computer is offline or stale. Start the runtime and try again.'],
    [422, 'This computer needs a Workspace mapping before it can run files.'],
    [403, 'This organisation no longer grants access to this computer.'],
    [426, 'This computer must be updated before it can run work.'],
  ])('shows precise safe recovery copy for status %s', async (status, copy) => {
    global.fetch = jest.fn(async () => ({ ok: false, status, json: async () => ({ error: '/private/path token=secret' }) } as Response))
    render(<LinkedComputersWorkspace />)
    expect(await screen.findByRole('alert')).toHaveTextContent(copy)
    expect(screen.getByRole('alert')).not.toHaveTextContent(/private|token|secret/i)
  })
})
