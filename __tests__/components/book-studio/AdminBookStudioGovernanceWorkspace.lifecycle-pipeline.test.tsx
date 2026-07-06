import { render, screen } from '@testing-library/react'
import { LifecyclePipelineBoard, type LifecyclePipelineProject } from '@/components/book-studio/AdminBookStudioGovernanceWorkspace'

describe('LifecyclePipelineBoard', () => {
  it('renders a column per lifecycle state with correct counts', () => {
    const projects: LifecyclePipelineProject[] = [
      { id: 'p1', title: 'Book One', lifecycleState: 'draft' },
      { id: 'p2', title: 'Book Two', lifecycleState: 'rights_cleared' },
      { id: 'p3', title: 'Book Three' }, // no lifecycleState -> defaults to draft
    ]
    render(<LifecyclePipelineBoard projects={projects} />)

    expect(screen.getByTestId('lifecycle-column-draft')).toHaveTextContent('draft (2)')
    expect(screen.getByTestId('lifecycle-column-rights_cleared')).toHaveTextContent('rights cleared (1)')
    expect(screen.getByTestId('lifecycle-column-live')).toHaveTextContent('live (0)')
    expect(screen.getByText('Book One')).toBeInTheDocument()
    expect(screen.getByText('Book Three')).toBeInTheDocument()
  })

  it('renders all 9 lifecycle columns even with zero projects', () => {
    render(<LifecyclePipelineBoard projects={[]} />)
    ;['draft', 'content_complete', 'rights_cleared', 'assembled', 'qa_approved', 'submission_ready', 'submitted', 'live', 'archived']
      .forEach((state) => expect(screen.getByTestId(`lifecycle-column-${state}`)).toBeInTheDocument())
  })

  it('treats an invalid/unknown lifecycleState value as draft', () => {
    const projects: LifecyclePipelineProject[] = [
      { id: 'p4', title: 'Book Four', lifecycleState: 'not-a-real-state' },
    ]
    render(<LifecyclePipelineBoard projects={projects} />)
    expect(screen.getByTestId('lifecycle-column-draft')).toHaveTextContent('draft (1)')
    expect(screen.getByText('Book Four')).toBeInTheDocument()
  })

  it('falls back to "Untitled book project" when a project has no title', () => {
    const projects: LifecyclePipelineProject[] = [{ id: 'p5', lifecycleState: 'live' }]
    render(<LifecyclePipelineBoard projects={projects} />)
    expect(screen.getByText('Untitled book project')).toBeInTheDocument()
  })
})
