import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import FirstRunPage from '@/app/(portal)/portal/first-run/page'

const mockRouterPush = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush, replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

// The first-run page was redesigned into the growth-onboarding wizard (the
// PRIMARY first-run experience). The old life-OS "operating profile" form is no
// longer rendered by this page — its API (collection life_os_profiles) lives on
// at /api/v1/portal/first-run but has no page. These tests cover the current
// growth-onboarding wizard behaviour.
describe('Portal first-run growth-onboarding wizard', () => {
  beforeEach(() => {
    mockRouterPush.mockClear()
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/portal/settings/organization' && !init?.method) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ organization: { name: 'Acme Inc.' }, permissions: { canEdit: true } }),
        } as Response)
      }
      if (url === '/api/v1/portal/settings/organization' && init?.method === 'PATCH') {
        return Promise.resolve({ ok: true, json: async () => ({ data: { saved: true } }) } as Response)
      }
      if (url === '/api/v1/portal/brand-profile') {
        return Promise.resolve({ ok: true, json: async () => ({ data: { brandProfile: {} } }) } as Response)
      }
      if (url === '/api/v1/portal/growth-onboarding' && init?.method === 'PATCH') {
        return Promise.resolve({ ok: true, json: async () => ({ data: { saved: true } }) } as Response)
      }
      // Signal endpoints (social accounts, domain, dashboard) — default "nothing yet".
      return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response)
    }) as jest.Mock
  })

  it('walks the workspace setup steps and prefills the existing workspace name', async () => {
    render(<FirstRunPage />)

    expect(
      await screen.findByRole('heading', { name: /let's get your workspace growing/i }),
    ).toBeInTheDocument()

    // Step 1 — workspace name, prefilled from the org settings load.
    expect(await screen.findByRole('heading', { name: 'Name your workspace' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('Workspace name')).toHaveValue('Acme Inc.'))

    // Edit the name and advance — the page PATCHes the org settings on Next.
    fireEvent.change(screen.getByLabelText('Workspace name'), { target: { value: 'Acme Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v1/portal/settings/organization',
        expect.objectContaining({
          method: 'PATCH',
          body: expect.stringContaining('Acme Renamed'),
        }),
      )
    })

    // Advanced to step 2 — connect a social account.
    expect(await screen.findByRole('heading', { name: 'Connect a social account' })).toBeInTheDocument()
  })

  it('completes onboarding from the final step and routes to the dashboard', async () => {
    render(<FirstRunPage />)

    await screen.findByRole('heading', { name: 'Name your workspace' })

    // Skip through to the final (analytics) step.
    for (let i = 0; i < 4; i++) {
      fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }))
    }

    const finish = await screen.findByRole('button', { name: 'Finish setup' })
    fireEvent.click(finish)

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v1/portal/growth-onboarding',
        expect.objectContaining({
          method: 'PATCH',
          body: expect.stringContaining('growthOnboardingCompleted'),
        }),
      )
    })
    await waitFor(() => expect(mockRouterPush).toHaveBeenCalledWith('/portal/dashboard'))
  })
})
