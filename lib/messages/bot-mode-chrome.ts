export const BOT_MODE_SHOW_CHROME_LABEL = 'Show navigation'
export const BOT_MODE_HIDE_CHROME_LABEL = 'Hide navigation'

export function isBotModeSearchParam(value: string | null | undefined): boolean {
  return value === 'bot'
}

export function isMessagesPath(pathname: string): boolean {
  return /\/messages(?:\/|$)/.test(pathname) || /\/conversations(?:\/|$)/.test(pathname)
}

export function shouldHideSiteChrome(input: {
  pathname: string
  mode: string | null | undefined
  chromeRevealed: boolean
}): boolean {
  return isMessagesPath(input.pathname)
    && isBotModeSearchParam(input.mode)
    && !input.chromeRevealed
}
