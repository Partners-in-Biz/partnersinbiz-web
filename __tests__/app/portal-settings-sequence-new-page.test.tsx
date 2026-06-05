import { fireEvent, render, screen } from '@testing-library/react'
import NewSequencePage from '@/app/(portal)/portal/settings/sequences/new/page'

const push = jest.fn()
let mockSearchParams = new URLSearchParams()
const formProps = jest.fn()

type MockSequenceFormProps = {
  onSave?: () => void
  onCancel?: () => void
  [key: string]: unknown
}

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => mockSearchParams,
}))

jest.mock('@/components/crm/SequenceForm', () => ({
  SequenceForm: (props: MockSequenceFormProps) => {
    formProps(props)
    return (
      <div>
        <div>Sequence form rendered</div>
        <button type="button" onClick={() => props.onSave?.()}>
          Save mocked sequence
        </button>
        <button type="button" onClick={() => props.onCancel?.()}>
          Cancel mocked sequence
        </button>
      </div>
    )
  },
}))

describe('Portal settings sequence new page', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockSearchParams = new URLSearchParams()
  })

  it('keeps the scoped Sequences return command clean for team builders', () => {
    mockSearchParams = new URLSearchParams({
      orgId: 'lumen-org',
      orgSlug: 'lumen-speeds',
      sourceCompanyId: 'source-company',
      sourceCompanyName: 'Lumen',
    })

    render(<NewSequencePage />)

    expect(screen.getByText('Sequence form rendered')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sequences' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'arrow_back Sequences' })).not.toBeInTheDocument()
    expect(formProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        apiScope: expect.objectContaining({ orgId: 'lumen-org', orgSlug: 'lumen-speeds' }),
      }),
    )

    const scopedReturn = '/portal/settings/sequences?orgId=lumen-org&orgSlug=lumen-speeds&sourceCompanyId=source-company&sourceCompanyName=Lumen'

    fireEvent.click(screen.getByRole('button', { name: 'Sequences' }))
    expect(push).toHaveBeenCalledWith(scopedReturn)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel mocked sequence' }))
    expect(push).toHaveBeenCalledWith(scopedReturn)

    fireEvent.click(screen.getByRole('button', { name: 'Save mocked sequence' }))
    expect(push).toHaveBeenCalledWith(scopedReturn)
  })
})
