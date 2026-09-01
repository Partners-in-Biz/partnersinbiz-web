import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SupportDrawer } from '@/components/support/SupportDrawer'

const contextRef = {
  type: 'project',
  id: 'project-1',
  orgId: 'org-1',
  label: 'Launch Project',
  origin: 'mention',
  href: '/portal/projects/project-1',
  summary: 'status: active',
}

beforeEach(() => {
  jest.clearAllMocks()
  window.history.pushState({}, '', '/portal/projects/project-1')
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.startsWith('/api/v1/portal/support') && !url.includes('/messages') && !init?.method) {
      return { ok: true, json: async () => ({ success: true, data: [] }) } as Response
    }
    if (url.startsWith('/api/v1/context-references/search')) {
      return { ok: true, json: async () => ({ success: true, data: { refs: [contextRef] } }) } as Response
    }
    if (url.startsWith('/api/v1/portal/support') && !url.includes('/messages') && init?.method === 'POST') {
      return { ok: true, json: async () => ({ success: true, data: { id: 'ticket-1' } }) } as Response
    }
    if (url.startsWith('/api/v1/portal/support/ticket-1/messages')) {
      return { ok: true, json: async () => ({ success: true, data: [] }) } as Response
    }
    throw new Error(`Unexpected fetch ${url}`)
  })
})

describe('SupportDrawer context references', () => {
  it('attaches selected context refs to new support tickets', async () => {
    render(<SupportDrawer orgId="org-1" />)

    fireEvent.click(screen.getByRole('button', { name: /Need help/i }))
    expect(await screen.findByText('Create a ticket')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Short summary'), {
      target: { value: 'Need help on this project' },
    })
    fireEvent.change(screen.getByPlaceholderText(/Tell us what happened/i), {
      target: { value: 'What should we do next?' },
    })
    fireEvent.change(screen.getByLabelText('Add support context reference'), {
      target: { value: '@projects:launch' },
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Attach Launch Project' }))
    fireEvent.click(screen.getByRole('button', { name: /Create ticket/i }))

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/v1/portal/support?orgId=org-1',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-org-id': 'org-1' }),
      }),
    ))
    const createCall = (global.fetch as jest.Mock).mock.calls.find(([url, init]) => (
      String(url).startsWith('/api/v1/portal/support') && !String(url).includes('/messages') && init?.method === 'POST'
    ))
    expect(JSON.parse(createCall[1].body)).toEqual(expect.objectContaining({
      contextRefs: [expect.objectContaining({ type: 'project', id: 'project-1', label: 'Launch Project' })],
    }))
  })
})
