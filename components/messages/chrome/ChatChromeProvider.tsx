'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  CHAT_CHROME_AUTO_HIDE_MS,
  CHAT_CHROME_STORAGE_KEY,
  isMessagesPath,
  nextChromeVisibility,
  readChromePinned,
  writeChromePinned,
  type ChatChromeEvent,
  type ChatChromeVisibility,
} from '@/lib/messages/chat-chrome'

type ChatChromeContextValue = {
  /** On messages path and chrome is neither pinned nor revealed */
  minimal: boolean
  revealed: boolean
  pinned: boolean
  runtimePeek: boolean
  /** Site chrome + shell header + desk panel */
  showFullChrome: boolean
  /** Runtime control bar (full reveal or transient peek) */
  showRuntimeBar: boolean
  /** Alias: hide portal/admin sidebar + topbar */
  hideSiteChrome: boolean
  reveal: () => void
  hide: () => void
  togglePin: () => void
  notify: (event: ChatChromeEvent) => void
}

const ChatChromeContext = createContext<ChatChromeContextValue | null>(null)

export function ChatChromeProvider({
  pathname,
  children,
  storageKey = CHAT_CHROME_STORAGE_KEY,
  autoHideMs = CHAT_CHROME_AUTO_HIDE_MS,
}: {
  pathname: string
  children: ReactNode
  storageKey?: string
  autoHideMs?: number
}) {
  const onMessages = isMessagesPath(pathname)
  const [visibility, setVisibility] = useState<ChatChromeVisibility>(() => ({
    revealed: false,
    pinned: false,
    runtimePeek: false,
  }))
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevPathRef = useRef(pathname)

  useEffect(() => {
    const pinned = readChromePinned(storageKey)
    setVisibility((current) => ({
      ...current,
      pinned,
      revealed: pinned ? true : current.revealed,
    }))
  }, [storageKey])

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current)
      idleTimerRef.current = null
    }
  }, [])

  const scheduleIdleHide = useCallback(() => {
    clearIdleTimer()
    idleTimerRef.current = setTimeout(() => {
      setVisibility((current) => nextChromeVisibility(current, 'idle'))
    }, autoHideMs)
  }, [autoHideMs, clearIdleTimer])

  const notify = useCallback((event: ChatChromeEvent) => {
    setVisibility((current) => {
      const next = nextChromeVisibility(current, event)
      if (event === 'pin' || event === 'unpin') {
        writeChromePinned(next.pinned, storageKey)
      }
      return next
    })
    if (event === 'reveal' || event === 'runtime_peek' || event === 'unpin') {
      scheduleIdleHide()
    } else {
      clearIdleTimer()
    }
  }, [clearIdleTimer, scheduleIdleHide, storageKey])

  useEffect(() => () => clearIdleTimer(), [clearIdleTimer])

  // Reset transient reveal when leaving or re-entering messages (pin persists).
  useEffect(() => {
    if (prevPathRef.current === pathname) return
    prevPathRef.current = pathname
    setVisibility((current) => ({
      ...current,
      revealed: current.pinned,
      runtimePeek: false,
    }))
    clearIdleTimer()
  }, [pathname, clearIdleTimer])

  const value = useMemo<ChatChromeContextValue>(() => {
    const revealed = visibility.revealed
    const pinned = visibility.pinned
    const runtimePeek = visibility.runtimePeek
    const minimal = onMessages && !pinned && !revealed
    const showFullChrome = !onMessages || pinned || revealed
    const showRuntimeBar = !onMessages || pinned || revealed || runtimePeek
    return {
      minimal,
      revealed,
      pinned,
      runtimePeek,
      showFullChrome,
      showRuntimeBar,
      hideSiteChrome: minimal,
      reveal: () => notify('reveal'),
      hide: () => notify('hide'),
      togglePin: () => notify(pinned ? 'unpin' : 'pin'),
      notify,
    }
  }, [notify, onMessages, visibility])

  return (
    <ChatChromeContext.Provider value={value}>
      {children}
    </ChatChromeContext.Provider>
  )
}

const FALLBACK: ChatChromeContextValue = {
  minimal: false,
  revealed: false,
  pinned: false,
  runtimePeek: false,
  showFullChrome: true,
  showRuntimeBar: true,
  hideSiteChrome: false,
  reveal: () => {},
  hide: () => {},
  togglePin: () => {},
  notify: () => {},
}

export function useChatChrome(): ChatChromeContextValue {
  return useContext(ChatChromeContext) ?? FALLBACK
}
