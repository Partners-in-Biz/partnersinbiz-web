import { fireEvent, render, screen, within } from '@testing-library/react'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

import NewDocumentPage from '@/app/(portal)/portal/documents/new/page'

describe('new client document type picker copy', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/')
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({ org: { id: 'org-1', name: 'Partners in Biz', slug: 'partners' } }),
    }) as jest.Mock
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('explains that research and specs support different decisions', async () => {
    render(<NewDocumentPage />)
    await screen.findByText('Partners in Biz')

    expect(screen.getByText(/research decides what is true; specs decide what to build/i)).toBeInTheDocument()

    const typeSelect = screen.getByLabelText('Document type')
    expect(within(typeSelect).getByRole('option', { name: /Research Report — Evidence-led report/i })).toBeInTheDocument()
    expect(within(typeSelect).getByRole('option', { name: /Website\/App Build Spec — Implementation spec/i })).toBeInTheDocument()
    expect(within(typeSelect).getByRole('option', { name: /Change Request — Scoped change/i })).toBeInTheDocument()

    fireEvent.change(typeSelect, { target: { value: 'research_report' } })

    expect(screen.getByRole('heading', { name: 'Research Report' })).toBeInTheDocument()
    expect(screen.getByText('research-report-v1')).toBeInTheDocument()
    expect(screen.getByText(/Research questions, source ledgers, truth checks, options, and decision support/i)).toBeInTheDocument()
    expect(screen.getByText(/should not blindly create code tasks/i)).toBeInTheDocument()

    fireEvent.change(typeSelect, { target: { value: 'build_spec' } })

    expect(screen.getByRole('heading', { name: 'Website/App Build Spec' })).toBeInTheDocument()
    expect(screen.getByText('build-spec-v1')).toBeInTheDocument()
    expect(screen.getByText(/Requirements, technical approach, data\/API changes, tests, rollout, and rollback/i)).toBeInTheDocument()
    expect(screen.getByText(/next decision is build execution/i)).toBeInTheDocument()
  })

  it('prefills gated build spec creation from dashboard query parameters', async () => {
    window.history.pushState({}, '', '/portal/documents/new?type=build_spec&title=PiB%20Platform%20Build%20Spec%20%E2%80%94%20Next%20Approved%20Sprint')

    render(<NewDocumentPage />)
    await screen.findByText('Partners in Biz')

    expect(screen.getByText('Partners in Biz')).toBeInTheDocument()
    expect(screen.getByLabelText('Title')).toHaveValue('PiB Platform Build Spec — Next Approved Sprint')
    expect(screen.getByLabelText('Document type')).toHaveValue('build_spec')
    expect(screen.getByRole('heading', { name: 'Website/App Build Spec' })).toBeInTheDocument()
  })

  it('disables document creation when the organisation policy denies the member role', async () => {
    window.history.pushState({}, '', '/portal/documents/new?title=Blocked%20proposal')
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({
        org: {
          id: 'org-1',
          name: 'Partners in Biz',
          slug: 'partners',
          modulePolicies: {
            documents: {
              actions: {
                create: { owner: true, admin: true, member: false },
              },
            },
          },
        },
        user: { role: 'client', memberRole: 'member' },
      }),
    }) as jest.Mock

    render(<NewDocumentPage />)
    await screen.findByText('Partners in Biz')

    expect(screen.getByText('Document creation is disabled for your organisation role.')).toBeInTheDocument()
    expect(screen.getByLabelText('Title')).toBeDisabled()
    expect(screen.getByLabelText('Document type')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Create document' })).toBeDisabled()
  })
})
