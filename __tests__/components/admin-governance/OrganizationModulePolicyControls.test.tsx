import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import {
  OrganizationModulePolicyRoleGrid,
  OrganizationModulePolicySaveBar,
  useOrganizationModulePolicy,
  type OrganizationPolicyActionRow,
} from '@/components/admin-governance/OrganizationModulePolicyControls'

const rows: OrganizationPolicyActionRow[] = [
  {
    id: 'visibility',
    title: 'Book Studio tab visibility',
    description: 'Choose who can see Book Studio.',
  },
]

function BookStudioPolicyHarness() {
  const controls = useOrganizationModulePolicy({ orgSlug: 'partners-in-biz', moduleKey: 'bookStudio' })

  return (
    <div>
      <OrganizationModulePolicyRoleGrid
        rows={rows}
        policy={controls.policy}
        testIdPrefix="book-policy"
        disabled={controls.loading || controls.saving}
        onRoleChange={controls.setRole}
      />
      <OrganizationModulePolicySaveBar
        loading={controls.loading}
        saving={controls.saving}
        saveState={controls.saveState}
        error={controls.error}
        onSave={controls.save}
      />
    </div>
  )
}

describe('OrganizationModulePolicyControls', () => {
  it('saves legacy portal module switches when a gated module visibility policy changes', async () => {
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
                portalModules: { bookStudio: true },
                modulePolicies: {
                  bookStudio: {
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

    render(<BookStudioPolicyHarness />)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/organizations')
    })

    const visibilityRow = screen.getByTestId('book-policy-book-studio-tab-visibility')
    fireEvent.click(within(visibilityRow).getByRole('checkbox', { name: 'Owner' }))
    fireEvent.click(within(visibilityRow).getByRole('checkbox', { name: 'Admin' }))
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
        portalModules: { bookStudio: false },
        modulePolicies: {
          bookStudio: {
            actions: {
              visibility: { owner: false, admin: false, member: false },
            },
          },
        },
      },
    })
  })
})
