import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BookProjectHeader } from '@/components/book-studio/project/BookProjectHeader'
import type { BookProject } from '@/components/book-studio/project/types'

const mockTransition = jest.fn()

jest.mock('@/lib/book-studio/client', () => ({
  transitionBookStudioProject: (...args: unknown[]) => mockTransition(...args),
}))

const baseProject: BookProject = { id: 'proj-1', orgId: 'org-1', title: 'My Book' }

function renderHeader(project: BookProject, extraProps: Record<string, unknown> = {}) {
  return render(
    <BookProjectHeader
      project={project}
      orgId="org-1"
      onOpenInCanvas={jest.fn()}
      openingCanvas={false}
      onAssemble={jest.fn()}
      assembling={false}
      onTransitioned={jest.fn()}
      {...extraProps}
    />
  )
}

describe('BookProjectHeader lifecycle UI', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('shows "draft" as the lifecycle pill when lifecycleState is missing', () => {
    renderHeader(baseProject)
    expect(screen.getByText('draft')).toBeInTheDocument()
  })

  it('shows the stored lifecycleState as a pill', () => {
    renderHeader({ ...baseProject, lifecycleState: 'rights_cleared' })
    expect(screen.getByText('rights cleared')).toBeInTheDocument()
  })

  it('renders a button per allowed forward/reopen transition', () => {
    renderHeader({ ...baseProject, lifecycleState: 'content_complete' })
    expect(screen.getByText('Move to rights cleared')).toBeInTheDocument()
    expect(screen.getByText('Move to draft')).toBeInTheDocument()
  })

  it('renders no transition buttons for a surface without operator/portal wiring (draft has one forward option)', () => {
    renderHeader({ ...baseProject, lifecycleState: 'archived' })
    expect(screen.getByText('Move to draft')).toBeInTheDocument()
    expect(screen.queryByText('Move to content complete')).not.toBeInTheDocument()
  })

  it('calls the transition endpoint with the target state and reports success', async () => {
    mockTransition.mockResolvedValue({ ok: true, data: { from: 'content_complete', to: 'rights_cleared' } })
    const onTransitioned = jest.fn()
    renderHeader({ ...baseProject, lifecycleState: 'content_complete' }, { onTransitioned })

    fireEvent.click(screen.getByText('Move to rights cleared'))

    await waitFor(() => expect(mockTransition).toHaveBeenCalledWith('proj-1', 'org-1', 'rights_cleared', undefined, 'admin'))
    await waitFor(() => expect(onTransitioned).toHaveBeenCalled())
  })

  it('surfaces guard blockers verbatim in the UI on a 422 failure', async () => {
    mockTransition.mockResolvedValue({
      ok: false,
      status: 422,
      error: 'Cannot transition to "rights_cleared": rights ledger status is "needs_review"',
      extra: { blockers: ['rights ledger status is "needs_review", must be one of: cleared, owned, licensed, public_domain'] },
    })
    renderHeader({ ...baseProject, lifecycleState: 'content_complete' })

    fireEvent.click(screen.getByText('Move to rights cleared'))

    await waitFor(() => {
      expect(screen.getByText(/Cannot transition to "rights_cleared": rights ledger status is "needs_review"/)).toBeInTheDocument()
    })
    expect(screen.getByText(/rights ledger status is "needs_review", must be one of: cleared, owned, licensed, public_domain/)).toBeInTheDocument()
  })

  it('surfaces a plain error message verbatim when there are no blockers', async () => {
    mockTransition.mockResolvedValue({ ok: false, status: 400, error: 'Cannot transition from "draft" to "live"' })
    renderHeader({ ...baseProject, lifecycleState: 'draft' })

    fireEvent.click(screen.getByText('Move to content complete'))

    await waitFor(() => {
      expect(screen.getByText('Cannot transition from "draft" to "live"')).toBeInTheDocument()
    })
  })

  it('disables transition buttons while a transition is in flight', async () => {
    let resolveFn: (value: unknown) => void = () => {}
    mockTransition.mockReturnValue(new Promise((resolve) => { resolveFn = resolve }))
    renderHeader({ ...baseProject, lifecycleState: 'content_complete' })

    const button = screen.getByText('Move to rights cleared') as HTMLButtonElement
    fireEvent.click(button)

    await waitFor(() => expect(button).toBeDisabled())
    resolveFn({ ok: true, data: { from: 'content_complete', to: 'rights_cleared' } })
    await waitFor(() => expect(button).not.toBeDisabled())
  })

  it('uses the portal surface when specified', async () => {
    mockTransition.mockResolvedValue({ ok: true, data: { from: 'content_complete', to: 'rights_cleared' } })
    renderHeader({ ...baseProject, lifecycleState: 'content_complete' }, { surface: 'portal' })

    fireEvent.click(screen.getByText('Move to rights cleared'))

    await waitFor(() => expect(mockTransition).toHaveBeenCalledWith('proj-1', 'org-1', 'rights_cleared', undefined, 'portal'))
  })
})
