import { fireEvent, render, screen } from '@testing-library/react'
import { ConversationOverflowSheet } from '@/components/messages/ConversationOverflowSheet'

const computers = [
  { id: 'vps', label: 'hermes-vps-01', kind: 'vps' as const, online: true, availableAgentIds: ['theo'] },
]

describe('ConversationOverflowSheet', () => {
  it('does not render when closed', () => {
    render(<ConversationOverflowSheet open={false} onClose={jest.fn()} title="Hunt & Gun" />)
    expect(screen.queryByTestId('conversation-overflow-sheet')).not.toBeInTheDocument()
  })

  it('reaches computers, command session, workbench, inspect, files, terminal, browser, model, effort, and approvals', () => {
    const onClose = jest.fn()
    const onBindCommandSession = jest.fn()
    const onOpenWorkbench = jest.fn()
    const onToggleWorkbench = jest.fn()
    const onOpenInspect = jest.fn()

    render(
      <ConversationOverflowSheet
        open
        onClose={onClose}
        title="Hunt & Gun"
        subtitle="Partners in Biz · Default"
        connectionWhere={{ display: 'VPS · hermes-vps-01', online: true }}
        canBindCommandSession
        onBindCommandSession={onBindCommandSession}
        computers={computers}
        computersHref="/portal/settings/linked-computers"
        showAgentWorkbench
        showInspect
        onOpenWorkbench={onOpenWorkbench}
        onToggleWorkbench={onToggleWorkbench}
        onOpenInspect={onOpenInspect}
        modelControl={<button type="button">Auto · claude-fable-5</button>}
        effortControl={<label>Auto effort<select aria-label="Runtime thinking effort"><option>Auto effort</option></select></label>}
        approvalControl={<label>Ask approvals<select aria-label="Approval mode"><option>Ask approvals</option></select></label>}
        runtimeStatus="completed"
        queuedCount={0}
      />,
    )

    expect(screen.getByTestId('conversation-overflow-sheet')).toBeInTheDocument()
    expect(screen.getByTestId('bot-computer-strip')).toHaveTextContent('VPS · hermes-vps-01')
    expect(screen.getByTestId('overflow-bind-command-session')).toBeInTheDocument()
    expect(screen.getByTestId('overflow-workbench')).toBeInTheDocument()
    expect(screen.getByTestId('overflow-inspect')).toBeInTheDocument()
    expect(screen.getByTestId('overflow-workbench-files')).toBeInTheDocument()
    expect(screen.getByTestId('overflow-workbench-terminal')).toBeInTheDocument()
    expect(screen.getByTestId('overflow-workbench-browser')).toBeInTheDocument()
    expect(screen.getByText('Auto · claude-fable-5')).toBeInTheDocument()
    expect(screen.getByLabelText('Runtime thinking effort')).toBeInTheDocument()
    expect(screen.getByLabelText('Approval mode')).toBeInTheDocument()
    expect(screen.getByTestId('conversation-overflow-runtime')).toHaveTextContent('completed')
    expect(screen.getByTestId('conversation-overflow-runtime')).toHaveTextContent('0 queued')

    fireEvent.click(screen.getByTestId('overflow-workbench-terminal'))
    expect(onOpenWorkbench).toHaveBeenCalledWith('terminal')
    expect(onClose).toHaveBeenCalled()
  })
})
