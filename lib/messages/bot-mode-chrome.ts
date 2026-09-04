/**
 * Thin wrappers around chat-chrome for Bot mode compatibility.
 * New code should import from `@/lib/messages/chat-chrome`.
 */
export {
  BOT_MODE_SHOW_CHROME_LABEL,
  BOT_MODE_HIDE_CHROME_LABEL,
  isBotModeSearchParam,
  isMessagesPath,
  shouldHideSiteChrome,
  shouldHideChatChrome,
} from '@/lib/messages/chat-chrome'
