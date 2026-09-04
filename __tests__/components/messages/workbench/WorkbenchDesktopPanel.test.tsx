import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { WorkbenchDesktopPanel } from '@/components/messages/workbench/WorkbenchDesktopPanel'

describe('WorkbenchDesktopPanel — driver hand-off', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { status: 'running', driver: 'user', latestFrameUrl: null } }),
    }) as unknown as typeof fetch
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('shows Take control while the agent drives', () => {
    render(
      <WorkbenchDesktopPanel
        conversationId="conv-a"
        sessionId="desk_a"
        driver="agent"
        hasDesktopWatch
        hasDesktopControl
      />,
    )
    expect(screen.getByTestId('workbench-desktop-take-control')).toHaveTextContent('Take control')
    expect(screen.queryByTestId('workbench-desktop-hand-back')).not.toBeInTheDocument()
  })

  it('shows Hand back while the human drives and posts driver:agent', async () => {
    render(
      <WorkbenchDesktopPanel
        conversationId="conv-a"
        sessionId="desk_a"
        driver="user"
        hasDesktopWatch
        hasDesktopControl
      />,
    )
    expect(screen.getByTestId('workbench-desktop-hand-back')).toHaveTextContent('Hand back')
    fireEvent.click(screen.getByTestId('workbench-desktop-hand-back'))
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/driver'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ driver: 'agent' }),
        }),
      )
    })
  })
})
