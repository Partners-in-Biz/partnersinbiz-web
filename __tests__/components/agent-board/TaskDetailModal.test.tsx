import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TaskDetailModal } from '@/components/agent-board/TaskDetailModal'
import type { AgentTaskCard } from '@/lib/agent-board/types'

const blockedTask: AgentTaskCard = {
  id: 'standalone-blocked',
  source: 'standalone',
  orgId: 'org-1',
  title: 'Runtime audit smoke: qa-release',
  projectId: null,
  projectName: null,
  assigneeAgentId: 'qa-release',
  agentStatus: 'blocked',
  agentInputSpec: 'Reply exactly: RUNTIME_AUDIT_OK qa-release',
  agentOutputSummary: 'Blocked: Waiting on Peet approval. Proof needed: screenshot of approved output. When resolved tell Theo: approved and ready.',
  priority: 'low',
  tags: ['runtime-audit'],
  labels: ['blocked'],
  columnId: 'blocked',
  dependsOn: [],
  dependencyStatuses: {},
  linkedDocumentIds: [],
  linkedDocuments: [],
  updatedAt: '2026-06-01T18:00:00.000Z',
  createdAt: '2026-06-01T17:00:00.000Z',
  href: '/admin/org/partners-in-biz/agent/board?task=standalone-blocked',
}

describe('Agent board TaskDetailModal', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  it('requeues blocked standalone tasks from the agent board detail modal', async () => {
    const onRefresh = jest.fn()
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    }) as jest.Mock

    render(
      <TaskDetailModal
        task={blockedTask}
        onClose={jest.fn()}
        onRefresh={onRefresh}
        slug="partners-in-biz"
      />,
    )

    expect(screen.getAllByText('Needs Peet').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Waiting on Peet approval/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/safe continue path/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Approve / continue safely' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/tasks/standalone-blocked', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ columnId: 'todo' }),
      })
    })
    expect(onRefresh).toHaveBeenCalled()
  })

  it('formats blocked standalone output with a plain-language summary and readable details', () => {
    render(
      <TaskDetailModal
        task={{
          ...blockedTask,
          agentOutputSummary: 'Blocked: Site: partnersinbiz.online. Task id: jOPA3L2acx3GvY6Vyllb. Issue: Peet cannot read the mobile blocker note because it is one dense paragraph. Verification: screenshot IMG_3286.png shows the problem. How to fix: split the note into summary and technical details. Proof needed: mobile screenshot. After resolved: tell Theo mobile blocker notes are readable.',
        }}
        onClose={jest.fn()}
        onRefresh={jest.fn()}
        slug="partners-in-biz"
      />,
    )

    const summary = screen.getByText('What this means')
    const technical = screen.getByText('Technical details')
    expect(summary.compareDocumentPosition(technical) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getAllByText(/Peet cannot read the mobile blocker note/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Proof needed/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/mobile screenshot/i).length).toBeGreaterThan(0)
  })
})
