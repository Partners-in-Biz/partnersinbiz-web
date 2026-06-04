import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CampaignRequestPanel } from '@/app/(portal)/portal/campaigns/CampaignRequestPanel'

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 201 : 500,
    json: async () => body,
  } as Response
}

describe('CampaignRequestPanel', () => {
  beforeEach(() => {
    global.fetch = jest.fn(async () => jsonResponse({ data: { id: 'request-1' } }))
  })

  it('submits campaign requests against the scoped company workspace org', async () => {
    render(React.createElement(CampaignRequestPanel as React.ComponentType<{ orgId?: string }>, { orgId: 'lumen-org' }))

    fireEvent.click(screen.getByRole('button', { name: /New request/ }))
    fireEvent.change(screen.getByLabelText('Campaign name'), { target: { value: 'Lumen launch' } })
    fireEvent.change(screen.getByLabelText('Goal'), { target: { value: 'Launch the campaign' } })
    fireEvent.change(screen.getByLabelText('Audience'), { target: { value: 'Lumen prospects' } })
    fireEvent.submit(screen.getByRole('button', { name: /Send request/ }).closest('form')!)

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v1/portal/campaign-requests?orgId=lumen-org',
        expect.objectContaining({ method: 'POST' }),
      )
    })
  })
})
