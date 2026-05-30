import { fireEvent, render, screen } from '@testing-library/react'
import MessageBubble from '@/components/chat/MessageBubble'

function closestMessageGroup(element: Element): HTMLElement | null {
  let node: Element | null = element
  while (node) {
    if (node instanceof HTMLElement && node.className.includes('group/message')) return node
    node = node.parentElement
  }
  return null
}

describe('MessageBubble', () => {
  it('keeps long mobile chat text inside the viewport instead of forcing horizontal scroll', () => {
    const longToken = 'https://example.com/' + 'unbroken-mobile-overflow-token-'.repeat(12)

    render(
      <MessageBubble
        currentUserUid="user-1"
        message={{
          id: 'msg-1',
          conversationId: 'conv-1',
          role: 'assistant',
          content: longToken,
          authorKind: 'agent',
          authorId: 'pip',
          authorDisplayName: 'Pip',
          status: 'completed',
        }}
      />,
    )

    const messageText = screen.getByText(longToken)
    expect(messageText).toHaveClass('max-w-full', 'overflow-hidden', 'break-words', '[overflow-wrap:anywhere]')
    expect(closestMessageGroup(messageText)).toHaveClass('min-w-0')
  })

  it('keeps the user bubble clamped for long pasted mobile text', () => {
    const longToken = 'Attachment:' + 'VeryLongScreenshotFilenameWithoutNaturalBreaks'.repeat(8)

    render(
      <MessageBubble
        currentUserUid="user-1"
        message={{
          id: 'msg-1',
          conversationId: 'conv-1',
          role: 'user',
          content: longToken,
          authorKind: 'user',
          authorId: 'user-1',
          authorDisplayName: 'Peet',
          status: 'completed',
        }}
      />,
    )

    const messageText = screen.getByText(longToken)
    expect(messageText).toHaveClass('max-w-full', 'overflow-hidden', 'break-words', '[overflow-wrap:anywhere]')
    expect(closestMessageGroup(messageText)).toHaveClass('min-w-0')
  })

  it('renders image attachments as clickable previews', () => {
    render(
      <MessageBubble
        currentUserUid="user-1"
        message={{
          id: 'msg-1',
          conversationId: 'conv-1',
          role: 'user',
          content: 'image',
          authorKind: 'user',
          authorId: 'user-1',
          authorDisplayName: 'Peet',
          status: 'completed',
          attachments: [
            {
              id: 'att-1',
              name: 'Screenshot 2026-05-19.png',
              url: 'https://cdn.example.com/screenshot.png',
              contentType: 'image/png',
              sizeBytes: 287436,
            },
          ],
        }}
      />,
    )

    const preview = screen.getByRole('button', { name: /open Screenshot 2026-05-19\.png/i })
    expect(preview).toBeInTheDocument()
    expect(screen.getByAltText('Screenshot 2026-05-19.png')).toHaveAttribute('src', 'https://cdn.example.com/screenshot.png')

    fireEvent.click(preview)

    expect(screen.getByRole('dialog', { name: /Screenshot 2026-05-19\.png/i })).toBeInTheDocument()
    expect(screen.getAllByRole('img', { name: 'Screenshot 2026-05-19.png' }).at(-1)).toHaveAttribute('src', 'https://cdn.example.com/screenshot.png')
  })

  it('shows a full inline command console for agent tool events', () => {
    render(
      <MessageBubble
        currentUserUid="user-1"
        message={{
          id: 'msg-1',
          conversationId: 'conv-1',
          role: 'assistant',
          content: 'Done.',
          authorKind: 'agent',
          authorId: 'pip',
          authorDisplayName: 'Pip',
          status: 'completed',
          events: [
            {
              event: 'tool.started',
              tool: 'terminal',
              input: 'npm test -- --runInBand',
              timestamp: 1_770_000_000,
            },
            {
              event: 'tool.completed',
              tool: 'terminal',
              input: 'npm test -- --runInBand',
              stdout: 'PASS __tests__/components/chat/MessageBubble.test.tsx',
              exitCode: 0,
              durationMs: 842,
              timestamp: 1_770_000_002,
            },
          ],
        }}
      />,
    )

    expect(screen.getByText('Inline command console')).toBeInTheDocument()
    expect(screen.getAllByText('terminal').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText((content) => content.includes('$ npm test -- --runInBand')).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText((content) => content.includes('PASS __tests__/components/chat/MessageBubble.test.tsx'))).toBeInTheDocument()
    expect(screen.getByText(/exit 0/)).toBeInTheDocument()
  })
})
