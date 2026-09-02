'use client'

import { useEffect, useState } from 'react'
import {
  MOBILE_CONVERSATION_CHROME_QUERY,
  isMobileConversationViewport,
} from '@/lib/messages/mobile-conversation-chrome'

function readMobileConversationViewport(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return isMobileConversationViewport({
    matchesQuery: window.matchMedia(MOBILE_CONVERSATION_CHROME_QUERY).matches,
  })
}

export function useMobileConversationViewport(): boolean {
  const [mobile, setMobile] = useState(readMobileConversationViewport)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const media = window.matchMedia(MOBILE_CONVERSATION_CHROME_QUERY)
    const update = () => setMobile(isMobileConversationViewport({ matchesQuery: media.matches }))
    update()
    media.addEventListener?.('change', update)
    return () => media.removeEventListener?.('change', update)
  }, [])

  return mobile
}
