import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { CommentComposer } from '@/components/inline-comments/CommentComposer'
import type { ContextReference } from '@/lib/context-references/types'

const contextRef: ContextReference = {
  type: 'project',
  id: 'project-1',
  orgId: 'org-1',
  label: 'Launch Project',
  origin: 'mention',
  href: '/admin/projects/project-1',
  summary: 'status: active',
}

beforeEach(() => {
  jest.clearAllMocks()
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith('/api/v1/context-references/search')) {
      return {
        ok: true,
        json: async () => ({ success: true, data: { refs: [contextRef] } }),
      } as Response
    }
    throw new Error(`Unexpected fetch ${url}`)
  })
})

describe('CommentComposer context references', () => {
  it('passes selected context refs with submitted feedback', async () => {
    const onSubmit = jest.fn()

    render(
      <CommentComposer
        anchor={{ kind: 'general' }}
        orgId="org-1"
        onCancel={jest.fn()}
        onSubmit={onSubmit}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText(/What needs to change/i), {
      target: { value: 'Please line this up with the launch work.' },
    })
    fireEvent.change(screen.getByLabelText('Add feedback context reference'), {
      target: { value: '@projects:launch' },
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Attach Launch Project' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(
      'Please line this up with the launch work.',
      [expect.objectContaining({ type: 'project', id: 'project-1', label: 'Launch Project' })],
    ))
  })
})
