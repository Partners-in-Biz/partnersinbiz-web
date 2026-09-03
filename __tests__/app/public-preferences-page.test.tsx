import React from 'react'
import { render, screen } from '@testing-library/react'

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({
        get: jest.fn(async () => ({ exists: false })),
      })),
    })),
  },
}))

jest.mock('@/lib/email/unsubscribeToken', () => ({
  verifyUnsubscribeToken: jest.fn(() => ({ ok: false })),
}))

describe('Public preferences page', () => {
  it('renders an invalid-link state for a bad token', async () => {
    const Page = (await import('@/app/preferences/[token]/page')).default
    render(await Page({ params: Promise.resolve({ token: 'bad' }) }))
    expect(screen.getByRole('heading', { name: /invalid or has expired/i })).toBeInTheDocument()
  })
})
