import { fireEvent, render, screen } from '@testing-library/react'
import {
  ContextDock,
  nextContextItemExpandLevel,
} from '@/components/chat/context/ContextDock'
import type { ChatContextReadModel } from '@/lib/chat-context/types'

describe('nextContextItemExpandLevel', () => {
  it('cycles collapsed → summary → full → collapsed when both levels exist', () => {
    expect(nextContextItemExpandLevel('collapsed', { canSummary: true, canFull: true })).toBe('summary')
    expect(nextContextItemExpandLevel('summary', { canSummary: true, canFull: true })).toBe('full')
    expect(nextContextItemExpandLevel('full', { canSummary: true, canFull: true })).toBe('collapsed')
  })

  it('skips missing intermediate levels', () => {
    expect(nextContextItemExpandLevel('collapsed', { canSummary: false, canFull: true })).toBe('full')
    expect(nextContextItemExpandLevel('summary', { canSummary: true, canFull: false })).toBe('collapsed')
  })
})

const projectModel: ChatContextReadModel = {
  context: {
    kind: 'project',
    id: 'project-1',
    orgId: 'org-1',
    label: 'Finance foundation',
    icon: 'account_tree',
    href: '/portal/projects/project-1',
  },
  pulse: {
    label: '1 of 2 complete',
    progress: { complete: 1, total: 2 },
    metrics: [],
  },
  groups: [{
    id: 'tasks',
    label: 'Tasks',
    items: [{
      id: 'task-ledger',
      label: 'Build multi-entity books, double-entry ledger, periods, and audit foundation',
      state: 'complete',
      detail: 'Fresh verification for lib/accounting/firestore-foundation-repository.ts is green.',
      agent: {
        agentId: 'pip',
        agentStatus: 'done',
        summary: 'Fresh verification for lib/accounting/firestore-foundation-repository.ts is green. Results - npm run test:finance:unit — 6 suites / 65 tests PASS.',
      },
      updatedAt: '2026-08-02T09:09:00.000Z',
    }],
  }],
  artifacts: [],
  attention: [],
  activity: [],
  capabilities: ['view'],
  asOf: '2026-08-02T10:00:00.000Z',
}

describe('ContextDock three-step task cards', () => {
  it('defaults to title + status, then summary, then full agent feed', () => {
    render(
      <ContextDock
        model={projectModel}
        open
        onClose={() => undefined}
      />,
    )

    const card = screen.getByTestId('context-group-item-task-ledger')
    expect(card).toHaveAttribute('data-expand-level', 'collapsed')
    expect(card).toHaveTextContent('Build multi-entity books')
    expect(card).toHaveTextContent('Complete')
    expect(screen.queryByTestId('project-task-feed-task-ledger')).not.toBeInTheDocument()
    // Collapsed: no summary body yet
    expect(card.textContent).not.toContain('Fresh verification for lib/accounting')

    fireEvent.click(screen.getByRole('button', {
      name: 'Show summary for Build multi-entity books, double-entry ledger, periods, and audit foundation',
    }))
    expect(card).toHaveAttribute('data-expand-level', 'summary')
    expect(card).toHaveTextContent('Fresh verification for lib/accounting')
    expect(screen.queryByTestId('project-task-feed-task-ledger')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', {
      name: 'Show full activity for Build multi-entity books, double-entry ledger, periods, and audit foundation',
    }))
    expect(card).toHaveAttribute('data-expand-level', 'full')
    expect(screen.getByTestId('project-task-feed-task-ledger')).toBeInTheDocument()
    expect(screen.getByTestId('project-task-feed-task-ledger')).toHaveTextContent('What the agent did')

    fireEvent.click(screen.getByRole('button', {
      name: 'Collapse Build multi-entity books, double-entry ledger, periods, and audit foundation',
    }))
    expect(card).toHaveAttribute('data-expand-level', 'collapsed')
    expect(screen.queryByTestId('project-task-feed-task-ledger')).not.toBeInTheDocument()
  })
})
