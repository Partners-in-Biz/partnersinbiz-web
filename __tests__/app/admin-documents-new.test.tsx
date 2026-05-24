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

import NewDocumentPage from '@/app/(admin)/admin/documents/new/page'

describe('new client document type picker copy', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({ data: [{ id: 'org-1', name: 'Partners in Biz', slug: 'partners' }] }),
    }) as jest.Mock
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('explains that research and specs support different decisions', async () => {
    render(<NewDocumentPage />)
    await screen.findByRole('option', { name: 'Partners in Biz' })

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
})
