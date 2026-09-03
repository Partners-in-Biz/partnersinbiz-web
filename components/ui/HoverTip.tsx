'use client'

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

export type HoverTipSide = 'top' | 'bottom' | 'left' | 'right'

type HoverTipProps = {
  /** Full label shown in the floating tip. Empty/whitespace disables the tip. */
  label: string
  side?: HoverTipSide
  /** Optional delay before showing (ms). Instant enough for discovery, avoids flicker. */
  delayMs?: number
  disabled?: boolean
  /** Extra class on the trigger wrapper. Defaults keep flex children truncating correctly. */
  className?: string
  children: ReactNode
}

const OFFSET_PX = 8

function computePosition(
  rect: DOMRect,
  tip: DOMRect,
  side: HoverTipSide,
): { top: number; left: number } {
  const vw = window.innerWidth
  const vh = window.innerHeight
  let top = 0
  let left = 0

  switch (side) {
    case 'bottom':
      top = rect.bottom + OFFSET_PX
      left = rect.left + rect.width / 2 - tip.width / 2
      break
    case 'left':
      top = rect.top + rect.height / 2 - tip.height / 2
      left = rect.left - tip.width - OFFSET_PX
      break
    case 'right':
      top = rect.top + rect.height / 2 - tip.height / 2
      left = rect.right + OFFSET_PX
      break
    case 'top':
    default:
      top = rect.top - tip.height - OFFSET_PX
      left = rect.left + rect.width / 2 - tip.width / 2
      break
  }

  // Keep the floating tip inside the viewport with a small margin.
  const margin = 6
  left = Math.min(Math.max(margin, left), vw - tip.width - margin)
  top = Math.min(Math.max(margin, top), vh - tip.height - margin)
  return { top, left }
}

/**
 * Instant floating tooltip that portals above the app chrome.
 * Use for truncated sidebar labels and icon-only controls where native
 * `title` is too slow or CSS `data-tip` would clip inside overflow parents.
 */
export function HoverTip({
  label,
  side = 'top',
  delayMs = 80,
  disabled = false,
  className,
  children,
}: HoverTipProps) {
  const tipId = useId()
  const triggerRef = useRef<HTMLSpanElement | null>(null)
  const tipRef = useRef<HTMLSpanElement | null>(null)
  const timerRef = useRef<number | null>(null)
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)
  const [style, setStyle] = useState<CSSProperties>({
    position: 'fixed',
    top: 0,
    left: 0,
    opacity: 0,
    pointerEvents: 'none',
  })

  const text = label.trim()
  const enabled = !disabled && text.length > 0

  useEffect(() => {
    setMounted(true)
  }, [])

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const positionTip = useCallback(() => {
    const trigger = triggerRef.current
    const tip = tipRef.current
    if (!trigger || !tip) return
    const next = computePosition(trigger.getBoundingClientRect(), tip.getBoundingClientRect(), side)
    setStyle({
      position: 'fixed',
      top: next.top,
      left: next.left,
      opacity: 1,
      pointerEvents: 'none',
    })
  }, [side])

  const show = useCallback(() => {
    if (!enabled) return
    clearTimer()
    timerRef.current = window.setTimeout(() => {
      setOpen(true)
    }, delayMs)
  }, [enabled, clearTimer, delayMs])

  const hide = useCallback(() => {
    clearTimer()
    setOpen(false)
    setStyle((current) => ({ ...current, opacity: 0 }))
  }, [clearTimer])

  useEffect(() => () => clearTimer(), [clearTimer])

  useLayoutEffect(() => {
    if (!open) return
    positionTip()
    const onReposition = () => positionTip()
    window.addEventListener('scroll', onReposition, true)
    window.addEventListener('resize', onReposition)
    return () => {
      window.removeEventListener('scroll', onReposition, true)
      window.removeEventListener('resize', onReposition)
    }
  }, [open, positionTip, text])

  const onMouseEnter = (event: MouseEvent<HTMLSpanElement>) => {
    // Ignore hover when a nested interactive already handles focus; still show tip.
    void event
    show()
  }

  const onMouseLeave = () => hide()
  const onFocus = (event: FocusEvent<HTMLSpanElement>) => {
    // Only show on focus when the focus lands inside this tip trigger.
    if (event.currentTarget.contains(event.target as Node)) show()
  }
  const onBlur = (event: FocusEvent<HTMLSpanElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node)) hide()
  }

  return (
    <>
      <span
        ref={triggerRef}
        className={className ?? 'inline-flex min-w-0 max-w-full'}
        onMouseEnter={enabled ? onMouseEnter : undefined}
        onMouseLeave={enabled ? onMouseLeave : undefined}
        onFocus={enabled ? onFocus : undefined}
        onBlur={enabled ? onBlur : undefined}
      >
        {children}
      </span>
      {mounted && open && enabled
        ? createPortal(
            <span
              ref={tipRef}
              id={tipId}
              role="tooltip"
              data-testid="hover-tip"
              className="z-[120] max-w-[min(20rem,calc(100vw-12px))] rounded-[var(--st-radius,4px)] border border-[var(--sc-line)] bg-[var(--sc-surface)] px-2 py-1 text-left text-[11px] font-medium leading-snug text-[var(--sc-ink)] shadow-[var(--sc-shadow)]"
              style={style}
            >
              {text}
            </span>,
            document.body,
          )
        : null}
    </>
  )
}
