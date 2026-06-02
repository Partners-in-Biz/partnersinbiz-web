import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ComposeForm } from '@/components/admin/email/ComposeForm'

const push = jest.fn()
const searchParams = new URLSearchParams()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => searchParams,
}))

describe('ComposeForm', () => {
  beforeEach(() => {
    push.mockClear()
    searchParams.forEach((_, key) => searchParams.delete(key))
    jest.restoreAllMocks()
  })

  it('prefills the recipient from the contact action query string', () => {
    searchParams.set('to', 'jane@example.com')

    render(<ComposeForm />)

    expect(screen.getByPlaceholderText('recipient@example.com or contact name')).toHaveValue('jane@example.com')
  })

  it('forwards contact and org scope from the query string when sending', async () => {
    searchParams.set('to', 'jane@example.com')
    searchParams.set('subject', 'Follow up')
    searchParams.set('contactId', 'contact-1')
    searchParams.set('orgId', 'org-1')
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { id: 'email-1' } }),
    } as Response)
    global.fetch = fetchMock

    const { container } = render(<ComposeForm />)
    const editor = container.querySelector('[contenteditable="true"]') as HTMLElement
    editor.innerHTML = '<p>Hello Jane</p>'
    fireEvent.input(editor)
    fireEvent.click(screen.getByRole('button', { name: 'Send Now' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/v1/email/send', expect.objectContaining({
      method: 'POST',
      body: expect.any(String),
    })))
    const payload = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(payload).toMatchObject({
      to: 'jane@example.com',
      subject: 'Follow up',
      bodyText: '<p>Hello Jane</p>',
      contactId: 'contact-1',
      orgId: 'org-1',
    })
    expect(push).toHaveBeenCalledWith('/admin/email')
  })
})
