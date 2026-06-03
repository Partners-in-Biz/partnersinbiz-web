import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
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
      if (url === '/api/v1/crm/custom-fields/field-1' && init?.method === 'DELETE') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('turns empty contact custom fields into a schema setup command center', async () => {
    render(<CustomFieldsPage />)

    expect(await screen.findByText('Design your first CRM data field')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New field' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Filter custom fields by type' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Filter custom fields by health' })).toBeInTheDocument()
    expect(screen.getByText('Qualification')).toBeInTheDocument()
    expect(screen.getByText('Reporting')).toBeInTheDocument()
    expect(screen.getByText('Handover')).toBeInTheDocument()
    expect(screen.getByText('Governance')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /create the first contact field/i }))
    expect(screen.getByRole('dialog', { name: 'New custom field' })).toBeInTheDocument()
  })

  it('warns when custom fields fail to load and gives leaders a retry path', async () => {
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
          ok: false,
          json: async () => ({ error: 'Custom field schema unavailable' }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock

    render(<CustomFieldsPage />)

    expect(await screen.findByRole('heading', { name: 'Custom field schema could not load' })).toBeInTheDocument()
    expect(screen.getByText('Custom field schema unavailable')).toBeInTheDocument()
    expect(screen.queryByText('Schema fields')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry loading custom field schema' }))

    await waitFor(() => {
      const schemaRequests = (global.fetch as jest.Mock).mock.calls.filter(([url]) => (
        String(url) === '/api/v1/crm/custom-fields?resource=contact'
      ))
      expect(schemaRequests).toHaveLength(2)
    })
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

  it('uses an in-page confirmation before deleting CRM custom fields', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false)
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

    fireEvent.click(screen.getByRole('button', { name: 'Delete Decision role' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog', { name: 'Delete custom field "Decision role"?' })).toBeInTheDocument()
    expect(screen.getByText('This removes the field from future contact records and schema views. Existing saved values may remain in historical records for audit and cleanup.')).toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalledWith('/api/v1/crm/custom-fields/field-1', expect.any(Object))
    expect(screen.getByRole('button', { name: 'Cancel delete for custom field Decision role' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete custom field Decision role' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/custom-fields/field-1', { method: 'DELETE' })
    })
    expect(screen.queryByText('Decision role')).not.toBeInTheDocument()

    confirmSpy.mockRestore()
  })
})
