import {
  computeConversationMenuPosition,
  CONVERSATION_MENU_ESTIMATED_HEIGHT_PX,
  CONVERSATION_MENU_WIDTH_PX,
} from '@/lib/chat/conversationMenuPosition'

describe('computeConversationMenuPosition', () => {
  const viewport = { width: 1280, height: 800 }

  it('opens below when there is room under the anchor', () => {
    const pos = computeConversationMenuPosition(
      { top: 100, bottom: 120, left: 40, right: 200 },
      viewport,
    )
    expect(pos.placement).toBe('below')
    expect(pos.top).toBe(124)
    expect(pos.left).toBe(200 - CONVERSATION_MENU_WIDTH_PX)
  })

  it('opens above when the row is near the bottom of the screen', () => {
    const pos = computeConversationMenuPosition(
      { top: 740, bottom: 760, left: 40, right: 200 },
      viewport,
    )
    expect(pos.placement).toBe('above')
    expect(pos.top).toBe(740 - CONVERSATION_MENU_ESTIMATED_HEIGHT_PX - 4)
    expect(pos.top + CONVERSATION_MENU_ESTIMATED_HEIGHT_PX).toBeLessThanOrEqual(740)
  })

  it('keeps the menu inside the horizontal viewport', () => {
    const pos = computeConversationMenuPosition(
      { top: 100, bottom: 120, left: 0, right: 40 },
      viewport,
    )
    expect(pos.left).toBe(8)
  })
})
