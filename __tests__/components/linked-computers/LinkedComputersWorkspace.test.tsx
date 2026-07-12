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

  it('pairs, names, grants, maps, rotates, pauses, revokes, and removes through safe lifecycle APIs', async () => {
    const fetchMock = global.fetch as jest.Mock
    render(<LinkedComputersWorkspace />)
    await screen.findByText('Studio Mac')

    fireEvent.click(screen.getByRole('button', { name: 'Pair a computer' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create pairing code' }))
    expect(await screen.findByText('PAIR-123')).toBeInTheDocument()
    expect(screen.getByText(/expires in 10 minutes/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Rename Studio Mac' }))
    fireEvent.change(screen.getByLabelText('Computer name'), { target: { value: 'Office Mac' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))

    fireEvent.click(screen.getByRole('button', { name: 'Manage access for Studio Mac' }))
    const access = screen.getByRole('dialog', { name: 'Manage computer access' })
    fireEvent.change(within(access).getByLabelText('Organisation'), { target: { value: 'org-b' } })
    fireEvent.click(within(access).getByRole('button', { name: 'Grant organisation' }))
    fireEvent.change(within(access).getByLabelText('Workspace'), { target: { value: 'workspace-b' } })
    fireEvent.click(within(access).getByRole('button', { name: 'Map Workspace' }))

    fireEvent.click(screen.getByRole('button', { name: 'More actions for Studio Mac' }))
    for (const label of ['Rotate credential', 'Pause computer', 'Revoke computer', 'Remove computer']) {
      fireEvent.click(screen.getByRole('button', { name: label }))
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
