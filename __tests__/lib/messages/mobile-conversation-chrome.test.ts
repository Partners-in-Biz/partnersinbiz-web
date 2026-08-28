import {
  MOBILE_CONVERSATION_BREAKPOINT_PX,
  MOBILE_CONVERSATION_CHROME_QUERY,
  MOBILE_CONVERSATION_HIDDEN_BOT_STRIP_CLASS,
  MOBILE_CONVERSATION_HIDDEN_FLEX_CLASS,
  MOBILE_FIRST_PAINT_HIDDEN_TEST_IDS,
  isHiddenUntilMd,
  isMobileConversationViewport,
  shouldAutoOpenBotWorkbench,
  shouldHideMobileConversationChrome,
  shouldRenderClosedWorkbenchIconStrip,
} from '@/lib/messages/mobile-conversation-chrome'

describe('mobile conversation chrome', () => {
  it('uses the app md / 768 phone breakpoint', () => {
    expect(MOBILE_CONVERSATION_BREAKPOINT_PX).toBe(768)
    expect(MOBILE_CONVERSATION_CHROME_QUERY).toBe('(max-width: 767px)')
    expect(isMobileConversationViewport({ width: 390 })).toBe(true)
    expect(isMobileConversationViewport({ width: 767 })).toBe(true)
    expect(isMobileConversationViewport({ width: 768 })).toBe(false)
    expect(isMobileConversationViewport({ matchesQuery: true })).toBe(true)
    expect(isMobileConversationViewport({ matchesQuery: false, width: 390 })).toBe(false)
  })

  it('treats first-paint hide as CSS hidden-until-md, not a JS unmount', () => {
    expect(isHiddenUntilMd(MOBILE_CONVERSATION_HIDDEN_FLEX_CLASS)).toBe(true)
    expect(isHiddenUntilMd(MOBILE_CONVERSATION_HIDDEN_BOT_STRIP_CLASS)).toBe(true)
    expect(isHiddenUntilMd('hidden md:block xl:hidden')).toBe(true)
    expect(isHiddenUntilMd('hidden md:inline-flex')).toBe(true)
    expect(isHiddenUntilMd('flex')).toBe(false)
    expect(isHiddenUntilMd('md:flex')).toBe(false)
    expect(isHiddenUntilMd('')).toBe(false)
  })

  it('hides first-paint chrome on phone Messages, not compact side-chat', () => {
    expect(shouldHideMobileConversationChrome({ mobileViewport: true })).toBe(true)
    expect(shouldHideMobileConversationChrome({ compact: false, mobileViewport: true })).toBe(true)
    expect(shouldHideMobileConversationChrome({ compact: true, mobileViewport: true })).toBe(false)
    expect(shouldHideMobileConversationChrome({ mobileViewport: false })).toBe(false)
  })

  it('does not auto-open Bot workbench on a phone-width first paint', () => {
    expect(shouldAutoOpenBotWorkbench({
      botMode: true,
      showAgentWorkbench: true,
      hasActiveConversation: true,
      userClosed: false,
      mobileViewport: true,
    })).toBe(false)
    expect(shouldAutoOpenBotWorkbench({
      botMode: true,
      showAgentWorkbench: true,
      hasActiveConversation: true,
      userClosed: false,
      mobileViewport: false,
    })).toBe(true)
  })

  it('keeps the closed workbench icon rail in the tree so CSS can hide it', () => {
    expect(shouldRenderClosedWorkbenchIconStrip({ open: false })).toBe(true)
    expect(shouldRenderClosedWorkbenchIconStrip({ open: true })).toBe(false)
  })

  it('names every first-paint chrome host tests must CSS-hide', () => {
    expect(MOBILE_FIRST_PAINT_HIDDEN_TEST_IDS).toEqual(expect.arrayContaining([
      'conversation-command-session',
      'bot-computer-strip',
      'conversation-context-strip',
      'agent-workbench-rail',
      'hermes-runtime-control-bar',
    ]))
  })
})
