import React from 'react'
import { render, screen } from '@testing-library/react'

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn() },
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({
        get: jest.fn(async () => ({ exists: false })),
      })),
    })),
  },
}))

jest.mock('@/lib/lead-capture/token', () => ({
  verifyConfirmToken: jest.fn(() => ({ ok: false })),
}))

jest.mock('@/lib/lead-capture/autoEnroll', () => ({
  performAutoEnroll: jest.fn(),
}))

jest.mock('@/lib/consent-ledger/store', () => ({
  appendConsentEvent: jest.fn(),
}))

describe('Lead confirm page', () => {
  it('renders an invalid state for a bad token', async () => {
    const Page = (await import('@/app/lead/confirm/[token]/page')).default
    render(await Page({ params: Promise.resolve({ token: 'bad' }) }))
    expect(screen.getByRole('heading', { name: /expired or invalid/i })).toBeInTheDocument()
  })
})
