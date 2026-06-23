import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import StatusPage from '@/app/status/page'

const fetchMock = jest.fn()

describe('StatusPage', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    global.fetch = fetchMock
  })

  it('renders the public status surface from the no-auth status API', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          overall: 'degraded',
          checkedAt: '2026-06-23T10:00:00.000Z',
          services: [
            { key: 'firestore', name: 'Firestore', status: 'ok', latencyMs: 44, latencyInstrumented: true },
            { key: 'paypal', name: 'PayPal', status: 'degraded', latencyMs: 1800, latencyInstrumented: true },
          ],
        },
      }),
    })

    render(<StatusPage />)

    expect(await screen.findByRole('heading', { name: /platform status/i })).toBeInTheDocument()
    expect(await screen.findByText(/Investigating/i)).toBeInTheDocument()
    expect(screen.getByText('Firestore')).toBeInTheDocument()
    expect(screen.getByText('PayPal')).toBeInTheDocument()
    expect(screen.getByText(/1.8s/i)).toBeInTheDocument()
  })
})
