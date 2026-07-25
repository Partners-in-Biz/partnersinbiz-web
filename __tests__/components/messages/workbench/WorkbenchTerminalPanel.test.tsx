import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { WorkbenchTerminalPanel } from '@/components/messages/workbench/WorkbenchTerminalPanel'
import type { WorkbenchSessionViewState, WorkbenchTerminalMode } from '@/lib/messages/workbench/types'

describe('WorkbenchTerminalPanel — Jobs mode', () => {
  it('defaults to Jobs mode and keeps the allowlisted command bar working', () => {
    const onRunCommand = jest.fn()
    render(<WorkbenchTerminalPanel
      entries={[{ id: 'e1', status: 'done', label: 'git status', meta: 'exit 0', body: '$ git status\nclean' }]}
      onRunCommand={onRunCommand}
    />)

    expect(screen.getByTestId('workbench-terminal-mode-jobs')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('$ git status', { exact: false })).toBeInTheDocument()

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

  it('renders the live transcript and status chip for a running session, with input always enabled', () => {
    const session: WorkbenchSessionViewState = {
      sessionId: 'sess-1', status: 'running', transcript: '$ bash\nready>', exitCode: null, error: null, busy: false,
    }
    render(<WorkbenchTerminalPanel entries={[]} mode="session" session={session} onSendSessionInput={jest.fn()} onKillSession={jest.fn()} />)

    expect(screen.getByTestId('workbench-session-status')).toHaveTextContent('Running')
    expect(screen.getByTestId('workbench-session-transcript')).toHaveTextContent('ready>')
    expect(screen.getByLabelText('Session stdin')).toBeEnabled()
    expect(screen.getByTestId('workbench-session-kill')).toBeEnabled()
    // Starting a new session while one is active is disallowed.
    expect(screen.getByTestId('workbench-session-start')).toBeDisabled()
  })

  it('sends a stdin line on Enter/submit and clears the input', () => {
    const onSendSessionInput = jest.fn()
    const session: WorkbenchSessionViewState = {
      sessionId: 'sess-1', status: 'running', transcript: '', exitCode: null, error: null, busy: false,
    }
    render(<WorkbenchTerminalPanel entries={[]} mode="session" session={session} onSendSessionInput={onSendSessionInput} />)

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
