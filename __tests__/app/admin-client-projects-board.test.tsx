import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import ProjectsPage from '@/app/(admin)/admin/org/[slug]/projects/page'

jest.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'partners-in-biz' }),
}))

describe('Admin org projects governance page', () => {
  it('renders project governance instead of the client portal project browser', () => {
    render(<ProjectsPage />)

    expect(screen.getByRole('heading', { name: 'Project governance' })).toBeInTheDocument()
    expect(screen.getByText(/Configure how this organisation uses projects/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Who can use projects in the client portal' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Project deletion stays here' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Default types plus organisation custom types' })).toBeInTheDocument()
    const portalAccess = screen.getByRole('heading', { name: 'Who can use projects in the client portal' }).closest('section')
    expect(portalAccess).not.toBeNull()
    for (const rowId of ['projects-tab-visibility', 'create-new-projects', 'archive-or-delete-projects']) {
      const row = screen.getByTestId(`project-permission-${rowId}`)
      expect(within(row).getByRole('checkbox', { name: 'Owner' })).toBeInTheDocument()
      expect(within(row).getByRole('checkbox', { name: 'Admin' })).toBeInTheDocument()
      expect(within(row).getByRole('checkbox', { name: 'Member' })).toBeInTheDocument()
    }

    expect(screen.queryByPlaceholderText('Search projects...')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /\+ New Project/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('tablist', { name: 'Project stage filters' })).not.toBeInTheDocument()
  })

  it('lets admins add and remove organisation-specific project types locally', () => {
    render(<ProjectsPage />)

    fireEvent.change(screen.getByPlaceholderText('Custom type'), { target: { value: 'Book launch' } })
    fireEvent.click(screen.getByRole('button', { name: /add/i }))

    expect(screen.getByText('Book launch')).toBeInTheDocument()
    expect(screen.getByText('1 custom project types configured for this organisation.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /delete custom type/i }))
    expect(screen.queryByText('Book launch')).not.toBeInTheDocument()
  })

  it('saves project governance role settings to organisation module policies', async () => {
    const fetchMock = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/organizations') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: [{ id: 'org-1', slug: 'partners-in-biz', name: 'Partners in Biz' }] }),
        } as Response)
      }
      if (url === '/api/v1/organizations/org-1' && init?.method === 'PUT') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, data: { updated: true } }),
        } as Response)
      }
      if (url === '/api/v1/organizations/org-1') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              settings: {
                modulePolicies: {
                  projects: {
                    actions: {
                      visibility: { owner: true, admin: true, member: true },
                    },
                  },
                },
              },
            },
          }),
        } as Response)
      }
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response)
    })
    global.fetch = fetchMock as typeof fetch

    render(<ProjectsPage />)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/organizations')
    })

    const visibilityRow = screen.getByTestId('project-permission-projects-tab-visibility')
    fireEvent.click(within(visibilityRow).getByRole('checkbox', { name: 'Member' }))
    fireEvent.click(screen.getByRole('button', { name: /Save settings/ }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/organizations/org-1',
        expect.objectContaining({ method: 'PUT' }),
      )
    })

    const saveCall = fetchMock.mock.calls.find(([url, init]) => String(url) === '/api/v1/organizations/org-1' && init?.method === 'PUT')
    expect(saveCall).toBeDefined()
    expect(JSON.parse(String(saveCall?.[1]?.body))).toMatchObject({
      settings: {
        modulePolicies: {
          projects: {
            actions: {
              visibility: { owner: true, admin: true, member: false },
            },
          },
        },
      },
    })
  })
})
