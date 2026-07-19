import { fireEvent, render, screen } from '@testing-library/react'

import { ContextStrip, EmptyContextStrip } from '@/components/chat/context/ContextStrip'

const options = [
  { kind: 'project' as const, id: 'project-1', label: 'Evaluate SkillOpt' },
  { kind: 'document' as const, id: 'document-1', label: 'Evaluation report' },
  { kind: 'company' as const, id: 'company-1', label: 'Partners in Biz' },
  { kind: 'contact' as const, id: 'contact-1', label: 'Theo' },
  { kind: 'task' as const, id: 'task-1', label: 'Design pilot' },
]

it('renders multiple pinned contexts in one selectable non-wrapping strip', () => {
  const onChange = jest.fn()
  const onRemove = jest.fn()
  render(<ContextStrip options={options} value={options[1]} onChange={onChange} onRemove={onRemove} onOpen={jest.fn()} />)

  const strip = screen.getByRole('toolbar', { name: 'Pinned conversation context' })
  expect(strip).toHaveClass('overflow-x-auto', 'whitespace-nowrap')
  expect(screen.getByRole('button', { name: 'Open Evaluation report context' })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(screen.getByRole('button', { name: 'Open Partners in Biz context' }))
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ kind: 'company', id: 'company-1' }))
  fireEvent.click(screen.getByRole('button', { name: 'Remove Theo context' }))
  expect(onRemove).toHaveBeenCalledWith(expect.objectContaining({ kind: 'contact', id: 'contact-1' }))
})

it('keeps every strip action touch-sized through tablet widths and labels Add context', () => {
  render(<ContextStrip options={options} value={options[0]} onChange={jest.fn()} onRemove={jest.fn()} onOpen={jest.fn()} onAdd={jest.fn()} />)

  const actions = screen.getByRole('toolbar', { name: 'Pinned conversation context' }).querySelectorAll('button')
  expect(actions.length).toBeGreaterThan(0)
  for (const action of actions) {
    expect(action).toHaveClass('h-11')
    expect(action.className).not.toMatch(/(?:sm|md|lg):h-(?:\d|\[)/)
    expect(action.className).not.toMatch(/(?:sm|md|lg):w-(?:\d|\[)/)
  }
  expect(screen.getByRole('button', { name: 'Add conversation context' })).toHaveTextContent('Add context')
  expect(screen.getByRole('button', { name: 'Add conversation context' })).toHaveAttribute('aria-haspopup', 'listbox')
  expect(screen.getByText('Project')).toHaveClass('xl:inline')
})

it('keeps the empty Add context action touch-sized without extra helper copy', () => {
  render(<EmptyContextStrip onAdd={jest.fn()} />)

  const action = screen.getByRole('button', { name: 'Add conversation context' })
  expect(action).toHaveClass('h-11', 'min-w-11')
  expect(action).toHaveAttribute('aria-haspopup', 'listbox')
  expect(action.className).not.toMatch(/(?:sm|md|lg):h-(?:\d|\[)/)
  expect(screen.queryByText(/Pin projects, documents/i)).not.toBeInTheDocument()
})
