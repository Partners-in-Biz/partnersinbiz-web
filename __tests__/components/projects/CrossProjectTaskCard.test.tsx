import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { CrossProjectTaskCard } from '@/components/projects/CrossProjectTaskCard'
import type { Task } from '@/components/kanban/types'

jest.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: jest.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
}))
jest.mock('@dnd-kit/utilities', () => ({ CSS: { Transform: { toString: () => '' } } }))

const baseTask: Task = {
  id: 'task-1',
  title: 'Build landing page',
  columnId: 'todo',
  order: 1,
  priority: 'high',
}

describe('CrossProjectTaskCard', () => {
  it('renders the task title', () => {
    render(
      <CrossProjectTaskCard
        task={baseTask}
        projectId="proj-a"
        projectName="Website Revamp"
        onClick={jest.fn()}
      />
    )
    expect(screen.getByText('Build landing page')).toBeInTheDocument()
  })

  it('renders the project badge with the project name', () => {
    render(
      <CrossProjectTaskCard
        task={baseTask}
        projectId="proj-a"
        projectName="Website Revamp"
        onClick={jest.fn()}
      />
    )
    expect(screen.getByText('Website Revamp')).toBeInTheDocument()
  })

  it('project badge links to the project kanban', () => {
    render(
      <CrossProjectTaskCard
        task={baseTask}
        projectId="proj-abc"
        projectName="My Project"
        onClick={jest.fn()}
      />
    )
    const badge = screen.getByText('My Project').closest('a')
    expect(badge).toHaveAttribute('href', '/portal/projects/proj-abc')
  })

  it('uses the scoped project href supplied by the workspace', () => {
    render(
      <CrossProjectTaskCard
        task={baseTask}
        projectId="proj-abc"
        projectName="My Project"
        projectHref="/portal/projects/proj-abc?orgId=lumen-org&orgSlug=lumen-speeds"
        onClick={jest.fn()}
      />,
    )

    const badge = screen.getByText('My Project').closest('a')
    expect(badge).toHaveAttribute('href', '/portal/projects/proj-abc?orgId=lumen-org&orgSlug=lumen-speeds')
  })

  it('calls onClick when the card body is clicked', () => {
    const onClick = jest.fn()
    render(
      <CrossProjectTaskCard
        task={baseTask}
        projectId="proj-a"
        projectName="Website Revamp"
        onClick={onClick}
      />
    )
    fireEvent.click(screen.getByText('Build landing page'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('shows start and end date-times on the task card', () => {
    render(
      <CrossProjectTaskCard
        task={{
          ...baseTask,
          startDate: '2026-05-22T08:15:00.000Z',
          dueDate: '2026-05-22T10:45:00.000Z',
        }}
        projectId="proj-a"
        projectName="Website Revamp"
        onClick={jest.fn()}
      />
    )

    expect(screen.getByText('Start')).toBeInTheDocument()
    expect(screen.getByText('End')).toBeInTheDocument()
    expect(screen.getAllByText(/\d{1,2}:\d{2}/).length).toBeGreaterThanOrEqual(2)
  })
})
