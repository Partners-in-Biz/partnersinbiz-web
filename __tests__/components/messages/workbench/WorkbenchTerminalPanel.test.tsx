import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { WorkbenchTerminalPanel } from '@/components/messages/workbench/WorkbenchTerminalPanel'
import type { WorkbenchSessionViewState, WorkbenchTerminalMode } from '@/lib/messages/workbench/types'

/**
 * The real emulator is covered by WorkbenchXterm.test.tsx; here it is stubbed
 * so these tests can assert wiring (which props the panel hands down, and that
 * the xterm surface replaces the plain transcript dump) without a canvas.
 */
jest.mock('@/components/messages/workbench/WorkbenchXterm', () => ({
  WorkbenchXterm: ({ output, onData, onResize, disabled }: {
    output: string
    onData?: (data: string) => void
    onResize?: (cols: number, rows: number) => void
    disabled?: boolean
  }) => (
    <div data-testid="workbench-xterm" data-disabled={String(Boolean(disabled))}>
      <span data-testid="workbench-xterm-output">{output}</span>
      <button type="button" data-testid="workbench-xterm-emit-data" onClick={() => onData?.('\u0003')}>data</button>
      <button type="button" data-testid="workbench-xterm-emit-resize" onClick={() => onResize?.(80, 24)}>resize</button>
    </div>
  ),
}))

function sessionState(overrides: Partial<WorkbenchSessionViewState> = {}): WorkbenchSessionViewState {
  return {
    sessionId: 'sess-1', status: 'running', transcript: '', exitCode: null, error: null, busy: false, ...overrides,
  }
}

describe('WorkbenchTerminalPanel — Jobs mode', () => {
  it('defaults to Jobs mode and keeps the allowlisted command bar working', () => {
    const onRunCommand = jest.fn()
    render(<WorkbenchTerminalPanel
      entries={[{ id: 'e1', status: 'done', label: 'git status', meta: 'exit 0', body: '$ git status\nclean' }]}
      onRunCommand={onRunCommand}
    />)

    expect(screen.getByTestId('workbench-terminal-mode-jobs')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('$ git status', { exact: false })).toBeInTheDocument()
    expect(screen.getByTestId('workbench-terminal-entry')).toHaveClass('pib-terminal-block')

    fireEvent.click(screen.getByTestId('workbench-terminal-quick-command-git-status'))
    expect(onRunCommand).toHaveBeenCalledWith('git status')
  })

  it('renders the empty state with the mode tabs still visible', () => {
    render(<WorkbenchTerminalPanel entries={[]} />)
    expect(screen.getByTestId('workbench-terminal-mode-jobs')).toBeInTheDocument()
    expect(screen.getByTestId('workbench-terminal-mode-session')).toBeInTheDocument()
    expect(screen.getByText('No terminal activity yet')).toBeInTheDocument()
  })

  it('switches to Session mode via the mode tab and calls onModeChange', () => {
    const onModeChange = jest.fn()
    render(<WorkbenchTerminalPanel entries={[]} onModeChange={onModeChange} />)

    fireEvent.click(screen.getByTestId('workbench-terminal-mode-session'))

    expect(onModeChange).toHaveBeenCalledWith('session')
    expect(screen.getByTestId('workbench-session-view')).toBeInTheDocument()
    expect(screen.queryByText('No terminal activity yet')).not.toBeInTheDocument()
  })
})

