import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ProjectPeopleAccessPanel } from '@/components/projects/ProjectPeopleAccessPanel'

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

describe('ProjectPeopleAccessPanel existing organisation linking', () => {
  it('lists accessible unlinked organisations and posts the selected org directly', async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/organizations') {
        return response({ data: [
          { id: 'owner-org', name: 'Partners in Biz' },
          { id: 'client-org', name: 'Client Organisation' },
          { id: 'already-linked', name: 'Already Linked' },
        ] })
      }
      if (url === '/api/v1/projects/project-1/access?orgId=owner-org' && init?.method === 'POST') {
        return response({ data: { orgId: 'client-org', status: 'active' } }, 201)
      }
      if (url === '/api/v1/projects/project-1/access?orgId=owner-org') {
        return response({ data: {
          members: [],
          memberCandidates: [],
          organizations: [{ orgId: 'already-linked', recipientCompanyName: 'Already Linked', role: 'reviewer', status: 'active' }],
          invites: [],
        } })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
    global.fetch = fetchMock

    render(<ProjectPeopleAccessPanel projectId="project-1" orgId="owner-org" />)

    const selector = await screen.findByRole('combobox', { name: 'Existing organisation' })
    await within(selector).findByRole('option', { name: 'Client Organisation' })
    expect(within(selector).getByRole('option', { name: 'Client Organisation' })).toBeInTheDocument()
    expect(within(selector).queryByRole('option', { name: 'Partners in Biz' })).not.toBeInTheDocument()
    expect(within(selector).queryByRole('option', { name: 'Already Linked' })).not.toBeInTheDocument()

    fireEvent.change(selector, { target: { value: 'client-org' } })
    fireEvent.click(screen.getByRole('button', { name: 'Link organisation' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/projects/project-1/access?orgId=owner-org',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          action: 'link_organization',
          targetOrgId: 'client-org',
          role: 'reviewer',
          orgId: 'owner-org',
        }),
      }),
    ))
  })
})
