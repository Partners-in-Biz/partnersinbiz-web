import { fireEvent, render, screen } from '@testing-library/react'
import NewAutomationPage from '@/app/(portal)/portal/settings/automations/new/page'

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

describe('Portal settings automation new page', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockSearchParams = new URLSearchParams()
  })

  it('preserves workspace scope across automation creation endpoints and return navigation', () => {
    mockSearchParams = new URLSearchParams({
      orgId: 'lumen-org',
      orgSlug: 'lumen-speeds',
      sourceCompanyId: 'source-company',
      sourceCompanyName: 'Lumen',
    })

    render(<NewAutomationPage />)

    expect(screen.getByText('Automation rule form rendered')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Automations' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'arrow_back Automations' })).not.toBeInTheDocument()
    expect(formProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        endpoint: '/api/v1/crm/automations?orgId=lumen-org',
        sequencesEndpoint: '/api/v1/crm/sequences?orgId=lumen-org',
      }),
    )

    const scopedReturn = '/portal/settings/automations?orgId=lumen-org&orgSlug=lumen-speeds&sourceCompanyId=source-company&sourceCompanyName=Lumen'

    fireEvent.click(screen.getByRole('button', { name: 'Automations' }))
    expect(push).toHaveBeenCalledWith(scopedReturn)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel mocked automation' }))
    expect(push).toHaveBeenCalledWith(scopedReturn)

    fireEvent.click(screen.getByRole('button', { name: 'Save mocked automation' }))
    expect(push).toHaveBeenCalledWith(scopedReturn)
  })
})
