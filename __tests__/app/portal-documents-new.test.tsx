import { fireEvent, render, screen } from '@testing-library/react'

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

    // Each template is a selectable card showing its label + picker description.
    const researchCard = screen.getByRole('button', { name: /Research Report/ })
    expect(researchCard).toHaveTextContent('Research Report')
    expect(researchCard).toHaveTextContent(
      /Evidence-led report for findings, confidence, contradictions, unknowns, and recommendations/i
    )

    const buildSpecCard = screen.getByRole('button', { name: /Website\/App Build Spec/ })
    expect(buildSpecCard).toHaveTextContent('Website/App Build Spec')
    expect(buildSpecCard).toHaveTextContent(
      /Implementation spec for a website, app, integration, or platform feature build/i
    )

    expect(screen.getByRole('button', { name: /Change Request/ })).toHaveTextContent(
      /Scoped change to approved work/i
    )

    // Picking the research card reveals research-specific decision support copy.
    fireEvent.click(researchCard)

    expect(screen.getByText(/Research questions, source ledgers, truth checks, options, and decision support/i)).toBeInTheDocument()
    expect(screen.getByText(/Research decides what is true, what is still unknown, and what options are credible/i)).toBeInTheDocument()
    expect(screen.getByText(/should not blindly create code tasks/i)).toBeInTheDocument()

    // Picking the build spec card reveals build-execution decision support copy.
    fireEvent.click(buildSpecCard)

    expect(screen.getByText(/Requirements, technical approach, data\/API changes, tests, rollout, and rollback/i)).toBeInTheDocument()
    expect(screen.getByText(/Specs decide what to build, in what order, and how QA will prove it is done/i)).toBeInTheDocument()
    expect(screen.getByText(/next decision is build execution/i)).toBeInTheDocument()
  })

  it('prefills gated build spec creation from dashboard query parameters', async () => {
    window.history.pushState({}, '', '/portal/documents/new?type=build_spec&title=PiB%20Platform%20Build%20Spec%20%E2%80%94%20Next%20Approved%20Sprint')

    render(<NewDocumentPage />)
    await screen.findByText('Partners in Biz')

    expect(screen.getByText('Partners in Biz')).toBeInTheDocument()
    expect(screen.getByLabelText('Title')).toHaveValue('PiB Platform Build Spec — Next Approved Sprint')

    // The build spec template card is preselected from the type query param.
    expect(screen.getByRole('button', { name: /Website\/App Build Spec/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByText(/Specs decide what to build, in what order, and how QA will prove it is done/i)).toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: /Research Report/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Create document' })).toBeDisabled()
  })
})
