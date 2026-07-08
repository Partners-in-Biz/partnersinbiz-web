import { fireEvent, render, screen } from '@testing-library/react'
import RuntimeInspectorRail from '@/components/messages/hermes/RuntimeInspectorRail'

describe('RuntimeInspectorRail', () => {
  it('renders selected runtime, run status, and live event timeline', () => {
    render(
      <RuntimeInspectorRail
        activeMessage={{
          id: 'msg-1',
          conversationId: 'conv-1',
          role: 'assistant',
          content: '',
          authorKind: 'agent',
          authorId: 'pip',
          authorDisplayName: 'Pip',
          status: 'streaming',
          runId: 'run-1234567890abcdef',
          model: 'openai/gpt-5.5',
          provider: 'openai',
        }}
        events={[{ event: 'tool_call', tool: 'terminal', preview: 'npm test' }]}
        selectedRuntime={{ model: 'openai/gpt-5.5', provider: 'openai' }}
        catalog={null}
      />,
    )

    expect(screen.getByTestId('runtime-inspector-rail')).toBeInTheDocument()
    expect(screen.getByText('openai/gpt-5.5')).toBeInTheDocument()
    expect(screen.getByText('streaming')).toBeInTheDocument()
    expect(screen.getByText('terminal')).toBeInTheDocument()
    expect(screen.getByText('npm test')).toBeInTheDocument()
  })

  it('calls stop for active runs', () => {
    const onStop = jest.fn()
    render(
      <RuntimeInspectorRail
        activeMessage={{
          id: 'msg-1',
          conversationId: 'conv-1',
          role: 'assistant',
          content: '',
          authorKind: 'agent',
          authorId: 'pip',
          authorDisplayName: 'Pip',
          status: 'pending',
          runId: 'run-1',
        }}
        events={[]}
        selectedRuntime={null}
        catalog={null}
        canStop
        onStop={onStop}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Stop run/i }))
    expect(onStop).toHaveBeenCalledTimes(1)
  })
})
