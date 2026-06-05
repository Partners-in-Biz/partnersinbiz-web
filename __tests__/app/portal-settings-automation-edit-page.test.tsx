import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import EditAutomationPage from '@/app/(portal)/portal/settings/automations/[id]/edit/page'

const push = jest.fn()
let mockSearchParams = new URLSearchParams()
const formProps = jest.fn()

type MockAutomationFormProps = {
  onSave?: () => void
  onCancel?: () => void
  [key: string]: unknown
}

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => mockSearchParams,
}))

jest.mock('@/components/crm/AutomationRuleForm', () => ({
  AutomationRuleForm: (props: MockAutomationFormProps) => {
    formProps(props)
    return (
      <div>
        <div>Automation rule form rendered</div>
        <button type="button" onClick={() => props.onSave?.()}>
          Save mocked automation
        </button>
        <button type="button" onClick={() => props.onCancel?.()}>
          Cancel mocked automation
        </button>
      </div>
    )
  },
}))

describe('Portal settings automation edit page', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockSearchParams = new URLSearchParams()
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

  it('preserves workspace scope across automation edit loading, save, and cancel', async () => {
    mockSearchParams = new URLSearchParams({
      orgId: 'lumen-org',
      orgSlug: 'lumen-speeds',
      sourceCompanyId: 'source-company',
      sourceCompanyName: 'Lumen',
    })
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/crm/automations?orgId=lumen-org') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              rules: [
                {
                  id: 'rule-edit',
                  name: 'Notify owner',
                  enabled: true,
                  trigger: { event: 'contact.created' },
                  actions: [{ type: 'send_notification', notificationMessage: 'Review the new lead' }],
                  delayMinutes: 0,
                },
              ],
            },
          }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock

    await act(async () => {
      render(<EditAutomationPage params={Promise.resolve({ id: 'rule-edit' })} />)
    })

    expect(await screen.findByText('Automation rule form rendered')).toBeInTheDocument()
    expect(formProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        endpoint: '/api/v1/crm/automations/rule-edit?orgId=lumen-org',
        sequencesEndpoint: '/api/v1/crm/sequences?orgId=lumen-org',
      }),
    )

    const scopedReturn = '/portal/settings/automations?orgId=lumen-org&orgSlug=lumen-speeds&sourceCompanyId=source-company&sourceCompanyName=Lumen'

    fireEvent.click(screen.getByRole('button', { name: 'Cancel mocked automation' }))
    expect(push).toHaveBeenCalledWith(scopedReturn)

    fireEvent.click(screen.getByRole('button', { name: 'Save mocked automation' }))
    expect(push).toHaveBeenCalledWith(scopedReturn)
  })
})
