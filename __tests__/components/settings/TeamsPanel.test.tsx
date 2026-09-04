import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TeamsPanel } from '@/components/settings/team/TeamsPanel'

function response(body: unknown, ok = true, status = ok ? 200 : 400): Response {
  return { ok, status, json: async () => body } as Response
}

describe('TeamsPanel', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('renders the empty state when the org has no teams', async () => {
    global.fetch = jest.fn(async () => response({ success: true, data: { teams: [] } }))
    render(<TeamsPanel orgId="org-a" members={[{ uid: 'user-b', displayName: 'Sam Rivera' }]} />)
    expect(await screen.findByText('No teams yet.')).toBeInTheDocument()
    expect(global.fetch).toHaveBeenCalledWith('/api/v1/orgs/org-a/teams')
  })

  it('renders nothing when teams are disabled', async () => {
    global.fetch = jest.fn(async () => response({ error: 'feature_disabled' }, false, 404))
    const { container } = render(<TeamsPanel orgId="org-a" members={[]} />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/v1/orgs/org-a/teams'))
    expect(container).toBeEmptyDOMElement()
  })

  it('POSTs the derived slug and selected members on create', async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/v1/orgs/org-a/teams' && init?.method === 'POST') {
        return response({ success: true, data: { team: { teamId: 'org-a_growth', name: 'Growth' } } }, true, 201)
      }
      return response({ success: true, data: { teams: [] } })
    })
    global.fetch = fetchMock
    render(<TeamsPanel orgId="org-a" members={[{ uid: 'user-b', displayName: 'Sam Rivera' }]} />)
    await screen.findByText('No teams yet.')
    fireEvent.click(screen.getByRole('button', { name: 'New team' }))
    fireEvent.change(screen.getByLabelText('Team name'), { target: { value: 'Growth Desk' } })
    expect(screen.getByLabelText('Team slug')).toHaveValue('growth-desk')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Sam Rivera' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Lead Sam Rivera' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create team' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/orgs/org-a/teams',
      expect.objectContaining({ method: 'POST' }),
    ))
    const createCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({
      name: 'Growth Desk',
      slug: 'growth-desk',
      memberUserIds: ['user-b'],
      leadUserIds: ['user-b'],
    })
  })
})
