import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DealDrawer } from '@/components/crm/DealDrawer'

jest.mock('@/components/crm/CompanyPicker', () => ({
  CompanyPicker: ({ onChange }: { onChange: (value: { companyId: string | null; companyName: string | null }) => void }) => (
    <button
      type="button"
      onClick={() => onChange({ companyId: 'company-1', companyName: 'Acme Growth' })}
    >
      Pick Acme Growth
    </button>
  ),
}))

describe('DealDrawer', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url)
      if (path === '/api/v1/crm/pipelines') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: [
              {
                id: 'pipeline-1',
                name: 'Sales pipeline',
                isDefault: true,
                stages: [{ id: 'stage-1', label: 'Discovery', kind: 'open', order: 1, probability: 25 }],
              },
            ],
          }),
        } as Response)
      }

      if (path === '/api/v1/crm/deals' && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, data: { id: 'deal-1' } }),
        } as Response)
      }

      return Promise.reject(new Error(`Unexpected fetch: ${path}`))
    })
  })

  it('sends the selected company name with the deal payload', async () => {
    const onSaved = jest.fn()

    render(
      <DealDrawer
        defaultContactId="contact-1"
        orgId="org-1"
        onSaved={onSaved}
        onClose={jest.fn()}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText(/Annual License/i), {
      target: { value: 'Acme annual growth package' },
    })
    fireEvent.click(await screen.findByText('Pick Acme Growth'))
    fireEvent.click(screen.getByRole('button', { name: /Create deal/i }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('deal-1'))

    const postCall = (global.fetch as jest.Mock).mock.calls.find(([url, init]) => (
      url === '/api/v1/crm/deals' && init?.method === 'POST'
    ))
    expect(JSON.parse(postCall[1].body)).toEqual(expect.objectContaining({
      companyId: 'company-1',
      companyName: 'Acme Growth',
    }))
  })
})
