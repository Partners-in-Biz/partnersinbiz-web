import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import ProfilePage from '@/app/(portal)/portal/settings/profile/page'

describe('Portal profile settings page', () => {
  beforeEach(() => {
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/portal/settings/profile' && !init?.method) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            profile: {
              firstName: 'Mandy',
              lastName: 'Stander',
              jobTitle: 'CEO',
              phone: '+27 82 000 0000',
              avatarUrl: '',
              role: 'owner',
            },
          }),
        } as Response)
      }
      if (url === '/api/v1/portal/settings/profile' && init?.method === 'PATCH') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            profile: {
              firstName: 'Mandy',
              lastName: 'Stander',
              jobTitle: 'CEO',
              phone: '+27 82 000 0000',
              avatarUrl: '',
              role: 'owner',
            },
          }),
        } as Response)
      }
      return Promise.resolve({ ok: false, json: async () => ({ error: 'unexpected fetch' }) } as Response)
    }) as jest.Mock
  })

  it('summarizes CRM profile readiness before the edit form', async () => {
    render(<ProfilePage />)

    const commandCenter = await screen.findByRole('region', { name: 'Profile command center' })

    expect(commandCenter).toBeInTheDocument()
    expect(within(commandCenter).getByRole('heading', { name: 'Profile command center' })).toBeInTheDocument()
    expect(within(commandCenter).getByText('4 ready fields')).toBeInTheDocument()
    expect(within(commandCenter).getByText('Owner access')).toBeInTheDocument()
    expect(within(commandCenter).getByText('Mandy Stander')).toBeInTheDocument()
    expect(within(commandCenter).getByText('CEO')).toBeInTheDocument()
    expect(within(commandCenter).getByText('+27 82 000 0000')).toBeInTheDocument()
    expect(within(commandCenter).getByText('CRM ownership ready')).toBeInTheDocument()

    expect(within(commandCenter).getByTestId('profile-readiness-ready-fields')).toHaveClass('pib-stat-card')
    expect(within(commandCenter).getByTestId('profile-readiness-name')).toHaveClass('pib-stat-card')
    expect(within(commandCenter).getByTestId('profile-readiness-title')).toHaveClass('pib-stat-card')
    expect(within(commandCenter).getByTestId('profile-readiness-contact')).toHaveClass('pib-stat-card')
  })

  it('saves profile changes through the portal route', async () => {
    render(<ProfilePage />)

    const jobTitle = await screen.findByLabelText('Job title')
    fireEvent.change(jobTitle, { target: { value: 'Managing Director' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))

    await screen.findByRole('button', { name: 'Saved' })
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v1/portal/settings/profile',
        expect.objectContaining({
          method: 'PATCH',
          body: expect.stringContaining('Managing Director'),
        }),
      )
    })
  })
})
