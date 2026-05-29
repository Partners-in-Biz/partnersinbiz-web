import React from 'react'
import { render, screen } from '@testing-library/react'
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
  })

  it('prefills the recipient from the contact action query string', () => {
    searchParams.set('to', 'jane@example.com')

    render(<ComposeForm />)

    expect(screen.getByPlaceholderText('recipient@example.com or contact name')).toHaveValue('jane@example.com')
  })
})
