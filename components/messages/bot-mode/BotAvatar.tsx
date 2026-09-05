'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import type { AgentPresenceState } from '@/lib/messages/agent-presence'
import { resolveBotAvatarStyle, type BotAvatarStyle } from '@/lib/messages/bot-profile'

export type BotAvatarActivity = 'idle' | 'working' | 'waiting'

const INK_BY_COLOR_KEY: Record<string, string> = {
  sky: '#38bdf8',
  violet: '#a78bfa',
  amber: '#fbbf24',
  emerald: '#34d399',
  rose: '#fb7185',
  cyan: '#22d3ee',
  indigo: '#818cf8',
  orange: '#fb923c',
  teal: '#2dd4bf',
  slate: '#94a3b8',
}

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

/** True when the OS asks for reduced motion; false during SSR and in environments without matchMedia. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const media = window.matchMedia(REDUCED_MOTION_QUERY)
    const update = () => setReduced(media.matches)
    update()
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', update)
      return () => media.removeEventListener('change', update)
    }
    media.addListener(update)
    return () => media.removeListener(update)
  }, [])
  return reduced
}

/** Presence + live streaming collapse into the three motion intensities the avatar knows. */
export function botAvatarActivity(input: { presence?: AgentPresenceState | null; streaming?: boolean }): BotAvatarActivity {
  if (input.streaming) return 'working'
  switch (input.presence) {
    case 'thinking':
    case 'working':
      return 'working'
    case 'waiting':
    case 'blocked':
      return 'waiting'
    default:
      return 'idle'
  }
}

export function BotAvatar({
  name,
  avatarUrl,
  avatarStyle,
  colorKey,
  activity = 'idle',
  size = 36,
  className = '',
  testId,
}: {
  name: string
  avatarUrl?: string | null
  avatarStyle?: BotAvatarStyle | null
  colorKey?: string | null
  activity?: BotAvatarActivity
  size?: number
  className?: string
  testId?: string
}) {
  const reducedMotion = useReducedMotion()
  const style = resolveBotAvatarStyle({ avatarUrl, avatarStyle })
  const ink = INK_BY_COLOR_KEY[colorKey ?? ''] ?? INK_BY_COLOR_KEY.sky
  const cssVars = { '--bot-avatar-size': `${size}px`, '--bot-avatar-ink': ink } as CSSProperties

  return (
    <span
      role="img"
      aria-label={`${name} avatar`}
      data-testid={testId}
      data-style={style}
      data-activity={activity}
      data-motion={reducedMotion ? 'static' : 'animate'}
      className={`bot-avatar ${className}`.trim()}
      style={cssVars}
    >
      <span aria-hidden="true" className="bot-avatar__ring" />
      {style === 'image' && avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt="" className="bot-avatar__image" draggable={false} />
      ) : (
        <>
          <span aria-hidden="true" className="bot-avatar__body" />
          {style === 'geometric' ? <span aria-hidden="true" className="bot-avatar__facet" /> : null}
          <span aria-hidden="true" className="bot-avatar__eyes">
            <span className="bot-avatar__eye" />
            <span className="bot-avatar__eye" />
          </span>
        </>
      )}
    </span>
  )
}
