import { fireEvent, render, screen, within } from '@testing-library/react'
import { LifeOsPlanningWorkbench } from '@/components/self-improvement/LifeOsPlanningWorkbench'

describe('LifeOsPlanningWorkbench', () => {
  it('renders vision to quarterly, weekly, daily, and progress layers', () => {
    render(<LifeOsPlanningWorkbench />)

    expect(screen.getByRole('heading', { name: /Life OS planning engine/i })).toBeInTheDocument()
    expect(screen.getByText('Long-term vision')).toBeInTheDocument()
    expect(screen.getByText('Quarterly outcomes')).toBeInTheDocument()
    expect(screen.getByText('Weekly commitments')).toBeInTheDocument()
    expect(screen.getByText('Daily actions')).toBeInTheDocument()
    expect(screen.getByText('Daily check-in')).toBeInTheDocument()
    expect(screen.getByText('Weekly review')).toBeInTheDocument()
    expect(screen.getByText('AI coach context')).toBeInTheDocument()
    expect(screen.getByText('Insights dashboard signals')).toBeInTheDocument()
    expect(screen.getAllByText('Reviewable progress').length).toBeGreaterThan(0)
    expect(screen.getByText('67% complete')).toBeInTheDocument()
  })

  it('lets the operator edit, archive, reorder, and recover missed planning actions', () => {
    render(<LifeOsPlanningWorkbench />)

    fireEvent.click(screen.getByRole('button', { name: /Edit quarterly outcome/i }))
    expect(screen.getByDisplayValue('Build an evidence-led weekly operating rhythm')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Quarterly outcome title'), {
      target: { value: 'Build a resilient weekly operating rhythm' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Save quarterly outcome/i }))
    expect(screen.getByText('Build a resilient weekly operating rhythm')).toBeInTheDocument()
    expect(screen.getByText('Edited')).toBeInTheDocument()

    const actions = screen.getByTestId('daily-actions')
    fireEvent.click(screen.getByRole('button', { name: /Move action down/i }))
    expect(within(actions).getAllByRole('listitem')[1]).toHaveTextContent('Protect 90 minutes for deep work')
    expect(screen.getAllByText('Reordered').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: /Missed action recovery/i }))
    expect(screen.getByText('Recovery')).toBeInTheDocument()
    expect(screen.getByText(/Recommit/)).toBeInTheDocument()
    expect(screen.getByText(/Reschedule/)).toBeInTheDocument()
    expect(screen.getByText(/Shrink/)).toBeInTheDocument()
    expect(screen.getAllByText(/Archive/).length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: /Archive quarterly outcome/i }))
    expect(screen.getByText('Archived')).toBeInTheDocument()
  })
})
