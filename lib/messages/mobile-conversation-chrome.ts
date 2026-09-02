/**
 * Phone-width Messages / Bot mode first paint. Power-user chrome stays
 * available from the conversation overflow — it is hidden, not deleted.
 *
 * Uses the app's default `md` / 768 breakpoint.
 */
export const MOBILE_CONVERSATION_BREAKPOINT_PX = 768
export const MOBILE_CONVERSATION_CHROME_QUERY = '(max-width: 767px)'

/** CSS hide for first-paint rows that still exist in the desktop tree. */
export const MOBILE_CONVERSATION_HIDDEN_FLEX_CLASS = 'hidden md:flex'
export const MOBILE_CONVERSATION_HIDDEN_BLOCK_CLASS = 'hidden md:block'
export const MOBILE_CONVERSATION_HIDDEN_BOT_STRIP_CLASS = 'hidden md:flex xl:hidden'

const HIDDEN_UNTIL_MD = /\bhidden\b/
const MD_DISPLAY = /\bmd:(?:flex|block|inline-flex|grid|inline-block)\b/

/** True when a host is in the tree on phone first paint but CSS-hidden until md. */
export function isHiddenUntilMd(className: string | null | undefined): boolean {
  if (!className) return false
  return HIDDEN_UNTIL_MD.test(className) && MD_DISPLAY.test(className)
}

export const MOBILE_FIRST_PAINT_HIDDEN_TEST_IDS = [
  'conversation-command-session',
  'conversation-mobile-subtitle',
  'bot-computer-strip',
  'conversation-context-strip',
  'context-pulse',
  'agent-workbench-rail',
  'hermes-runtime-control-bar',
  'chat-context-toolbar',
  'conversation-design-commands',
] as const

export type MobileConversationChromeTestId = (typeof MOBILE_FIRST_PAINT_HIDDEN_TEST_IDS)[number]

export function isMobileConversationViewport(input: {
  matchesQuery?: boolean | null
  width?: number | null
}): boolean {
  if (typeof input.matchesQuery === 'boolean') return input.matchesQuery
  if (typeof input.width === 'number' && Number.isFinite(input.width)) {
    return input.width < MOBILE_CONVERSATION_BREAKPOINT_PX
  }
  return false
}

export function shouldHideMobileConversationChrome(input: {
  compact?: boolean
  mobileViewport: boolean
}): boolean {
  return input.compact !== true && input.mobileViewport
}

export function shouldAutoOpenBotWorkbench(input: {
  botMode: boolean
  showAgentWorkbench: boolean
  hasActiveConversation: boolean
  userClosed: boolean
  mobileViewport: boolean
}): boolean {
  return input.botMode
    && input.showAgentWorkbench
    && input.hasActiveConversation
    && !input.userClosed
    && !input.mobileViewport
}

export function shouldRenderClosedWorkbenchIconStrip(input: {
  open: boolean
}): boolean {
  return !input.open
}
