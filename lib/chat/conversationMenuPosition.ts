/**
 * Fixed-position conversation “⋯” menus must stay fully on-screen.
 * When the row is low on the viewport, open upward so Archive/Delete remain reachable.
 */

export const CONVERSATION_MENU_WIDTH_PX = 176
/** Covers open/export/pin/rename/access/archive/delete with mobile min-h-11 rows. */
export const CONVERSATION_MENU_ESTIMATED_HEIGHT_PX = 320

export type ConversationMenuPosition = {
  top: number
  left: number
  placement: 'above' | 'below'
}

export function computeConversationMenuPosition(
  anchor: Pick<DOMRect, 'top' | 'bottom' | 'left' | 'right'>,
  viewport: { width: number; height: number } = {
    width: typeof window !== 'undefined' ? window.innerWidth : 1280,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  },
  options?: {
    menuWidth?: number
    menuHeight?: number
    gap?: number
    margin?: number
  },
): ConversationMenuPosition {
  const menuWidth = options?.menuWidth ?? CONVERSATION_MENU_WIDTH_PX
  const menuHeight = options?.menuHeight ?? CONVERSATION_MENU_ESTIMATED_HEIGHT_PX
  const gap = options?.gap ?? 4
  const margin = options?.margin ?? 8
  const vh = Math.max(0, viewport.height)
  const vw = Math.max(0, viewport.width)

  const spaceBelow = vh - anchor.bottom - gap - margin
  const spaceAbove = anchor.top - gap - margin
  const openAbove = spaceBelow < menuHeight && spaceAbove > spaceBelow

  let top: number
  if (openAbove) {
    top = anchor.top - menuHeight - gap
    if (top < margin) top = margin
  } else {
    top = anchor.bottom + gap
    if (top + menuHeight > vh - margin) {
      top = Math.max(margin, vh - menuHeight - margin)
    }
  }

  let left = anchor.right - menuWidth
  if (left < margin) left = margin
  if (left + menuWidth > vw - margin) left = Math.max(margin, vw - menuWidth - margin)

  return {
    top,
    left,
    placement: openAbove ? 'above' : 'below',
  }
}
