import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import FirstRunPage from '@/app/(portal)/portal/first-run/page'

describe('Portal first-run page', () => {
  beforeEach(() => {
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/portal/first-run' && !init?.method) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              firstRun: {
                completed: false,
                identity: { preferredName: 'Peet Stander', pronouns: '', location: '' },
                values: [],
                lifeDomains: [],
                constraints: [],
                goals: [],
                baseline: { confidence: null, energy: null, timeCapacityHours: null },
                privacy: { consentToStore: false, shareWithTeam: false, allowAgentPersonalization: false },
              },
            },
          }),
        } as Response)
      }
      if (url === '/api/v1/portal/first-run' && init?.method === 'PATCH') {
        return Promise.resolve({ ok: true, json: async () => ({ data: { saved: true } }) } as Response)
      }
      return Promise.resolve({ ok: false, json: async () => ({ error: 'unexpected fetch' }) } as Response)
    }) as jest.Mock
  })

  it('captures the complete first-run operating profile and consent choices', async () => {
    render(<FirstRunPage />)

    expect(await screen.findByRole('heading', { name: 'First-run setup' })).toBeInTheDocument()
    expect(screen.getByLabelText('Preferred name')).toHaveValue('Peet Stander')

    fireEvent.change(screen.getByLabelText('Core values'), { target: { value: 'Freedom\nFamily' } })
    fireEvent.change(screen.getByLabelText('Life domains'), { target: { value: 'Health: Morning training\nBusiness: Client platform' } })
    fireEvent.change(screen.getByLabelText('Current constraints'), { target: { value: 'School runs\nNo late calls' } })
    fireEvent.change(screen.getByLabelText('Goals'), { target: { value: 'Launch alpha | business | 90 days' } })
    fireEvent.change(screen.getByLabelText('Confidence baseline'), { target: { value: '8' } })
    fireEvent.change(screen.getByLabelText('Energy baseline'), { target: { value: '6' } })
    fireEvent.change(screen.getByLabelText('Time capacity per week'), { target: { value: '12' } })
    fireEvent.click(screen.getByLabelText('I consent to Partners in Biz storing this first-run profile for my workspace.'))
    fireEvent.click(screen.getByLabelText('Allow agents to use this profile for personalisation inside this workspace.'))
    fireEvent.click(screen.getByRole('button', { name: 'Save first-run profile' }))

    await screen.findByRole('button', { name: 'Saved' })
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v1/portal/first-run',
        expect.objectContaining({
          method: 'PATCH',
          body: expect.stringContaining('Launch alpha'),
        }),
      )
    })
  })

  it('shows the approved feature-flag disabled state without persisting answers', async () => {
    ;(global.fetch as jest.Mock).mockImplementationOnce(() => Promise.resolve({
      ok: false,
      status: 403,
      json: async () => ({ moduleDisabled: true }),
    } as Response))

    render(<FirstRunPage />)

    const notice = await screen.findByRole('status')
    expect(within(notice).getByText('First-run setup is not enabled for this workspace yet.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save first-run profile' })).not.toBeInTheDocument()
  })
})
