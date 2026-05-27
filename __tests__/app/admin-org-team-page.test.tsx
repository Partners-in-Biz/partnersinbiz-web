import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import TeamPage from '@/app/(admin)/admin/org/[slug]/team/page'

jest.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'lumen' }),
}))

jest.mock('@/lib/utils/clipboard', () => ({
  copyToClipboard: jest.fn(),
}))

const fetchMock = jest.fn()

beforeEach(() => {
  jest.useFakeTimers()
  fetchMock.mockReset()
  global.fetch = fetchMock

  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'

    if (url === '/api/v1/admin/platform-users') {
      return jsonResponse({
        data: [
          { uid: 'staff-1', displayName: 'Maya Staff', email: 'maya@partnersinbiz.online' },
          { uid: 'staff-2', displayName: 'Theo Ops', email: 'theo@partnersinbiz.online' },
        ],
      })
    }

    if (url === '/api/v1/organizations') {
      return jsonResponse({ data: [{ id: 'org-1', name: 'Lumen', slug: 'lumen' }] })
    }

    if (url === '/api/v1/organizations/org-1/members' && method === 'GET') {
      return jsonResponse({
        data: [
          { userId: 'owner-1', role: 'owner', displayName: 'Peet Stander', email: 'peet@example.com' },
        ],
      })
    }

    if (url.startsWith('/api/v1/organizations/org-1/members/client?q=')) {
      return jsonResponse({
        data: [
          { uid: 'client-1', displayName: 'Jane Client', email: 'jane@example.com' },
        ],
      })
    }

    if (url === '/api/v1/organizations/org-1/create-login' && method === 'POST') {
      return jsonResponse({
        data: {
          uid: 'new-client',
      role: JSON.parse(String(init?.body)).role,
      jobTitle: JSON.parse(String(init?.body)).jobTitle,
      department: JSON.parse(String(init?.body)).department,
      accessScope: JSON.parse(String(init?.body)).accessScope,
      accessNotes: JSON.parse(String(init?.body)).accessNotes,
      email: 'new@example.com',
      displayName: 'New Client',
          setupLink: 'https://partnersinbiz.online/auth/reset?link=test',
        },
      }, 201)
    }

    if (url === '/api/v1/organizations/org-1/members/client' && method === 'POST') {
      return jsonResponse({
        data: {
      userId: 'client-1',
      role: JSON.parse(String(init?.body)).role,
      jobTitle: JSON.parse(String(init?.body)).jobTitle,
      department: JSON.parse(String(init?.body)).department,
      accessScope: JSON.parse(String(init?.body)).accessScope,
      accessNotes: JSON.parse(String(init?.body)).accessNotes,
      email: 'jane@example.com',
          displayName: 'Jane Client',
        },
      }, 201)
    }

    if (url === '/api/v1/organizations/org-1/members' && method === 'POST') {
      return jsonResponse({
        data: {
      userId: 'staff-1',
      role: JSON.parse(String(init?.body)).role,
      jobTitle: JSON.parse(String(init?.body)).jobTitle,
      department: JSON.parse(String(init?.body)).department,
      accessScope: JSON.parse(String(init?.body)).accessScope,
      accessNotes: JSON.parse(String(init?.body)).accessNotes,
      email: 'maya@partnersinbiz.online',
          displayName: 'Maya Staff',
        },
      }, 201)
    }

    throw new Error(`Unexpected fetch: ${method} ${url}`)
  })
})

afterEach(() => {
  jest.runOnlyPendingTimers()
  jest.useRealTimers()
})

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

function lastFetchBodyFor(path: string) {
  const call = fetchMock.mock.calls.findLast(([url]) => String(url) === path)
  if (!call) throw new Error(`No fetch call for ${path}`)
  return JSON.parse(String(call[1]?.body))
}

it('renders the invite section as one coherent access panel', async () => {
  render(<TeamPage />)

  expect(await screen.findByText('Invites & Access')).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Add people to this workspace' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Create client login' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Add existing client' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Add existing PiB member' })).toBeInTheDocument()
})

it('submits the create-login form with the selected role', async () => {
  render(<TeamPage />)

  await screen.findByText('Invites & Access')
  fireEvent.change(screen.getByPlaceholderText('Jane Client'), { target: { value: 'New Client' } })
  fireEvent.change(screen.getByPlaceholderText('client@example.com'), { target: { value: 'new@example.com' } })
  fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'viewer' } })
  fireEvent.change(screen.getAllByPlaceholderText('Finance Manager')[0], { target: { value: 'Marketing Director' } })
  fireEvent.change(screen.getAllByPlaceholderText('Operations')[0], { target: { value: 'Marketing' } })
  fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'marketing' } })
  fireEvent.change(screen.getAllByPlaceholderText("Context for this person's responsibilities")[0], {
    target: { value: 'Approves campaign plans' },
  })
  fireEvent.click(screen.getByRole('button', { name: /Create Login/i }))

  await waitFor(() => {
    expect(lastFetchBodyFor('/api/v1/organizations/org-1/create-login')).toEqual({
      email: 'new@example.com',
      name: 'New Client',
      role: 'viewer',
      jobTitle: 'Marketing Director',
      department: 'Marketing',
      accessScope: 'marketing',
      accessNotes: 'Approves campaign plans',
    })
  })
  expect(await screen.findByText('Setup link ready')).toBeInTheDocument()
})

it('submits the selected existing client and role', async () => {
  render(<TeamPage />)

  await screen.findByText('Invites & Access')
  fireEvent.change(screen.getByPlaceholderText('Search existing client...'), { target: { value: 'jane' } })
  await act(async () => {
    jest.advanceTimersByTime(250)
  })
  fireEvent.mouseDown(await screen.findByText('Jane Client'))
  fireEvent.change(screen.getAllByRole('combobox')[2], { target: { value: 'admin' } })
  fireEvent.click(screen.getByRole('button', { name: /Add Client/i }))

  await waitFor(() => {
    expect(lastFetchBodyFor('/api/v1/organizations/org-1/members/client')).toEqual({
      uid: 'client-1',
      role: 'admin',
      jobTitle: '',
      department: '',
      accessScope: 'all',
      accessNotes: '',
    })
  })
})

it('submits the selected existing PiB member and role', async () => {
  render(<TeamPage />)

  await screen.findByText('Invites & Access')
  fireEvent.change(screen.getByPlaceholderText('Search staff...'), { target: { value: 'maya' } })
  fireEvent.mouseDown(await screen.findByText('Maya Staff'))
  fireEvent.change(screen.getAllByRole('combobox')[4], { target: { value: 'admin' } })
  fireEvent.click(screen.getByRole('button', { name: /Add Member/i }))

  await waitFor(() => {
    expect(lastFetchBodyFor('/api/v1/organizations/org-1/members')).toEqual({
      email: 'maya@partnersinbiz.online',
      role: 'admin',
      jobTitle: '',
      department: '',
      accessScope: 'all',
      accessNotes: '',
    })
  })
})
