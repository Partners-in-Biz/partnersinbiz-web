import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
// admin/clients/new now redirects to admin/organizations/new — test the canonical page
import NewClientPage from '@/app/(admin)/admin/organizations/new/page'

const push = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

describe('NewClientPage', () => {
  beforeEach(() => {
    push.mockClear()
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { id: 'org_1', slug: 'acme-inc' } }),
    }) as jest.Mock
  })

  it('requests full Cowork/Hermes workspace provisioning by default', async () => {
    render(<NewClientPage />)

    fireEvent.change(screen.getByLabelText(/Client workspace name/i), { target: { value: 'Acme Inc' } })
    fireEvent.change(screen.getByLabelText(/Owner name/i), { target: { value: 'Jane Doe' } })
    fireEvent.change(screen.getByLabelText(/Owner email/i), { target: { value: 'jane@acme.com' } })
    fireEvent.change(screen.getByLabelText(/Agent profile name/i), { target: { value: 'Ava' } })
    fireEvent.click(screen.getByRole('button', { name: /Provision client workspace/i }))

    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    // The org POST is the first fetch call.
    const [orgUrl, init] = (global.fetch as jest.Mock).mock.calls[0]

    expect(orgUrl).toBe('/api/v1/organizations')
    expect(JSON.parse(init.body)).toMatchObject({
      name: 'Acme Inc',
      agentName: 'Ava',
      provisionWorkspace: true,
      type: 'client',
      status: 'onboarding',
    })
  })

  it('allows admins to create only the Firebase organisation record when needed', async () => {
    render(<NewClientPage />)

    fireEvent.change(screen.getByLabelText(/Client workspace name/i), { target: { value: 'Acme Inc' } })
    fireEvent.change(screen.getByLabelText(/Owner name/i), { target: { value: 'Jane Doe' } })
    fireEvent.change(screen.getByLabelText(/Owner email/i), { target: { value: 'jane@acme.com' } })
    // Untick the "Provision full client workspace" toggle -> Firebase-only org record.
    fireEvent.click(screen.getByLabelText(/Provision full client workspace/i))
    fireEvent.click(screen.getByRole('button', { name: /Provision client workspace/i }))

    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    const [orgUrl, init] = (global.fetch as jest.Mock).mock.calls[0]

    expect(orgUrl).toBe('/api/v1/organizations')
    expect(JSON.parse(init.body)).toMatchObject({ provisionWorkspace: false })
  })
})
