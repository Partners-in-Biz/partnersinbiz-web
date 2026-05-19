import { fireEvent, render, screen } from '@testing-library/react'
import MessageBubble from '@/components/chat/MessageBubble'

describe('MessageBubble', () => {
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
})
