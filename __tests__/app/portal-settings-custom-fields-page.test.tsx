import { fireEvent, render, screen } from '@testing-library/react'
import CustomFieldsPage from '@/app/(portal)/portal/settings/custom-fields/page'

jest.mock('@/components/crm/CustomFieldDefinitionDrawer', () => ({
  CustomFieldDefinitionDrawer: ({ open, mode }: { open: boolean; mode: string }) => (
    open ? <div role="dialog" aria-label={mode === 'create' ? 'New custom field' : 'Edit custom field'} /> : null
  ),
}))

describe('Portal settings custom fields page', () => {
  beforeEach(() => {
    jest.clearAllMocks()
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
          json: async () => ({ data: { definitions: [] } }),
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
})
