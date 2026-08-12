import { fireEvent, render, screen } from '@testing-library/react'
import { CockpitShell } from '@/components/briefing/cockpit/CockpitShell'
import { DockedChat } from '@/components/briefing/cockpit/DockedChat'

const unifiedChatProps = jest.fn()
jest.mock('@/components/chat/UnifiedChat', () => ({
  __esModule: true,
  default: (props: { onContextActionResolved?: () => void }) => {
    unifiedChatProps(props)
    return <button type="button" onClick={props.onContextActionResolved}>Resolve context action</button>
  },
}))

describe('Briefings living Context Dock integration', () => {
  beforeEach(() => unifiedChatProps.mockClear())

  it('keeps chat permission-gated when there is no authenticated user', () => {
    render(<DockedChat orgId="org-1" currentUserUid="" currentUserDisplayName="" />)
    expect(screen.getByText('Sign in to chat with Pip.')).toBeInTheDocument()
    expect(unifiedChatProps).not.toHaveBeenCalled()
  })

  it('uses compact exact-context chat and refreshes Briefings after a resolved Dock action', () => {
    const onRefresh = jest.fn()
    render(<CockpitShell mode="portal" orgId="org-1" currentUser={{ uid: 'user-1', displayName: 'Ava' }} itemCount={1} onRefresh={onRefresh} selectedContextSeed={{ type: 'studio', id: 'youtube_studio:org-1', orgId: 'org-1', label: 'YouTube Studio' }} workFeedContent={<div>Attention feed</div>} />)
    expect(screen.getByText('Attention feed')).toBeInTheDocument()
    const shell = screen.getByTestId('briefings-room-shell')
    expect(shell).toHaveAttribute('data-briefings-experience', 'quiet-2026')
    expect(screen.getByTestId('briefings-shell-topbar')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open Pip briefing assistant' }))
    expect(unifiedChatProps).toHaveBeenCalledWith(expect.objectContaining({
      compact: true,
      preferCurrentPageContext: true,
      currentPageContext: expect.objectContaining({ type: 'studio', id: 'youtube_studio:org-1', orgId: 'org-1' }),
      allowStartConversations: true,
      allowSendMessages: true,
    }))
    fireEvent.click(screen.getByRole('button', { name: 'Resolve context action' }))
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })
})
