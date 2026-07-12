import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { LinkedComputersWorkspace } from '@/components/linked-computers/LinkedComputersWorkspace'

const device = {
  deviceId: 'device-a', label: 'Studio Mac', platform: 'macos', architecture: 'arm64',
  runtimeVersion: '2.4.1', capabilities: ['workspace.execute'], status: 'active', credentialVersion: 3,
  health: 'ok', lastSeenAt: '2026-07-13T08:59:30.000Z', createdAt: '', updatedAt: '',
  grants: [{ orgId: 'org-a', orgLabel: 'Acme', status: 'active' }],
  mappings: [{ mappingId: 'map-a', orgId: 'org-a', workspaceId: 'workspace-a', label: 'Acme Workspace', status: 'active' }],
}

function response(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 400, json: async () => body } as Response
}

describe('LinkedComputersWorkspace', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-13T09:00:00.000Z'))
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/v1/linked-computers') return response({ data: [device] })
      if (String(input) === '/api/v1/workspaces') return response({ data: { workspaces: [{ workspaceId: 'workspace-b', orgId: 'org-b', orgName: 'Beta Workspace' }] } })
      return response({ success: true, data: { challengeId: 'challenge-a', secret: 'PAIR-123', expiresAt: '2026-07-13T09:10:00.000Z' } })
    })
  })
  afterEach(() => jest.useRealTimers())

  it('shows safe health, version, grant, and mapping status without internal data', async () => {
    render(<LinkedComputersWorkspace />)
    const card = await screen.findByRole('article', { name: 'Studio Mac' })
    expect(card).toHaveTextContent('Online')
    expect(card).toHaveTextContent('Version 2.4.1')
    expect(card).toHaveTextContent('Acme')
    expect(card).toHaveTextContent('Acme Workspace')
    expect(card).toHaveTextContent('Mapped')
    expect(card).not.toHaveTextContent(/\/var\/|~\/|token|credential|endpoint/i)
  })

  it('traps and restores focus while dialogs and action menus support Escape dismissal', async () => {
    render(<LinkedComputersWorkspace />)
    await screen.findByText('Studio Mac')
    const pairTrigger = screen.getByRole('button', { name: 'Pair a computer' })
    pairTrigger.focus()
    fireEvent.click(pairTrigger)
    const pairDialog = screen.getByRole('dialog', { name: 'Pair a computer' })
    expect(pairDialog).toContainElement(document.activeElement as HTMLElement)
    fireEvent.keyDown(pairDialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Pair a computer' })).not.toBeInTheDocument()
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
    expect(await screen.findByRole('alert')).toHaveTextContent('saved, but the latest computer status could not be refreshed')
  })

  it('pairs, names, grants, maps, rotates, pauses, revokes, and removes through safe lifecycle APIs', async () => {
    const fetchMock = global.fetch as jest.Mock
    render(<LinkedComputersWorkspace />)
    await screen.findByText('Studio Mac')

    fireEvent.click(screen.getByRole('button', { name: 'Pair a computer' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create pairing code' }))
    expect(await screen.findByText('PAIR-123')).toBeInTheDocument()
    expect(screen.getByText(/expires in 10 minutes/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    fireEvent.click(screen.getByRole('button', { name: 'Rename Studio Mac' }))
    fireEvent.change(screen.getByLabelText('Computer name'), { target: { value: 'Office Mac' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))

    fireEvent.click(screen.getByRole('button', { name: 'Manage access for Studio Mac' }))
    const access = screen.getByRole('dialog', { name: 'Manage computer access' })
    fireEvent.change(within(access).getByLabelText('Organisation'), { target: { value: 'org-b' } })
    fireEvent.click(within(access).getByRole('button', { name: 'Grant organisation' }))
    fireEvent.change(within(access).getByLabelText('Workspace'), { target: { value: 'workspace-b' } })
    fireEvent.click(within(access).getByRole('button', { name: 'Map Workspace' }))

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
