import { render, screen } from '@testing-library/react'
import ChatPartsGalleryClient from '@/app/(admin)/admin/system/chat-parts/ChatPartsGalleryClient'
import { CHAT_PART_PREVIEW_FIXTURES } from '@/lib/chat/preview-fixtures'

jest.mock('@/components/chat/MessageBubble', () => ({
  __esModule: true,
  default: function MessageBubbleStub() {
    return <div data-testid="message-bubble-stub" />
  },
}))

describe('ChatPartsGalleryClient', () => {
  it('renders all 6 fixture titles', () => {
    render(<ChatPartsGalleryClient />)

    expect(CHAT_PART_PREVIEW_FIXTURES).toHaveLength(6)
    for (const fixture of CHAT_PART_PREVIEW_FIXTURES) {
      expect(screen.getByRole('heading', { name: fixture.title })).toBeInTheDocument()
    }
  })
})
