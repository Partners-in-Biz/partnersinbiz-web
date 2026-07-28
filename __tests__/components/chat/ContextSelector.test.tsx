import { fireEvent, render, screen } from '@testing-library/react'
import { ContextSelector } from '@/components/chat/context/ContextSelector'
import { chatContextReferenceKey } from '@/lib/chat-context/types'

it('uses one compact selector for multiple context refs with a visible keyboard focus state', () => {
  const onChange = jest.fn()
  render(<ContextSelector
    options={[
      { kind: 'project', id: 'project-1', label: 'Launch project' },
      { kind: 'studio_artifact', id: 'video_editor:video:cut-7', label: 'Launch cut' },
    ]}
    value={{ kind: 'project', id: 'project-1' }}
    onChange={onChange}
  />)

  const selector = screen.getByRole('combobox', { name: 'Active context' })
  expect(selector).toHaveClass('focus-visible:ring-2')
  expect(selector).toHaveClass('focus-visible:border-primary/60')
  fireEvent.change(selector, {
    target: { value: chatContextReferenceKey({ kind: 'studio_artifact', id: 'video_editor:video:cut-7' }) },
  })
  expect(onChange).toHaveBeenCalledWith({ kind: 'studio_artifact', id: 'video_editor:video:cut-7' })
})
