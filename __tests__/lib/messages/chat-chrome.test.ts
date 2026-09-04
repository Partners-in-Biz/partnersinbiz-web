import {
  CHAT_CHROME_AUTO_HIDE_MS,
  nextChromeVisibility,
  shouldHideChatChrome,
  shouldHideSiteChrome,
  shouldShowFullChrome,
  shouldShowRuntimeBar,
  type ChatChromeVisibility,
} from '@/lib/messages/chat-chrome'

const base: ChatChromeVisibility = { revealed: false, pinned: false, runtimePeek: false }

describe('chat-chrome', () => {
  it('hides site chrome on messages paths unless revealed or pinned', () => {
    expect(shouldHideChatChrome({ pathname: '/portal/messages', revealed: false, pinned: false })).toBe(true)
    expect(shouldHideChatChrome({ pathname: '/portal/messages', revealed: true, pinned: false })).toBe(false)
    expect(shouldHideChatChrome({ pathname: '/portal/messages', revealed: false, pinned: true })).toBe(false)
    expect(shouldHideChatChrome({ pathname: '/portal/dashboard', revealed: false, pinned: false })).toBe(false)
    expect(shouldHideChatChrome({ pathname: '/admin/messages', revealed: false, pinned: false })).toBe(true)
  })

  it('keeps legacy bot-mode-only hide for compatibility', () => {
    expect(shouldHideSiteChrome({ pathname: '/portal/messages', mode: 'bot', chromeRevealed: false })).toBe(true)
    expect(shouldHideSiteChrome({ pathname: '/portal/messages', mode: null, chromeRevealed: false })).toBe(false)
  })

  it('transitions visibility for reveal / idle / pin', () => {
    expect(nextChromeVisibility(base, 'reveal')).toEqual({ revealed: true, pinned: false, runtimePeek: false })
    expect(nextChromeVisibility({ ...base, revealed: true }, 'idle')).toEqual({ revealed: false, pinned: false, runtimePeek: false })
    expect(nextChromeVisibility({ ...base, revealed: true }, 'composer_focus')).toEqual({ revealed: false, pinned: false, runtimePeek: false })
    expect(nextChromeVisibility({ ...base, revealed: true }, 'message_sent')).toEqual({ revealed: false, pinned: false, runtimePeek: false })
    expect(nextChromeVisibility(base, 'pin')).toEqual({ revealed: true, pinned: true, runtimePeek: false })
    expect(nextChromeVisibility({ revealed: true, pinned: true, runtimePeek: false }, 'idle'))
      .toEqual({ revealed: true, pinned: true, runtimePeek: false })
    expect(nextChromeVisibility(base, 'runtime_peek')).toEqual({ revealed: false, pinned: false, runtimePeek: true })
  })

  it('exposes full chrome and runtime bar helpers', () => {
    expect(shouldShowFullChrome({ minimal: true, revealed: false, pinned: false })).toBe(false)
    expect(shouldShowFullChrome({ minimal: true, revealed: true, pinned: false })).toBe(true)
    expect(shouldShowRuntimeBar({ minimal: true, revealed: false, pinned: false, runtimePeek: true })).toBe(true)
    expect(shouldShowRuntimeBar({ minimal: true, revealed: false, pinned: false, runtimePeek: false })).toBe(false)
  })

  it('uses an 8s auto-hide window', () => {
    expect(CHAT_CHROME_AUTO_HIDE_MS).toBe(8000)
  })
})
