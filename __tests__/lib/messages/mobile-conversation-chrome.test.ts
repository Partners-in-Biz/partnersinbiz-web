import {
  MOBILE_CONVERSATION_BREAKPOINT_PX,
  MOBILE_CONVERSATION_CHROME_QUERY,
  MOBILE_FIRST_PAINT_HIDDEN_TEST_IDS,
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

  it('keeps the closed workbench icon rail off the phone first paint', () => {
    expect(shouldRenderClosedWorkbenchIconStrip({ open: false, hideClosedIconStrip: true })).toBe(false)
    expect(shouldRenderClosedWorkbenchIconStrip({ open: false, hideClosedIconStrip: false })).toBe(true)
    expect(shouldRenderClosedWorkbenchIconStrip({ open: true, hideClosedIconStrip: true })).toBe(false)
  })

  it('names every first-paint chrome row tests must hide', () => {
    expect(MOBILE_FIRST_PAINT_HIDDEN_TEST_IDS).toEqual(expect.arrayContaining([
      'command-session-badge',
      'bot-computer-strip',
      'conversation-context-strip',
      'agent-workbench-icon-strip',
      'hermes-runtime-control-bar',
    ]))
  })
})
