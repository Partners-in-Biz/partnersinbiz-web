import { fireEvent, render, screen } from '@testing-library/react'
import AgentWorkbenchRail from '@/components/messages/workbench/AgentWorkbenchRail'
import type { ChatEvent } from '@/lib/hermes/types'

const events: ChatEvent[] = [
  { event: 'tool.started', tool: 'terminal', input: 'npm test', timestamp: 100 },
  { event: 'tool.completed', tool: 'terminal', input: 'npm test', stdout: 'PASS workbench', exitCode: 0, timestamp: 101 },
  {
    event: 'tool.completed',
    tool: 'patch',
    input: '*** Begin Patch\n*** Update File: components/chat/UnifiedChat.tsx\n@@\n-old\n+new\n*** End Patch',
    timestamp: 102,
  },
]

describe('AgentWorkbenchRail', () => {
  beforeEach(() => window.localStorage.clear())

  it('offers four observer tabs and renders live terminal and changes data', () => {
    render(
      <AgentWorkbenchRail
        conversationId="conv-1"
        events={events}
        runtime={{ kind: 'linked-computer', label: 'Peet Mac', mappingId: 'map-1', mappedRootLabel: 'Partners in Biz' }}
      />,
    )

    expect(screen.getByRole('button', { name: 'Open Files workbench' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open Terminal workbench' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open Browser workbench' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open Changes workbench' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open Terminal workbench' }))
    expect(screen.getByRole('dialog', { name: 'Agent Workbench' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Terminal/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('$ npm test')).toBeInTheDocument()
    expect(screen.getByText('PASS workbench')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /Changes/ }))
    expect(screen.getByText('components/chat/UnifiedChat.tsx')).toBeInTheDocument()
    expect(screen.getByText('modified')).toBeInTheDocument()
  })

  it('explains the runtime binding requirement when no workspace is connected', () => {
    render(
      <AgentWorkbenchRail
        conversationId="conv-unbound"
        events={[]}
        runtime={{ kind: 'none', label: 'No runtime' }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open Files workbench' }))
    expect(screen.getByText(/Link a computer or choose a workspace folder/i)).toBeInTheDocument()
  })
})
