/**
 * Shared chat chrome (minimal / immersive) rules for portal + admin Messages.
 * Transient reveal auto-hides on composer focus, send, or idle timeout.
 * Pin persists per device via localStorage.
 */

export const CHAT_CHROME_SHOW_LABEL = 'Show navigation'
export const CHAT_CHROME_HIDE_LABEL = 'Hide navigation'
export const CHAT_CHROME_PIN_LABEL = 'Keep navigation visible'
export const CHAT_CHROME_UNPIN_LABEL = 'Allow navigation to auto-hide'
export const CHAT_CHROME_AUTO_HIDE_MS = 8000
export const CHAT_CHROME_STORAGE_KEY = 'pib.messages.chrome.v1'

/** @deprecated Prefer CHAT_CHROME_* — kept for Bot mode copy compatibility */
export const BOT_MODE_SHOW_CHROME_LABEL = CHAT_CHROME_SHOW_LABEL
/** @deprecated Prefer CHAT_CHROME_* */
export const BOT_MODE_HIDE_CHROME_LABEL = CHAT_CHROME_HIDE_LABEL

export type ChatChromeEvent =
  | 'reveal'
  | 'hide'
  | 'composer_focus'
  | 'message_sent'
  | 'idle'
  | 'pin'
  | 'unpin'
  | 'runtime_peek'

export type ChatChromeVisibility = {
  revealed: boolean
  pinned: boolean
  /** Runtime bar only — transient peek without full chrome */
  runtimePeek: boolean
}

export function isBotModeSearchParam(value: string | null | undefined): boolean {
  return value === 'bot'
}

export function isMessagesPath(pathname: string): boolean {
  return /\/messages(?:\/|$)/.test(pathname) || /\/conversations(?:\/|$)/.test(pathname)
}

/**
 * Hide site chrome (sidebar + topbar) on any messages/conversations route
 * unless the user has revealed or pinned chrome.
 */
export function shouldHideChatChrome(input: {
  pathname: string
  revealed: boolean
  pinned: boolean
}): boolean {
  if (!isMessagesPath(input.pathname)) return false
  if (input.pinned) return false
  return !input.revealed
}

/**
 * Legacy Bot-mode-only hide. Prefer `shouldHideChatChrome` for new code.
 * Kept so existing tests and wrappers keep compiling.
 */
export function shouldHideSiteChrome(input: {
  pathname: string
  mode: string | null | undefined
  chromeRevealed: boolean
}): boolean {
  return isMessagesPath(input.pathname)
    && isBotModeSearchParam(input.mode)
    && !input.chromeRevealed
}

/**
 * Pure visibility transition. Pin short-circuits auto-hide events.
 */
export function nextChromeVisibility(
  current: ChatChromeVisibility,
  event: ChatChromeEvent,
): ChatChromeVisibility {
  switch (event) {
    case 'reveal':
      return { ...current, revealed: true, runtimePeek: false }
    case 'hide':
      if (current.pinned) return { ...current, revealed: true, runtimePeek: false }
      return { ...current, revealed: false, runtimePeek: false }
    case 'pin':
      return { revealed: true, pinned: true, runtimePeek: false }
    case 'unpin':
      return { ...current, pinned: false, revealed: true, runtimePeek: false }
    case 'composer_focus':
    case 'message_sent':
    case 'idle':
      if (current.pinned) return current
      return { ...current, revealed: false, runtimePeek: false }
    case 'runtime_peek':
      if (current.pinned || current.revealed) return current
      return { ...current, runtimePeek: true }
    default:
      return current
  }
}

export function readChromePinned(storageKey = CHAT_CHROME_STORAGE_KEY): boolean {
  if (typeof window === 'undefined') return false
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return false
    const parsed = JSON.parse(raw) as { pinned?: unknown }
    return parsed?.pinned === true
  } catch {
    return false
  }
}

export function writeChromePinned(pinned: boolean, storageKey = CHAT_CHROME_STORAGE_KEY): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storageKey, JSON.stringify({ pinned }))
  } catch {
    // ignore quota / private mode
  }
}

/** True when runtime bar should be visible even if full chrome is minimal. */
export function shouldShowRuntimeBar(input: {
  minimal: boolean
  revealed: boolean
  pinned: boolean
  runtimePeek: boolean
}): boolean {
  if (!input.minimal) return true
  if (input.pinned || input.revealed) return true
  return input.runtimePeek
}

/** True when desk / shell header / site chrome should be visible. */
export function shouldShowFullChrome(input: {
  minimal: boolean
  revealed: boolean
  pinned: boolean
}): boolean {
  if (!input.minimal) return true
  return input.pinned || input.revealed
}
