import { fireEvent, render, screen } from '@testing-library/react'
import StepEditor from '@/components/admin/sequences/StepEditor'
import type { SequenceStep } from '@/lib/sequences/types'

describe('StepEditor', () => {
  it('renders the shared preflight panel for saved email sequence steps', () => {
    const steps: SequenceStep[] = [
      {
        stepNumber: 1,
        delayDays: 0,
        subject: 'Welcome',
        bodyHtml: '<p>Hello</p>',
        bodyText: 'Hello',
        channel: 'email',
      },
    ]

    render(<StepEditor steps={steps} onChange={jest.fn()} sequenceId="sequence-1" />)

    fireEvent.click(screen.getByRole('button', { name: /Step 1: Welcome/i }))

    expect(screen.getByText('Preflight checklist')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Re-run' })).toBeInTheDocument()
  })
})
