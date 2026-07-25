import { fireEvent, render, screen } from '@testing-library/react'
import { WorkbenchBrowserPanel } from '@/components/messages/workbench/WorkbenchBrowserPanel'
import type { WorkbenchBrowserSessionViewState, WorkbenchTunnelViewState } from '@/lib/messages/workbench/types'

function tunnelState(overrides: Partial<WorkbenchTunnelViewState> = {}): WorkbenchTunnelViewState {
  return {
    sessionId: 'tun-1',
    status: 'running',
    port: 3000,
    publicUrl: 'https://abcd.tunnel.example.com',
    localUrl: 'http://127.0.0.1:3000',
    error: null,
    busy: false,
    ...overrides,
  }
}

function browserSessionState(overrides: Partial<WorkbenchBrowserSessionViewState> = {}): WorkbenchBrowserSessionViewState {
  return {
    sessionId: 'bsess-1',
    status: 'running',
    startUrl: null,
    currentUrl: null,
    latestFrameUrl: null,
    frameCount: 0,
    error: null,
    busy: false,
    ...overrides,
  }
}

describe('WorkbenchBrowserPanel — tunnel strip', () => {
  it("prepares the active tunnel's public URL for the preview iframe", () => {
    render(<WorkbenchBrowserPanel targets={[]} tunnel={tunnelState()} onStartTunnel={jest.fn()} />)

    fireEvent.click(screen.getByTestId('workbench-tunnel-use'))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByTitle('Local app preview')).toHaveAttribute('src', 'https://abcd.tunnel.example.com/')
  })

  it('still blocks a raw localhost URL typed into the main Prepare form, even with an active public tunnel', () => {
    render(<WorkbenchBrowserPanel targets={[]} tunnel={tunnelState()} onStartTunnel={jest.fn()} />)

    fireEvent.change(screen.getByLabelText('Browser target URL'), { target: { value: 'http://localhost:3000' } })
    fireEvent.click(screen.getByText('Prepare', { selector: 'button[type="submit"]' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/private-network targets are blocked/i)
    expect(screen.queryByTitle('Local app preview')).not.toBeInTheDocument()
  })

  it('blocks a raw localhost URL when there is no active tunnel at all', () => {
    render(<WorkbenchBrowserPanel targets={[]} />)

    fireEvent.change(screen.getByLabelText('Browser target URL'), { target: { value: 'http://localhost:3000' } })
    fireEvent.submit(screen.getByLabelText('Browser target URL').closest('form') as HTMLFormElement)

    expect(screen.getByRole('alert')).toHaveTextContent(/private-network targets are blocked/i)
  })

  it('shows the Approve button only while the tunnel is awaiting_approval', () => {
    const onApproveTunnel = jest.fn()
    render(<WorkbenchBrowserPanel targets={[]} tunnel={tunnelState({ status: 'awaiting_approval', publicUrl: null })} onStartTunnel={jest.fn()} onApproveTunnel={onApproveTunnel} />)

    expect(screen.getByTestId('workbench-tunnel-status')).toHaveTextContent('Awaiting approval')
    fireEvent.click(screen.getByTestId('workbench-tunnel-approve'))
    expect(onApproveTunnel).toHaveBeenCalled()
  })

  it('does not render an Approve button once the tunnel is running', () => {
    render(<WorkbenchBrowserPanel targets={[]} tunnel={tunnelState({ status: 'running' })} onStartTunnel={jest.fn()} onApproveTunnel={jest.fn()} />)
    expect(screen.queryByTestId('workbench-tunnel-approve')).not.toBeInTheDocument()
  })

  it('calls onStartTunnel with the entered port', () => {
    const onStartTunnel = jest.fn()
    render(<WorkbenchBrowserPanel targets={[]} onStartTunnel={onStartTunnel} />)

    fireEvent.change(screen.getByLabelText('Tunnel port'), { target: { value: '8080' } })
    fireEvent.click(screen.getByTestId('workbench-tunnel-open'))

    expect(onStartTunnel).toHaveBeenCalledWith(8080)
  })

  it('calls onKillTunnel only when a tunnel is active', () => {
    const onKillTunnel = jest.fn()
    const { rerender } = render(<WorkbenchBrowserPanel targets={[]} tunnel={tunnelState({ status: 'closed', publicUrl: null })} onStartTunnel={jest.fn()} onKillTunnel={onKillTunnel} />)
    expect(screen.getByTestId('workbench-tunnel-kill')).toBeDisabled()

    rerender(<WorkbenchBrowserPanel targets={[]} tunnel={tunnelState({ status: 'running' })} onStartTunnel={jest.fn()} onKillTunnel={onKillTunnel} />)
    fireEvent.click(screen.getByTestId('workbench-tunnel-kill'))
    expect(onKillTunnel).toHaveBeenCalled()
  })

  it('does not render the tunnel strip at all when onStartTunnel is omitted', () => {
    render(<WorkbenchBrowserPanel targets={[]} />)
    expect(screen.queryByTestId('workbench-tunnel-strip')).not.toBeInTheDocument()
  })
})

describe('WorkbenchBrowserPanel — agent browser session strip', () => {
  it('follows the latest frame from browserSession props into the preview', () => {
    const { rerender } = render(
      <WorkbenchBrowserPanel targets={[]} browserSession={browserSessionState({ latestFrameUrl: 'https://cdn.example.com/f1.png', frameCount: 1 })} onStartBrowserSession={jest.fn()} />,
    )

    fireEvent.click(screen.getByTestId('workbench-agent-browser-follow'))
    expect(screen.getByAltText('Agent browser session frame')).toHaveAttribute('src', 'https://cdn.example.com/f1.png')

    rerender(
      <WorkbenchBrowserPanel targets={[]} browserSession={browserSessionState({ latestFrameUrl: 'https://cdn.example.com/f2.png', frameCount: 2 })} onStartBrowserSession={jest.fn()} />,
    )
    expect(screen.getByAltText('Agent browser session frame')).toHaveAttribute('src', 'https://cdn.example.com/f2.png')
    expect(screen.getByTestId('workbench-agent-browser-follow')).toHaveTextContent('Following · 2')
  })

  it('shows the Approve button only while the browser session is awaiting_approval', () => {
    const onApproveBrowserSession = jest.fn()
    render(<WorkbenchBrowserPanel targets={[]} browserSession={browserSessionState({ status: 'awaiting_approval' })} onStartBrowserSession={jest.fn()} onApproveBrowserSession={onApproveBrowserSession} />)

    expect(screen.getByTestId('workbench-agent-browser-status')).toHaveTextContent('Awaiting approval')
    fireEvent.click(screen.getByTestId('workbench-agent-browser-approve'))
    expect(onApproveBrowserSession).toHaveBeenCalled()
  })

  it('does not render an Approve button once the browser session is running', () => {
    render(<WorkbenchBrowserPanel targets={[]} browserSession={browserSessionState({ status: 'running' })} onStartBrowserSession={jest.fn()} onApproveBrowserSession={jest.fn()} />)
    expect(screen.queryByTestId('workbench-agent-browser-approve')).not.toBeInTheDocument()
  })

  it('calls onStartBrowserSession with the entered start URL', () => {
    const onStartBrowserSession = jest.fn()
    render(<WorkbenchBrowserPanel targets={[]} onStartBrowserSession={onStartBrowserSession} />)

    fireEvent.change(screen.getByLabelText('Agent browser start URL'), { target: { value: 'https://example.com' } })
    fireEvent.click(screen.getByTestId('workbench-agent-browser-start'))

    expect(onStartBrowserSession).toHaveBeenCalledWith('https://example.com')
  })

  it('enables Navigate/Capture only while the session is running', () => {
    const onNavigateBrowserSession = jest.fn()
    const onCaptureBrowserSession = jest.fn()
    const { rerender } = render(
      <WorkbenchBrowserPanel
        targets={[]}
        browserSession={browserSessionState({ status: 'queued' })}
        onStartBrowserSession={jest.fn()}
        onNavigateBrowserSession={onNavigateBrowserSession}
        onCaptureBrowserSession={onCaptureBrowserSession}
      />,
    )
    expect(screen.getByTestId('workbench-agent-browser-navigate')).toBeDisabled()
    expect(screen.getByTestId('workbench-agent-browser-capture')).toBeDisabled()

    rerender(
      <WorkbenchBrowserPanel
        targets={[]}
        browserSession={browserSessionState({ status: 'running' })}
        onStartBrowserSession={jest.fn()}
        onNavigateBrowserSession={onNavigateBrowserSession}
        onCaptureBrowserSession={onCaptureBrowserSession}
      />,
    )
    fireEvent.change(screen.getByLabelText('Agent browser navigate URL'), { target: { value: 'https://example.com/next' } })
    fireEvent.click(screen.getByTestId('workbench-agent-browser-navigate'))
    expect(onNavigateBrowserSession).toHaveBeenCalledWith('https://example.com/next')

    fireEvent.click(screen.getByTestId('workbench-agent-browser-capture'))
    expect(onCaptureBrowserSession).toHaveBeenCalled()
  })

  it('does not render the agent browser strip at all when onStartBrowserSession is omitted', () => {
    render(<WorkbenchBrowserPanel targets={[]} />)
    expect(screen.queryByTestId('workbench-agent-browser-strip')).not.toBeInTheDocument()
  })
})

describe('WorkbenchBrowserPanel — Design Mode still works alongside the new strips', () => {
  it('keeps multi-pin Design Mode working on a prepared tunnel frame', () => {
    const onAddToChat = jest.fn()
    render(<WorkbenchBrowserPanel targets={[]} tunnel={tunnelState()} onStartTunnel={jest.fn()} onAddToChat={onAddToChat} />)

    fireEvent.click(screen.getByTestId('workbench-tunnel-use'))
    fireEvent.click(screen.getByLabelText('Enable Design Mode'))

    const canvas = screen.getByLabelText('Design Mode canvas')
    jest.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ width: 200, height: 100, left: 0, top: 0, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => ({}) })
    fireEvent.click(canvas, { clientX: 20, clientY: 10 })

    fireEvent.change(screen.getByLabelText('Design annotation'), { target: { value: 'Move this button' } })
    fireEvent.click(screen.getByLabelText('Add pin'))

    expect(screen.getByTestId('workbench-design-pin-list')).toHaveTextContent('1 pin')
    expect(screen.getByText('Move this button')).toBeInTheDocument()
  })
})
