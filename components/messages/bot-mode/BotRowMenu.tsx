'use client'

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Icon } from '@/components/studio'

export const BOT_LONG_PRESS_MS = 450

/**
 * Long-press (touch) / right-click (pointer) opener for a bot row menu.
 * Returns handlers to spread on the pressable element plus an `open` flag.
 */
export function useBotRowMenu() {
  const [open, setOpen] = useState(false)
  const timerRef = useRef<number | null>(null)
  const firedRef = useRef(false)

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  useEffect(() => clear, [clear])

  const onPointerDown = useCallback((event: ReactPointerEvent) => {
    if (event.button !== 0) return
    firedRef.current = false
    clear()
    timerRef.current = window.setTimeout(() => {
      firedRef.current = true
      setOpen(true)
    }, BOT_LONG_PRESS_MS)
  }, [clear])

  const onContextMenu = useCallback((event: ReactPointerEvent | MouseEvent | { preventDefault(): void }) => {
    event.preventDefault()
    clear()
    setOpen(true)
  }, [clear])

  /** Swallow the click that follows a long-press so the row does not also open. */
  const onClickCapture = useCallback((event: { preventDefault(): void; stopPropagation(): void }) => {
    if (!firedRef.current) return
    firedRef.current = false
    event.preventDefault()
    event.stopPropagation()
  }, [])

  return {
    open,
    setOpen,
    close: () => setOpen(false),
    pressHandlers: {
      onPointerDown,
      onPointerUp: clear,
      onPointerLeave: clear,
      onPointerCancel: clear,
      onContextMenu,
      onClickCapture,
    },
  }
}

export type BotRowMenuItem = {
  id: string
  label: string
  icon: string
  onSelect: () => void
  tone?: 'default' | 'primary'
}

export function BotRowMenu({
  botName,
  items,
  onClose,
  align = 'start',
}: {
  botName: string
  items: BotRowMenuItem[]
  onClose: () => void
  align?: 'start' | 'center'
}) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    const onPointer = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer, true)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer, true)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={`${botName} actions`}
      data-testid="bot-row-menu"
      className={`absolute z-40 min-w-[180px] rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-1 shadow-xl ${
        align === 'center' ? 'left-1/2 top-full mt-1 -translate-x-1/2' : 'left-2 top-full mt-1'
      }`}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          data-testid={`bot-row-menu-${item.id}`}
          onClick={() => { item.onSelect(); onClose() }}
          className={`flex h-11 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] hover:bg-[var(--color-row-hover)] xl:h-9 ${
            item.tone === 'primary' ? 'text-primary' : 'text-[var(--color-pib-text)]'
          }`}
        >
          <Icon name={item.icon} className="text-[16px]" />
          {item.label}
        </button>
      ))}
    </div>
  )
}
