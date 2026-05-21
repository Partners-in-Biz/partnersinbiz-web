import { fireEvent, render, screen } from '@testing-library/react'
import { MessageDrawer } from '@/components/chat/MessageDrawer'

jest.mock('@/components/chat/UnifiedChat', () => ({
  __esModule: true,
  default: () => <div data-testid="unified-chat" />,
}))

describe('MessageDrawer', () => {
  beforeEach(() => {
    window.matchMedia = jest.fn().mockImplementation((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }))
  })

  it('portals the fixed drawer outside topbar containing blocks', () => {
    render(
      <div data-testid="push-root" data-message-push-root>
        <div data-testid="topbar" style={{ backdropFilter: 'blur(8px)' }}>
          <MessageDrawer
            orgId="org_1"
            orgName="Acme"
            currentUserUid="user_1"
            currentUserDisplayName="Peet"
          />
        </div>
      </div>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open messages' }))

    const drawer = screen.getByTestId('unified-chat').closest('.fixed')

    expect(drawer).toBeTruthy()
    expect(drawer?.parentElement).toBe(document.body)
    expect(screen.getByTestId('topbar')).not.toContainElement(drawer as HTMLElement)
    expect(screen.getByTestId('push-root')).toHaveStyle({
      marginRight: 'clamp(420px, 34vw, 560px)',
    })
  })

  it('notifies the shell when messages are opened so other navigation can close', () => {
    const handleOpen = jest.fn()

    render(
      <MessageDrawer
        orgId="org_1"
        orgName="Acme"
        currentUserUid="user_1"
        currentUserDisplayName="Peet"
        onOpen={handleOpen}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open messages' }))

    expect(handleOpen).toHaveBeenCalledTimes(1)
  })
})
