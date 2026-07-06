import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BookStudioProjectsIndex } from '@/components/book-studio/BookStudioProjectsIndex'

const listRecords = jest.fn()
jest.mock('@/lib/book-studio/client', () => ({
  ...jest.requireActual('@/lib/book-studio/client'),
  listBookStudioRecords: (...args: unknown[]) => listRecords(...args),
  createBookStudioRecord: jest.fn().mockResolvedValue({ ok: true, data: { id: 'px' } }),
}))
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }))

describe('BookStudioProjectsIndex', () => {
  beforeEach(() => {
    listRecords.mockResolvedValue({
      ok: true,
      data: { records: [
        { id: 'p1', title: 'Growth Playbook', format: 'nonfiction', stage: 'brief', coverImageUrl: '' },
      ] },
    })
  })

  it('lists projects with format labels and links to the workspace', async () => {
    render(<BookStudioProjectsIndex orgId="org-1" orgSlug="pib" />)
    expect(await screen.findByText('Growth Playbook')).toBeInTheDocument()
    expect(screen.getByText(/Non-fiction/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Growth Playbook/ }))
      .toHaveAttribute('href', '/admin/org/pib/book-studio/p1')
  })

  it('opens the NewBookDialog from the New book button', async () => {
    render(<BookStudioProjectsIndex orgId="org-1" orgSlug="pib" />)
    await screen.findByText('Growth Playbook')
    fireEvent.click(screen.getByRole('button', { name: /New book/i }))
    await waitFor(() => expect(screen.getByRole('dialog', { name: /New book/i })).toBeInTheDocument())
  })

  it('shows empty state with create action when no projects', async () => {
    listRecords.mockResolvedValue({ ok: true, data: { records: [] } })
    render(<BookStudioProjectsIndex orgId="org-1" orgSlug="pib" />)
    expect(await screen.findByText(/No books yet/i)).toBeInTheDocument()
  })
})
