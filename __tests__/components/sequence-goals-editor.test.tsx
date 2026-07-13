import { fireEvent, render, screen } from '@testing-library/react'
import GoalsEditor from '@/components/admin/sequences/GoalsEditor'

jest.mock('@/components/admin/sequences/ConditionPicker', () => ({
  __esModule: true,
  default: () => <div>Condition</div>,
}))

it('describes both completion and early-exit outcomes without calling every goal an exit goal', () => {
  const onChange = jest.fn()
  render(<GoalsEditor goals={[]} onChange={onChange} />)
  expect(screen.getByText(/No journey goals/i)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /Add journey goal/i }))
  expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ outcome: 'complete' })])
})
