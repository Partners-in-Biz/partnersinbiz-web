import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import EditAutomationPage from '@/app/(portal)/portal/settings/automations/[id]/edit/page'

const push = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

jest.mock('@/components/crm/AutomationRuleForm', () => ({
  AutomationRuleForm: () => <div>Automation rule form rendered</div>,
}))

describe('Portal settings automation edit page', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('warns when the automation editor source fails and gives leaders a retry path', async () => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/crm/automations') {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: async () => ({ error: 'Automation editor source unavailable' }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock

    await act(async () => {
      render(<EditAutomationPage params={Promise.resolve({ id: 'rule-edit' })} />)
    })

    expect(await screen.findByRole('heading', { name: 'Automation rule could not load' })).toBeInTheDocument()
    expect(screen.getByText('Automation editor source unavailable')).toBeInTheDocument()
    expect(screen.queryByText('Automation rule form rendered')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry loading automation rule' }))

    await waitFor(() => {
      const ruleRequests = (global.fetch as jest.Mock).mock.calls.filter(([url]) => (
        String(url) === '/api/v1/crm/automations'
      ))
      expect(ruleRequests).toHaveLength(2)
    })
  })
})