describe('WorkbenchTerminalPanel — Session mode', () => {
  it('shows the "not started" state and calls onStartSession when Start is clicked', () => {
    const onStartSession = jest.fn()
    render(<WorkbenchTerminalPanel entries={[]} mode="session" session={null} onStartSession={onStartSession} />)

    expect(screen.getByTestId('workbench-session-status')).toHaveTextContent('Not started')
    expect(screen.getByLabelText('Session stdin')).toBeDisabled()
    expect(screen.getByTestId('workbench-session-kill')).toBeDisabled()

    fireEvent.click(screen.getByTestId('workbench-session-start'))

    expect(onStartSession).toHaveBeenCalledWith()
  })

  it('renders the live transcript in the xterm surface for a running session, with input always enabled', () => {
    const session = sessionState({ transcript: '$ bash\nready>' })
    render(<WorkbenchTerminalPanel entries={[]} mode="session" session={session} onSendSessionInput={jest.fn()} onKillSession={jest.fn()} />)

    expect(screen.getByTestId('workbench-session-status')).toHaveTextContent('Running')
    expect(screen.getByTestId('workbench-xterm-output')).toHaveTextContent('ready>')
    // The xterm surface owns the transcript once a pty exists — no plain dump alongside it.
    expect(screen.queryByTestId('workbench-session-transcript')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Session stdin')).toBeEnabled()
    expect(screen.getByTestId('workbench-session-kill')).toBeEnabled()
    // Starting a new session while one is active is disallowed.
    expect(screen.getByTestId('workbench-session-start')).toBeDisabled()
  })

  it('sends a stdin line on Enter/submit and clears the input', () => {
    const onSendSessionInput = jest.fn()
    render(<WorkbenchTerminalPanel entries={[]} mode="session" session={sessionState()} onSendSessionInput={onSendSessionInput} />)

    const input = screen.getByLabelText('Session stdin')
    fireEvent.change(input, { target: { value: 'echo hi' } })
    fireEvent.submit(input.closest('form') as HTMLFormElement)

    expect(onSendSessionInput).toHaveBeenCalledWith('echo hi')
    expect(input).toHaveValue('')
  })

  it('calls onKillSession when Kill is clicked on an active session', () => {
    const onKillSession = jest.fn()
    const session: WorkbenchSessionViewState = {
      sessionId: 'sess-1', status: 'queued', transcript: '', exitCode: null, error: null, busy: false,
    }
    render(<WorkbenchTerminalPanel entries={[]} mode="session" session={session} onKillSession={onKillSession} />)

    fireEvent.click(screen.getByTestId('workbench-session-kill'))
    expect(onKillSession).toHaveBeenCalled()
  })

  it('disables stdin and Kill, and re-enables Start, once the session has exited', () => {
    const session: WorkbenchSessionViewState = {
      sessionId: 'sess-1', status: 'exited', transcript: '$ bash\nbye', exitCode: 0, error: null, busy: false,
    }
    render(<WorkbenchTerminalPanel entries={[]} mode="session" session={session} onStartSession={jest.fn()} onSendSessionInput={jest.fn()} onKillSession={jest.fn()} />)

    expect(screen.getByTestId('workbench-session-status')).toHaveTextContent('Exited')
    expect(screen.getByText('exit 0')).toBeInTheDocument()
    expect(screen.getByLabelText('Session stdin')).toBeDisabled()
    expect(screen.getByTestId('workbench-session-kill')).toBeDisabled()
    expect(screen.getByTestId('workbench-session-start')).toBeEnabled()
  })

  it('renders a client-side error banner without crashing when the session API fails', () => {
    const session: WorkbenchSessionViewState = {
      sessionId: null, status: 'error', transcript: '', exitCode: null, error: 'Workbench session request failed (404)', busy: false,
    }
    render(<WorkbenchTerminalPanel entries={[]} mode="session" session={session} onStartSession={jest.fn()} />)

    expect(screen.getByRole('alert')).toHaveTextContent('Workbench session request failed (404)')
    expect(screen.getByTestId('workbench-session-status')).toHaveTextContent('Error')
    // Recovery is still possible — Start remains available.
    expect(screen.getByTestId('workbench-session-start')).toBeEnabled()
  })

  it('is fully usable with no session callbacks wired up yet (graceful degradation)', () => {
    render(<WorkbenchTerminalPanel entries={[]} mode="session" />)
    expect(screen.getByTestId('workbench-session-status')).toHaveTextContent('Not started')
    expect(screen.getByTestId('workbench-session-start')).toBeDisabled()
    expect(screen.getByTestId('workbench-session-kill')).toBeDisabled()
    expect(screen.getByLabelText('Session stdin')).toBeDisabled()
  })
})

describe('WorkbenchTerminalPanel — session approval', () => {
  it('shows Approve plus a consent notice while the session is awaiting approval, and no pty surface yet', () => {
    const onApproveSession = jest.fn()
    render(<WorkbenchTerminalPanel
      entries={[]}
      mode="session"
      session={sessionState({ status: 'awaiting_approval' })}
      onApproveSession={onApproveSession}
      onKillSession={jest.fn()}
      onStartSession={jest.fn()}
    />)

    expect(screen.getByTestId('workbench-session-status')).toHaveTextContent('Awaiting approval')
    expect(screen.getByTestId('workbench-session-approval-notice')).toHaveTextContent('unrestricted shell')
    expect(screen.queryByTestId('workbench-xterm')).not.toBeInTheDocument()
    // A session awaiting approval is already active, so Start is blocked but Kill is offered.
    expect(screen.getByTestId('workbench-session-start')).toBeDisabled()
    expect(screen.getByTestId('workbench-session-kill')).toBeEnabled()
    expect(screen.getByLabelText('Session stdin')).toBeDisabled()

    fireEvent.click(screen.getByTestId('workbench-session-approve'))
    expect(onApproveSession).toHaveBeenCalled()
  })

  it('exposes accessible names for the Approve and Kill controls', () => {
    render(<WorkbenchTerminalPanel
      entries={[]}
      mode="session"
      session={sessionState({ status: 'awaiting_approval' })}
      onApproveSession={jest.fn()}
      onKillSession={jest.fn()}
    />)

    expect(screen.getByRole('button', { name: 'Approve full shell session' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Kill shell session' })).toBeEnabled()
  })

  it('disables Approve while an approval request is already in flight', () => {
    render(<WorkbenchTerminalPanel
      entries={[]}
      mode="session"
      session={sessionState({ status: 'awaiting_approval', busy: true })}
      onApproveSession={jest.fn()}
    />)

    expect(screen.getByTestId('workbench-session-approve')).toBeDisabled()
  })

  it('hides Approve once the session has been approved and queued', () => {
    render(<WorkbenchTerminalPanel entries={[]} mode="session" session={sessionState({ status: 'queued' })} onApproveSession={jest.fn()} />)

    expect(screen.getByTestId('workbench-session-status')).toHaveTextContent('Queued')
    expect(screen.queryByTestId('workbench-session-approve')).not.toBeInTheDocument()
    expect(screen.queryByTestId('workbench-session-approval-notice')).not.toBeInTheDocument()
  })
})

describe('WorkbenchTerminalPanel — xterm wiring', () => {
  it('forwards raw keystrokes and fitted grid sizes from the emulator to the host', () => {
    const onSendSessionData = jest.fn()
    const onResizeSession = jest.fn()
    render(<WorkbenchTerminalPanel
      entries={[]}
      mode="session"
      session={sessionState()}
      onSendSessionData={onSendSessionData}
      onResizeSession={onResizeSession}
    />)

    fireEvent.click(screen.getByTestId('workbench-xterm-emit-data'))
    fireEvent.click(screen.getByTestId('workbench-xterm-emit-resize'))

    expect(onSendSessionData).toHaveBeenCalledWith('\u0003')
    expect(onResizeSession).toHaveBeenCalledWith(80, 24)
  })

  it('keeps the final screen readable after exit, with keyboard input disabled', () => {
    render(<WorkbenchTerminalPanel
      entries={[]}
      mode="session"
      session={sessionState({ status: 'exited', transcript: 'bye\n', exitCode: 0 })}
      onSendSessionData={jest.fn()}
    />)

    expect(screen.getByTestId('workbench-xterm-output')).toHaveTextContent('bye')
    expect(screen.getByTestId('workbench-xterm')).toHaveAttribute('data-disabled', 'true')
  })

  it('leaves the emulator enabled for a running session with a raw-stdin handler', () => {
    render(<WorkbenchTerminalPanel entries={[]} mode="session" session={sessionState()} onSendSessionData={jest.fn()} />)
    expect(screen.getByTestId('workbench-xterm')).toHaveAttribute('data-disabled', 'false')
  })

  it('adds an install hint when the failure is a missing node-pty on the linked computer', () => {
    render(<WorkbenchTerminalPanel
      entries={[]}
      mode="session"
      session={sessionState({ sessionId: null, status: 'error', error: "Cannot find module 'node-pty'" })}
      onStartSession={jest.fn()}
    />)

    expect(screen.getByRole('alert')).toHaveTextContent("Cannot find module 'node-pty'")
    expect(screen.getByTestId('workbench-session-node-pty-hint')).toHaveTextContent('npm install node-pty')
  })

  it('recognises the runtime’s own optional-dependency wording', () => {
    render(<WorkbenchTerminalPanel
      entries={[]}
      mode="session"
      session={sessionState({
        status: 'failed',
        error: 'interactive workbench sessions require the optional "node-pty" dependency, which is not installed in this runtime build.',
      })}
    />)

    expect(screen.getByTestId('workbench-session-node-pty-hint')).toBeInTheDocument()
  })

  it('does not add the node-pty hint to unrelated failures', () => {
    render(<WorkbenchTerminalPanel
      entries={[]}
      mode="session"
      session={sessionState({ sessionId: null, status: 'error', error: 'Linked computer is offline' })}
      onStartSession={jest.fn()}
    />)

    expect(screen.queryByTestId('workbench-session-node-pty-hint')).not.toBeInTheDocument()
  })
})

describe('WorkbenchTerminalPanel — mode labels', () => {
  it('labels Jobs as safe one-shots and Session as an approval-gated full shell', () => {
    render(<WorkbenchTerminalPanel entries={[]} onRunCommand={jest.fn()} />)

    expect(screen.getByTestId('workbench-terminal-mode-jobs')).toHaveTextContent('Safe one-shots')
    expect(screen.getByTestId('workbench-terminal-mode-session')).toHaveTextContent('Full shell (approval required)')
  })
})

describe('WorkbenchTerminalPanel — controlled mode', () => {
  function Harness() {
    const [mode, setMode] = useState<WorkbenchTerminalMode>('jobs')
    return <WorkbenchTerminalPanel entries={[]} mode={mode} onModeChange={setMode} onRunCommand={jest.fn()} />
  }

  it('reflects externally-controlled mode changes', () => {
    render(<Harness />)
    expect(screen.getByTestId('workbench-terminal-mode-jobs')).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByTestId('workbench-terminal-mode-session'))
    expect(screen.getByTestId('workbench-terminal-mode-session')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('workbench-session-view')).toBeInTheDocument()
  })
})
