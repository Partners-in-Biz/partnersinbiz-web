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

  it.each([['80'], ['1023'], ['65536'], ['not-a-port'], ['']])('rejects out-of-range port %p inline without calling onStartTunnel', (port) => {
    const onStartTunnel = jest.fn()
    render(<WorkbenchBrowserPanel targets={[]} onStartTunnel={onStartTunnel} />)

    fireEvent.change(screen.getByLabelText('Tunnel port'), { target: { value: port } })
    fireEvent.click(screen.getByTestId('workbench-tunnel-open'))

    expect(onStartTunnel).not.toHaveBeenCalled()
    expect(screen.getByTestId('workbench-tunnel-port-error')).toHaveTextContent(/between 1024 and 65535/i)
  })

  it('clears the port error once the field is edited again', () => {
    const onStartTunnel = jest.fn()
    render(<WorkbenchBrowserPanel targets={[]} onStartTunnel={onStartTunnel} />)

    fireEvent.change(screen.getByLabelText('Tunnel port'), { target: { value: '80' } })
    fireEvent.click(screen.getByTestId('workbench-tunnel-open'))
    expect(screen.getByTestId('workbench-tunnel-port-error')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Tunnel port'), { target: { value: '5173' } })
    expect(screen.queryByTestId('workbench-tunnel-port-error')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('workbench-tunnel-open'))
    expect(onStartTunnel).toHaveBeenCalledWith(5173)
  })

  it('offers the cloudflared install hint when the tunnel error looks like a missing binary', () => {
    render(<WorkbenchBrowserPanel targets={[]} tunnel={tunnelState({ status: 'failed', publicUrl: null, error: 'spawn cloudflared ENOENT' })} onStartTunnel={jest.fn()} />)

    expect(screen.getByTestId('workbench-tunnel-install-hint')).toHaveTextContent('brew install cloudflared')
  })

  it('does not offer the install hint for unrelated tunnel errors', () => {
    render(<WorkbenchBrowserPanel targets={[]} tunnel={tunnelState({ status: 'failed', publicUrl: null, error: 'Tunnel approval expired' })} onStartTunnel={jest.fn()} />)

    expect(screen.queryByTestId('workbench-tunnel-install-hint')).not.toBeInTheDocument()
  })

  it('shows tunnel progress text while the provider starts up', () => {
    render(<WorkbenchBrowserPanel targets={[]} tunnel={tunnelState({ status: 'starting', publicUrl: null, progress: 'Registering tunnel connection…' })} onStartTunnel={jest.fn()} />)

    expect(screen.getByTestId('workbench-tunnel-progress')).toHaveTextContent('Registering tunnel connection…')
  })

  it('explains that the preview iframe needs a public URL while the agent browser can use localhost', () => {
    render(<WorkbenchBrowserPanel targets={[]} onStartTunnel={jest.fn()} />)

    expect(screen.getByText(/Preview iframe needs a public URL \(tunnel\)/i)).toBeInTheDocument()
  })

  it('calls onKillTunnel only when a tunnel is active', () => {
    const onKillTunnel = jest.fn()
    const { rerender } = render(<WorkbenchBrowserPanel targets={[]} tunnel={tunnelState({ status: 'killed', publicUrl: null })} onStartTunnel={jest.fn()} onKillTunnel={onKillTunnel} />)
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

describe('WorkbenchBrowserPanel — follow live frames', () => {
  it('starts device-side following when Follow is enabled and stops it when disabled', () => {
    const onFollowStart = jest.fn()
    const onFollowStop = jest.fn()
    render(
      <WorkbenchBrowserPanel
        targets={[]}
        browserSession={browserSessionState({ latestFrameUrl: 'https://cdn.example.com/f1.png', frameCount: 1 })}
        onStartBrowserSession={jest.fn()}
        onFollowStart={onFollowStart}
        onFollowStop={onFollowStop}
      />,
    )

    fireEvent.click(screen.getByTestId('workbench-agent-browser-follow'))
    expect(onFollowStart).toHaveBeenCalledTimes(1)
    expect(onFollowStop).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('workbench-agent-browser-follow'))
    expect(onFollowStop).toHaveBeenCalledTimes(1)
    expect(onFollowStart).toHaveBeenCalledTimes(1)
  })

  it('can arm following before the first frame has streamed in', () => {
    const onFollowStart = jest.fn()
    render(
      <WorkbenchBrowserPanel
        targets={[]}
        browserSession={browserSessionState({ latestFrameUrl: null, frameCount: 0 })}
        onStartBrowserSession={jest.fn()}
        onFollowStart={onFollowStart}
      />,
    )

    fireEvent.click(screen.getByTestId('workbench-agent-browser-follow'))
    expect(onFollowStart).toHaveBeenCalledTimes(1)
  })

  it('mirrors a host that turns following on itself', () => {
    const onFollowStart = jest.fn()
    const { rerender } = render(
      <WorkbenchBrowserPanel
        targets={[]}
        browserSession={browserSessionState({ latestFrameUrl: 'https://cdn.example.com/f1.png', following: false })}
        onStartBrowserSession={jest.fn()}
        onFollowStart={onFollowStart}
      />,
    )
    expect(screen.getByTestId('workbench-agent-browser-follow')).toHaveTextContent('Follow agent frames')

    rerender(
      <WorkbenchBrowserPanel
        targets={[]}
        browserSession={browserSessionState({ latestFrameUrl: 'https://cdn.example.com/f1.png', frameCount: 3, following: true })}
        onStartBrowserSession={jest.fn()}
        onFollowStart={onFollowStart}
      />,
    )
    expect(screen.getByTestId('workbench-agent-browser-follow')).toHaveTextContent('Following · 3')
    // The host already started following device-side, so the panel must not re-request it.
    expect(onFollowStart).not.toHaveBeenCalled()
  })

  it('labels a followed frame as agent frames rather than a public preview', () => {
    render(
      <WorkbenchBrowserPanel
        targets={[]}
        browserSession={browserSessionState({ latestFrameUrl: 'https://cdn.example.com/f1.png', frameCount: 1 })}
        onStartBrowserSession={jest.fn()}
      />,
    )

    fireEvent.click(screen.getByTestId('workbench-agent-browser-follow'))
    expect(screen.getByTestId('workbench-preview-kind')).toHaveTextContent(/Agent frames/i)
  })

  it('guides an empty panel through tunnel, browser, then follow', () => {
    render(<WorkbenchBrowserPanel targets={[]} onStartTunnel={jest.fn()} onStartBrowserSession={jest.fn()} />)

    const emptyState = screen.getByTestId('workbench-browser-empty-state')
    expect(emptyState).toHaveTextContent('Open tunnel')
    expect(emptyState).toHaveTextContent('Start browser')
    expect(emptyState).toHaveTextContent('Follow frames')
  })
})

describe('WorkbenchBrowserPanel — Design Mode drive', () => {
  function renderDriving(props: Partial<React.ComponentProps<typeof WorkbenchBrowserPanel>> = {}) {
    const result = render(
      <WorkbenchBrowserPanel
        targets={[]}
        browserSession={browserSessionState({ latestFrameUrl: 'https://cdn.example.com/f1.png', frameCount: 1 })}
        onStartBrowserSession={jest.fn()}
        {...props}
      />,
    )
    fireEvent.click(screen.getByTestId('workbench-agent-browser-follow'))
    fireEvent.click(screen.getByLabelText('Enable Design Mode'))
    return result
  }

  function clickCanvasAt(xPct: number, yPct: number) {
    const canvas = screen.getByLabelText('Design Mode canvas')
    jest.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ width: 200, height: 100, left: 0, top: 0, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => ({}) })
    fireEvent.click(canvas, { clientX: (xPct / 100) * 200, clientY: (yPct / 100) * 100 })
  }

  it('drives a real click at the picked point as a percentage of the frame', () => {
    const onClickAt = jest.fn()
    renderDriving({ onClickAt })

    expect(screen.getByTestId('workbench-design-click-here')).toBeDisabled()
    clickCanvasAt(25, 40)
    fireEvent.click(screen.getByTestId('workbench-design-click-here'))

    expect(onClickAt).toHaveBeenCalledWith(25, 40)
  })

  it('types into the agent browser from the selected point', () => {
    const onTypeAt = jest.fn()
    renderDriving({ onClickAt: jest.fn(), onTypeAt })

    clickCanvasAt(50, 50)
    fireEvent.click(screen.getByTestId('workbench-design-type-toggle'))
    fireEvent.change(screen.getByLabelText('Text to type in the agent browser'), { target: { value: 'hello@example.com' } })
    fireEvent.click(screen.getByTestId('workbench-design-type-send'))

    expect(onTypeAt).toHaveBeenCalledWith('hello@example.com')
  })

  it('warns that a point is stale once a newer frame arrives', () => {
    const { rerender } = renderDriving({ onClickAt: jest.fn() })

    clickCanvasAt(30, 30)
    expect(screen.queryByTestId('workbench-design-frame-drift')).not.toBeInTheDocument()

    rerender(
      <WorkbenchBrowserPanel
        targets={[]}
        browserSession={browserSessionState({ latestFrameUrl: 'https://cdn.example.com/f2.png', frameCount: 2 })}
        onStartBrowserSession={jest.fn()}
        onClickAt={jest.fn()}
      />,
    )

    expect(screen.getByTestId('workbench-design-frame-drift')).toBeInTheDocument()
  })

  it('does not offer drive controls for a public preview iframe', () => {
    render(<WorkbenchBrowserPanel targets={[]} tunnel={tunnelState()} onStartTunnel={jest.fn()} onAddToChat={jest.fn()} onClickAt={jest.fn()} />)

    fireEvent.click(screen.getByTestId('workbench-tunnel-use'))
    fireEvent.click(screen.getByLabelText('Enable Design Mode'))

    expect(screen.queryByTestId('workbench-design-drive')).not.toBeInTheDocument()
  })

  it('keeps Add to chat available alongside the drive controls', () => {
    const onAddToChat = jest.fn()
    renderDriving({ onClickAt: jest.fn(), onAddToChat })

    clickCanvasAt(10, 10)
    fireEvent.change(screen.getByLabelText('Design annotation'), { target: { value: 'Tighten this spacing' } })
    fireEvent.click(screen.getByLabelText('Add pin'))
    fireEvent.click(screen.getByLabelText('Add pin 1 to chat'))

    expect(onAddToChat).toHaveBeenCalledWith(expect.stringContaining('Tighten this spacing'))
  })

  it('closes Design Mode on Escape', () => {
    renderDriving({ onClickAt: jest.fn() })
    expect(screen.getByLabelText('Design Mode canvas')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByLabelText('Design Mode canvas')).not.toBeInTheDocument()
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
