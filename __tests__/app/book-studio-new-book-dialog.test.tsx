import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { NewBookDialog } from '@/components/book-studio/NewBookDialog'

const createRecord = jest.fn()
jest.mock('@/lib/book-studio/client', () => ({
  ...jest.requireActual('@/lib/book-studio/client'),
  createBookStudioRecord: (...args: unknown[]) => createRecord(...args),
}))

describe('NewBookDialog', () => {
  beforeEach(() => {
    createRecord.mockReset()
    createRecord.mockResolvedValue({ ok: true, data: { id: 'proj-9' } })
  })

  it('walks format → details → creates project + starter chapters', async () => {
    const onCreated = jest.fn()
    render(<NewBookDialog orgId="org-1" surface="admin" open onClose={() => {}} onCreated={onCreated} />)

    fireEvent.click(screen.getByRole('button', { name: /Non-fiction/i }))
    fireEvent.click(screen.getByRole('button', { name: /Lead magnet/i }))
    fireEvent.change(screen.getByLabelText(/Title/i), { target: { value: 'Grow Faster' } })
    fireEvent.click(screen.getByRole('button', { name: /Create book/i }))

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('proj-9'))
    expect(createRecord).toHaveBeenCalledTimes(5) // 1 project + 4 chapters
    expect(createRecord.mock.calls[0][0]).toBe('projects')
    expect(createRecord.mock.calls[1][2]).toMatchObject({ projectId: 'proj-9', title: 'Hook', order: 0 })
  })

  it('surfaces partial chapter failure but still hands off the created project', async () => {
    const onCreated = jest.fn()
    createRecord.mockImplementation((resource: string) => {
      if (resource === 'projects') return Promise.resolve({ ok: true, data: { id: 'proj-9' } })
      return Promise.resolve({ ok: false, error: 'boom', status: 500 })
    })
    render(<NewBookDialog orgId="org-1" surface="admin" open onClose={() => {}} onCreated={onCreated} />)

    fireEvent.click(screen.getByRole('button', { name: /Non-fiction/i }))
    fireEvent.click(screen.getByRole('button', { name: /Lead magnet/i }))
    fireEvent.change(screen.getByLabelText(/Title/i), { target: { value: 'Grow Faster' } })
    fireEvent.click(screen.getByRole('button', { name: /Create book/i }))

    expect(await screen.findByText(/some starter chapters could not be added/i)).toBeInTheDocument()
    expect(onCreated).toHaveBeenCalledWith('proj-9')
  })

  it('surfaces a thrown chapter failure the same way', async () => {
    const onCreated = jest.fn()
    createRecord.mockImplementation((resource: string) => {
      if (resource === 'projects') return Promise.resolve({ ok: true, data: { id: 'proj-9' } })
      return Promise.reject(new Error('network down'))
    })
    render(<NewBookDialog orgId="org-1" surface="admin" open onClose={() => {}} onCreated={onCreated} />)

    fireEvent.click(screen.getByRole('button', { name: /Non-fiction/i }))
    fireEvent.click(screen.getByRole('button', { name: /Lead magnet/i }))
    fireEvent.change(screen.getByLabelText(/Title/i), { target: { value: 'Grow Faster' } })
    fireEvent.click(screen.getByRole('button', { name: /Create book/i }))

    expect(await screen.findByText(/some starter chapters could not be added/i)).toBeInTheDocument()
    expect(onCreated).toHaveBeenCalledWith('proj-9')
  })

  it('resets stale state when reopened', () => {
    const { rerender } = render(
      <NewBookDialog orgId="org-1" surface="admin" open onClose={() => {}} onCreated={() => {}} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Non-fiction/i }))
    fireEvent.change(screen.getByLabelText(/Title/i), { target: { value: 'Stale Draft' } })

    rerender(<NewBookDialog orgId="org-1" surface="admin" open={false} onClose={() => {}} onCreated={() => {}} />)
    rerender(<NewBookDialog orgId="org-1" surface="admin" open onClose={() => {}} onCreated={() => {}} />)

    // Back on step 1 (format picker) with no lingering details form
    expect(screen.getByRole('button', { name: /Non-fiction/i })).toBeInTheDocument()
    expect(screen.queryByLabelText(/Title/i)).not.toBeInTheDocument()
  })

  it('requires a title', async () => {
    render(<NewBookDialog orgId="org-1" surface="admin" open onClose={() => {}} onCreated={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /^Story/i }))
    fireEvent.click(screen.getByRole('button', { name: /Create book/i }))
    expect(await screen.findByText(/Title is required/i)).toBeInTheDocument()
    expect(createRecord).not.toHaveBeenCalled()
  })
})
