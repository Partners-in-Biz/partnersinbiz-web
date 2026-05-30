import { fireEvent, render, screen } from '@testing-library/react'
import CustomFieldsPage from '@/app/(portal)/portal/settings/custom-fields/page'
import type { CustomFieldDefinition } from '@/lib/customFields/types'

let definitions: CustomFieldDefinition[] = []

jest.mock('@/components/crm/CustomFieldDefinitionDrawer', () => ({
  CustomFieldDefinitionDrawer: ({ open, mode }: { open: boolean; mode: string }) => (
    open ? <div role="dialog" aria-label={mode === 'create' ? 'New custom field' : 'Edit custom field'} /> : null
  ),
}))

describe('Portal settings custom fields page', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    definitions = []
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/portal/settings/profile') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ profile: { role: 'owner' } }),
        } as Response)
      }
      if (url === '/api/v1/crm/custom-fields?resource=contact') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { definitions } }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock
  })

  it('turns empty contact custom fields into a schema setup command center', async () => {
    render(<CustomFieldsPage />)

    expect(await screen.findByText('Design your first CRM data field')).toBeInTheDocument()
    expect(screen.getByText('Qualification')).toBeInTheDocument()
    expect(screen.getByText('Reporting')).toBeInTheDocument()
    expect(screen.getByText('Handover')).toBeInTheDocument()
    expect(screen.getByText('Governance')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /create the first contact field/i }))
    expect(screen.getByRole('dialog', { name: 'New custom field' })).toBeInTheDocument()
  })

  it('treats an empty filtered custom-field view as a reversible schema lens', async () => {
    definitions = [{
      id: 'field-1',
      orgId: 'org-1',
      resource: 'contact',
      key: 'decision_role',
      label: 'Decision role',
      type: 'dropdown',
      required: true,
      options: [
        { value: 'buyer', label: 'Buyer' },
        { value: 'influencer', label: 'Influencer' },
      ],
      helpText: 'Clarifies buying influence for handover and segmentation.',
      group: 'Qualification',
      order: 0,
      createdAt: null,
      updatedAt: null,
    }]

    render(<CustomFieldsPage />)

    expect(await screen.findByText('Decision role')).toBeInTheDocument()

    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'needs-work' } })

    expect(await screen.findByRole('heading', { name: 'No fields match this view.' })).toBeInTheDocument()
    expect(screen.getByText('Clear the field filters to return to the full CRM schema.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show all fields' }))

    expect(await screen.findByText('Decision role')).toBeInTheDocument()
  })
})
