import { render, screen, waitFor } from '@testing-library/react'

import { BookStudioPortalWorkspace } from '@/components/book-studio/BookStudioPortalWorkspace'

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }))

const baseCapabilities = {
  canView: true,
  canCreate: false,
  canEdit: true,
  canEvidenceRights: true,
  canApprovalGates: false,
  canPublishingPackets: false,
  canArchiveDelete: false,
  isOperator: false,
}

describe('BookStudioPortalWorkspace', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('renders a safe disabled state when the module is disabled', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ success: false, moduleDisabled: true, module: 'bookStudio' }),
    }) as jest.Mock

    render(<BookStudioPortalWorkspace />)

    expect(await screen.findByText('Book Studio is not enabled for this portal.')).toBeInTheDocument()
    expect(screen.getByText('Your PiB team controls when a client-safe book review packet becomes available.')).toBeInTheDocument()
  })

  it('renders project cards as links to /portal/book-studio/{id}', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          resource: 'projects',
          orgId: 'client-org',
          capabilities: baseCapabilities,
          records: [
            {
              id: 'book-1',
              title: 'Ocean Growth Playbook',
              status: 'client_review',
              stage: 'publishing_packet',
              format: 'nonfiction',
              reviewPackets: [
                {
                  id: 'packet-1',
                  title: 'KDP paperback proof v1',
                  status: 'client_review',
                  summary: 'Review cover, interior PDF, metadata summary, and rights ledger extract.',
                  artifacts: [{ label: 'Cover proof', href: 'https://example.com/cover.pdf' }],
                },
              ],
              gates: [
                { id: 'rights', label: 'Rights ledger', status: 'passed' },
                { id: 'release', label: 'Human release review', status: 'blocked' },
              ],
            },
          ],
        },
      }),
    }) as jest.Mock

    render(<BookStudioPortalWorkspace orgId="client-org" />)

    expect(await screen.findByText('Ocean Growth Playbook')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Ocean Growth Playbook/ })).toHaveAttribute('href', '/portal/book-studio/book-1')
    expect(screen.getByText('KDP paperback proof v1')).toBeInTheDocument()
    expect(screen.getByText('Rights ledger')).toBeInTheDocument()

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/portal/book-studio/projects?orgId=client-org')
    })
  })

  it('shows the "New book" button when capabilities.canCreate is true and hides it otherwise', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          resource: 'projects',
          orgId: 'client-org',
          capabilities: { ...baseCapabilities, canCreate: true },
          records: [],
        },
      }),
    }) as jest.Mock

    render(<BookStudioPortalWorkspace orgId="client-org" />)
    await screen.findByText(/No books yet/i)
    expect(screen.getByRole('button', { name: /New book/i })).toBeInTheDocument()
  })

  it('hides the "New book" button when capabilities.canCreate is false', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          resource: 'projects',
          orgId: 'client-org',
          capabilities: baseCapabilities,
          records: [],
        },
      }),
    }) as jest.Mock

    render(<BookStudioPortalWorkspace orgId="client-org" />)
    await screen.findByText(/No books yet/i)
    expect(screen.queryByRole('button', { name: /New book/i })).not.toBeInTheDocument()
  })

  it('keeps the manual release posture note visible', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          resource: 'projects',
          orgId: 'client-org',
          capabilities: baseCapabilities,
          records: [],
        },
      }),
    }) as jest.Mock

    render(<BookStudioPortalWorkspace orgId="client-org" />)
    expect(await screen.findByText(/Manual release posture/i)).toBeInTheDocument()
  })
})
