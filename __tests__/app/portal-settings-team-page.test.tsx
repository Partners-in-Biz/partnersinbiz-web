import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import TeamPage from '@/app/(portal)/portal/settings/team/page'

const fetchMock = jest.fn()

beforeAll(() => {
  Object.defineProperty(global, 'fetch', {
    configurable: true,
    value: fetchMock,
  })
})

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input)
    if (url === '/api/v1/portal/settings/team') {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            members: [
              {
                uid: 'current-admin',
                firstName: 'Mandy',
                lastName: 'Manager',
                jobTitle: 'Operations lead',
                avatarUrl: '',
                role: 'admin',
              },
              {
                uid: 'sales-rep',
                firstName: 'Sam',
                lastName: 'Sales',
                jobTitle: 'Sales rep',
                avatarUrl: '',
                role: 'member',
              },
            ],
          }),
      })
    }
    if (url === '/api/v1/portal/settings/profile') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ profile: { role: 'admin' } }),
      })
    }
    if (url === '/api/v1/portal/org') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ user: { uid: 'current-admin' } }),
      })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  })
})

describe('TeamPage', () => {
  it('names team administration controls for employee-scale CRM work', async () => {
    render(<TeamPage />)

    expect(await screen.findByRole('heading', { name: 'Team' })).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('Sam Sales')).toBeInTheDocument()
    })

    expect(screen.getByRole('button', { name: 'Remove Sam Sales' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'person_remove' })).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Invite role' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Invite workspace access' })).toBeInTheDocument()
  })
})
