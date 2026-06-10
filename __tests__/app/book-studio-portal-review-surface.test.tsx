import { render, screen, waitFor } from '@testing-library/react'

import { BookStudioPortalWorkspace } from '@/components/book-studio/BookStudioPortalWorkspace'

describe('BookStudioPortalWorkspace', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('renders a safe disabled state and does not expose review or generation controls', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ success: false, moduleDisabled: true, module: 'bookStudio' }),
    }) as jest.Mock

    render(<BookStudioPortalWorkspace />)

    expect(await screen.findByText('Book Studio is not enabled for this portal.')).toBeInTheDocument()
    expect(screen.getByText('Your PiB team controls when a client-safe book review packet becomes available.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /generate book/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /publish to stores/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /connect marketplace credentials/i })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /approve packet/i })).not.toBeInTheDocument()
  })

  it('shows only client-safe review material and locks generation and direct publishing', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          portalModule: 'bookStudio',
          projects: [
            {
              id: 'book-1',
              title: 'Ocean Growth Playbook',
              status: 'client_review',
              stage: 'publishing_packet',
              reviewStatus: 'awaiting_client_review',
              nextAction: 'Review the exact publishing packet and leave comments for PiB.',
              safeSummary: 'Client-safe packet with cover proof, metadata summary, and launch checklist.',
              reviewPackets: [
                {
                  id: 'packet-1',
                  title: 'KDP paperback proof v1',
                  status: 'client_review',
                  summary: 'Review cover, interior PDF, metadata summary, and rights ledger extract.',
                  artifacts: [
                    { label: 'Cover proof', href: 'https://example.com/cover.pdf' },
                  ],
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

    expect(await screen.findByRole('heading', { name: 'Book Studio review' })).toBeInTheDocument()
    expect(await screen.findByText('Ocean Growth Playbook')).toBeInTheDocument()
    expect(screen.getByText('KDP paperback proof v1')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Cover proof' })).toHaveAttribute('href', 'https://example.com/cover.pdf')
    expect(screen.getByRole('button', { name: 'Approve packet' })).toBeDisabled()
    expect(screen.getByText('Approval opens only after PiB requests review for a client-safe packet.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /generate book/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /publish to stores/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /connect marketplace credentials/i })).toBeDisabled()

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/portal/book-studio?orgId=client-org')
    })
  })
})
